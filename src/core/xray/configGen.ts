/**
 * Generate a runnable Xray-core configuration from a ServerProfile.
 *
 * Mirrors src/core/singbox/configGen.ts but emits the Xray JSON schema.
 * Hysteria2 / TUIC are not part of Xray-core and are rejected here — use the
 * sing-box core for those.
 *
 * Reference: https://xtls.github.io/config/
 */
import type { RoutingMode, RoutingRule, ServerProfile, TransportSettings } from "../types";

export interface XrayGenOptions {
  mixedPort: number; // local HTTP inbound (system-proxy target)
  clashApiPort: number; // accepted for signature parity; Xray uses its own API
  routingMode: RoutingMode;
  allowLan: boolean;
  /** Optional dedicated SOCKS port; defaults to mixedPort + 1. */
  socksPort?: number;
  /** User-defined rules, applied before the bundled geo rules. */
  customRules?: RoutingRule[];
  /** Reject QUIC (UDP/443) so browsers fall back to TCP/TLS and stay routed. */
  blockQuic?: boolean;
  /** TLS fragmentation (anti-DPI) via a dedicated freedom outbound + dialerProxy. */
  fragment?: { enabled: boolean; packets: string; length: string; interval: string } | null;
  /** Stream multiplexing on the proxy outbound. */
  mux?: { enabled: boolean; protocol?: string } | null;
}

const PROXY_TAG = "proxy";
const DIRECT_TAG = "direct";
const BLOCK_TAG = "block";
const FRAGMENT_TAG = "fragment";

export function generateXrayConfig(server: ServerProfile, opts: XrayGenOptions): object {
  if (
    server.protocol === "hysteria2" ||
    server.protocol === "hysteria" ||
    server.protocol === "tuic" ||
    server.protocol === "anytls"
  ) {
    throw new Error(
      `Протокол ${server.protocol} поддерживается только ядром sing-box`,
    );
  }

  const listen = opts.allowLan ? "0.0.0.0" : "127.0.0.1";
  const socksPort = opts.socksPort ?? opts.mixedPort + 1;
  const sniffing = { enabled: true, destOverride: ["http", "tls", "quic"] };
  const fragmentEnabled = !!opts.fragment?.enabled;

  const outbounds: object[] = [
    buildXrayOutbound(server, { mux: opts.mux ?? null, fragment: fragmentEnabled }),
    { tag: DIRECT_TAG, protocol: "freedom" },
    { tag: BLOCK_TAG, protocol: "blackhole" },
  ];

  // Xray fragments TLS ClientHello by dialing the real outbound through a
  // dedicated freedom outbound that owns the fragment settings.
  if (fragmentEnabled && opts.fragment) {
    outbounds.push({
      tag: FRAGMENT_TAG,
      protocol: "freedom",
      settings: {
        fragment: {
          packets: opts.fragment.packets || "tlshello",
          length: opts.fragment.length || "10-20",
          interval: opts.fragment.interval || "10-20",
        },
      },
    });
  }

  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "http-in",
        listen,
        port: opts.mixedPort,
        protocol: "http",
        sniffing,
      },
      {
        tag: "socks-in",
        listen,
        port: socksPort,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
        sniffing,
      },
    ],
    outbounds,
    routing: buildXrayRouting(opts.routingMode, opts.customRules, opts.blockQuic),
  };
}

interface OutboundExtras {
  mux: { enabled: boolean; protocol?: string } | null;
  fragment: boolean;
}

function buildXrayOutbound(s: ServerProfile, extra: OutboundExtras): object {
  // WireGuard and SOCKS are dialer outbounds with their own settings shape and
  // no streamSettings/TLS/mux block — handle them before the v2ray-family path.
  if (s.protocol === "wireguard") {
    const wg = s.wireguard;
    return {
      tag: PROXY_TAG,
      protocol: "wireguard",
      settings: {
        secretKey: wg?.privateKey ?? "",
        address: wg?.localAddress ?? ["172.16.0.2/32"],
        peers: [
          {
            publicKey: wg?.peerPublicKey ?? "",
            endpoint: `${s.address}:${s.port}`,
            ...(wg?.preSharedKey ? { preSharedKey: wg.preSharedKey } : {}),
          },
        ],
        ...(wg?.reserved && wg.reserved.length ? { reserved: wg.reserved } : {}),
        ...(wg?.mtu ? { mtu: wg.mtu } : {}),
      },
    };
  }
  if (s.protocol === "socks") {
    return {
      tag: PROXY_TAG,
      protocol: "socks",
      settings: {
        servers: [
          {
            address: s.address,
            port: s.port,
            ...(s.username || s.password
              ? { users: [{ user: s.username ?? "", pass: s.password ?? "" }] }
              : {}),
          },
        ],
      },
    };
  }

  const streamSettings = buildXrayStream(s, extra.fragment);
  // xtls-rprx-vision cannot be combined with mux; Xray rejects the pair, so
  // suppress mux for vless outbounds that carry a flow.
  const visionFlow = s.protocol === "vless" && !!s.flow;
  const muxBlock =
    extra.mux?.enabled && !visionFlow ? { mux: { enabled: true, concurrency: 8 } } : {};
  switch (s.protocol) {
    case "vless":
      return {
        tag: PROXY_TAG,
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: s.address,
              port: s.port,
              users: [{ id: s.uuid, encryption: "none", flow: s.flow || "" }],
            },
          ],
        },
        streamSettings,
        ...muxBlock,
      };
    case "vmess":
      return {
        tag: PROXY_TAG,
        protocol: "vmess",
        settings: {
          vnext: [
            {
              address: s.address,
              port: s.port,
              users: [{ id: s.uuid, alterId: s.alterId ?? 0, security: s.method || "auto" }],
            },
          ],
        },
        streamSettings,
        ...muxBlock,
      };
    case "trojan":
      return {
        tag: PROXY_TAG,
        protocol: "trojan",
        settings: { servers: [{ address: s.address, port: s.port, password: s.password }] },
        streamSettings,
        ...muxBlock,
      };
    case "shadowsocks":
      return {
        tag: PROXY_TAG,
        protocol: "shadowsocks",
        settings: {
          servers: [{ address: s.address, port: s.port, method: s.method, password: s.password }],
        },
        streamSettings,
        ...muxBlock,
      };
    default:
      throw new Error(`Unsupported protocol for xray: ${s.protocol}`);
  }
}

function buildXrayStream(s: ServerProfile, fragment: boolean): object {
  const network = mapNetwork(s.transport.type);
  const ss: Record<string, unknown> = { network };

  switch (network) {
    case "ws":
      ss.wsSettings = {
        path: s.transport.path || "/",
        ...(s.transport.host ? { headers: { Host: s.transport.host } } : {}),
      };
      break;
    case "grpc":
      ss.grpcSettings = { serviceName: s.transport.serviceName || "" };
      break;
    case "http":
      ss.httpSettings = {
        path: s.transport.path || "/",
        ...(s.transport.host ? { host: [s.transport.host] } : {}),
      };
      break;
    case "xhttp":
      ss.xhttpSettings = {
        path: s.transport.path || "/",
        ...(s.transport.host ? { host: s.transport.host } : {}),
        mode: s.transport.mode || "auto",
        ...(s.transport.xhttpExtra ? { extra: s.transport.xhttpExtra } : {}),
      };
      break;
    default:
      break; // tcp / quic — no extra block
  }

  if (s.tls.enabled && s.tls.security === "reality") {
    ss.security = "reality";
    ss.realitySettings = {
      serverName: s.tls.sni || s.address,
      publicKey: s.tls.publicKey || "",
      shortId: s.tls.shortId || "",
      fingerprint: s.tls.fingerprint || "chrome",
      spiderX: s.tls.spiderX || "",
      // Post-quantum REALITY (ML-DSA-65) — required to handshake with PQ nodes.
      ...(s.tls.postQuantum ? { mldsa65Verify: s.tls.postQuantum } : {}),
    };
  } else if (s.tls.enabled) {
    ss.security = "tls";
    ss.tlsSettings = {
      serverName: s.tls.sni || s.address,
      allowInsecure: !!s.tls.allowInsecure,
      ...(s.tls.alpn && s.tls.alpn.length ? { alpn: s.tls.alpn } : {}),
      ...(s.tls.fingerprint ? { fingerprint: s.tls.fingerprint } : {}),
    };
  } else {
    ss.security = "none";
  }

  // Route this outbound's dialling through the fragment freedom outbound.
  if (fragment) {
    ss.sockopt = { dialerProxy: FRAGMENT_TAG };
  }

  return ss;
}

function mapNetwork(t: TransportSettings["type"]): string {
  switch (t) {
    case "ws":
      return "ws";
    case "grpc":
      return "grpc";
    case "h2":
    case "http":
      return "http";
    case "quic":
      return "quic";
    case "xhttp":
      return "xhttp";
    default:
      return "tcp";
  }
}

/**
 * Map one user rule to an Xray routing rule. Returns null for matches Xray
 * cannot express — `process_name` is a sing-box-only, app-based matcher.
 */
function buildXrayCustomRule(r: RoutingRule): object | null {
  const value = r.value.trim();
  if (!value) return null;
  const outboundTag =
    r.target === "proxy" ? PROXY_TAG : r.target === "direct" ? DIRECT_TAG : BLOCK_TAG;
  switch (r.match) {
    case "domain":
      return { type: "field", domain: [`full:${value}`], outboundTag };
    case "domain_suffix":
      return { type: "field", domain: [`domain:${value}`], outboundTag };
    case "domain_keyword":
      return { type: "field", domain: [`keyword:${value}`], outboundTag };
    case "ip_cidr":
      return { type: "field", ip: [value], outboundTag };
    case "process_name":
      return null; // Xray has no process-based routing
    default:
      return null;
  }
}

function buildXrayRouting(
  mode: RoutingMode,
  customRules?: RoutingRule[],
  blockQuic?: boolean,
): object {
  const rules: object[] = [];

  // Reject QUIC early (UDP/443) so HTTP/3 cannot slip past the rules below.
  if (blockQuic) {
    rules.push({ type: "field", network: "udp", port: 443, outboundTag: BLOCK_TAG });
  }

  // User rules win over the bundled geo rules.
  for (const r of customRules ?? []) {
    const mapped = buildXrayCustomRule(r);
    if (mapped) rules.push(mapped);
  }

  if (mode === "direct") {
    rules.push({ type: "field", network: "tcp,udp", outboundTag: DIRECT_TAG });
    return { domainStrategy: "AsIs", rules };
  }
  if (mode === "global") {
    rules.push({ type: "field", network: "tcp,udp", outboundTag: PROXY_TAG });
    return { domainStrategy: "IPIfNonMatch", rules };
  }
  // rule-based
  rules.push(
    { type: "field", domain: ["geosite:category-ads-all"], outboundTag: BLOCK_TAG },
    { type: "field", domain: ["geosite:cn"], outboundTag: DIRECT_TAG },
    { type: "field", ip: ["geoip:cn", "geoip:private"], outboundTag: DIRECT_TAG },
    { type: "field", network: "tcp,udp", outboundTag: PROXY_TAG },
  );
  return { domainStrategy: "IPIfNonMatch", rules };
}
