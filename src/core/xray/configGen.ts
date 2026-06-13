/**
 * Generate a runnable Xray-core configuration from a ServerProfile.
 *
 * Mirrors src/core/singbox/configGen.ts but emits the Xray JSON schema.
 * Hysteria2 / TUIC are not part of Xray-core and are rejected here — use the
 * sing-box core for those.
 *
 * Reference: https://xtls.github.io/config/
 */
import type { RoutingMode, ServerProfile, TransportSettings } from "../types";

export interface XrayGenOptions {
  mixedPort: number; // local HTTP inbound (system-proxy target)
  clashApiPort: number; // accepted for signature parity; Xray uses its own API
  routingMode: RoutingMode;
  allowLan: boolean;
  /** Optional dedicated SOCKS port; defaults to mixedPort + 1. */
  socksPort?: number;
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
  if (server.protocol === "hysteria2" || server.protocol === "tuic") {
    throw new Error(
      `\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b ${server.protocol} \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u044f\u0434\u0440\u043e\u043c sing-box`,
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
    routing: buildXrayRouting(opts.routingMode),
  };
}

interface OutboundExtras {
  mux: { enabled: boolean; protocol?: string } | null;
  fragment: boolean;
}

function buildXrayOutbound(s: ServerProfile, extra: OutboundExtras): object {
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
    default:
      return "tcp";
  }
}

function buildXrayRouting(mode: RoutingMode): object {
  if (mode === "direct") {
    return {
      domainStrategy: "AsIs",
      rules: [{ type: "field", network: "tcp,udp", outboundTag: DIRECT_TAG }],
    };
  }
  if (mode === "global") {
    return {
      domainStrategy: "IPIfNonMatch",
      rules: [{ type: "field", network: "tcp,udp", outboundTag: PROXY_TAG }],
    };
  }
  // rule-based
  return {
    domainStrategy: "IPIfNonMatch",
    rules: [
      { type: "field", domain: ["geosite:category-ads-all"], outboundTag: BLOCK_TAG },
      { type: "field", domain: ["geosite:cn"], outboundTag: DIRECT_TAG },
      { type: "field", ip: ["geoip:cn", "geoip:private"], outboundTag: DIRECT_TAG },
      { type: "field", network: "tcp,udp", outboundTag: PROXY_TAG },
    ],
  };
}
