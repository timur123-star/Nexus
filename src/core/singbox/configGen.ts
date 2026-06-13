/**
 * Generate a runnable sing-box configuration from a ServerProfile.
 *
 * The frontend owns config generation so the Rust side stays a thin process
 * supervisor (write file -> spawn -> monitor). This keeps the protocol
 * knowledge in one place and lets us unit-test it.
 *
 * Reference: https://sing-box.sagernet.org/configuration/
 */
import type { ProxySettings } from "../../store/useSettingsStore";
import type {
  RoutingMode,
  RoutingRule,
  RoutingRuleMatch,
  RoutingTarget,
  ServerProfile,
  TransportSettings,
} from "../types";

export interface GenOptions {
  mixedPort: number; // local mixed (http+socks) inbound
  clashApiPort: number;
  clashSecret: string;
  routingMode: RoutingMode;
  tun: ProxySettings["tun"];
  allowLan: boolean;
  fakeIp: boolean;
  dns: ProxySettings["dns"];
  /** User-defined rules, applied before the bundled geo rules. */
  customRules?: RoutingRule[];
  /** Reject QUIC so browsers fall back to TCP/TLS and remain routed. */
  blockQuic?: boolean;
  /** Stream multiplexing (mux) applied to TCP-based protocols only. */
  mux?: ProxySettings["mux"];
  /** TLS fragmentation. Native to Xray; sing-box configs intentionally ignore it. */
  fragment?: ProxySettings["fragment"];
  logLevel?: "trace" | "debug" | "info" | "warn" | "error";
}

const PROXY_TAG = "proxy";
const DIRECT_TAG = "direct";
const BLOCK_TAG = "block";

const MATCH_KEY: Record<RoutingRuleMatch, string> = {
  domain: "domain",
  domain_suffix: "domain_suffix",
  domain_keyword: "domain_keyword",
  ip_cidr: "ip_cidr",
  process_name: "process_name",
};

const TARGET_OUTBOUND: Record<RoutingTarget, string> = {
  proxy: PROXY_TAG,
  direct: DIRECT_TAG,
  block: BLOCK_TAG,
};

export function generateSingboxConfig(server: ServerProfile, opts: GenOptions): object {
  const inbounds = buildInbounds(opts);
  const outbound = buildOutbound(server, opts);

  return {
    log: { level: opts.logLevel ?? "info", timestamp: true },
    dns: buildDns(opts),
    inbounds,
    outbounds: [
      outbound,
      { type: "direct", tag: DIRECT_TAG },
      { type: "block", tag: BLOCK_TAG },
    ],
    route: buildRoute(opts),
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${opts.clashApiPort}`,
        secret: opts.clashSecret,
      },
      cache_file: { enabled: true },
    },
  };
}

function buildInbounds(opts: GenOptions): object[] {
  const inbounds: object[] = [
    {
      type: "mixed",
      tag: "mixed-in",
      listen: opts.allowLan ? "0.0.0.0" : "127.0.0.1",
      listen_port: opts.mixedPort,
      sniff: true,
      sniff_override_destination: false,
    },
  ];

  // TUN applies in any routing mode when enabled (requires elevated privileges).
  if (opts.tun.enabled) {
    inbounds.push({
      type: "tun",
      tag: "tun-in",
      interface_name: "nexus-tun",
      inet4_address: "172.19.0.1/30",
      inet6_address: "fdfe:dcba:9876::1/126",
      auto_route: true,
      strict_route: true,
      stack: opts.tun.stack ?? "system",
      sniff: true,
      mtu: 9000,
    });
  }

  return inbounds;
}

function buildDns(opts: GenOptions): object {
  const servers: object[] = [
    { tag: "dns-remote", address: opts.dns.remote || "https://1.1.1.1/dns-query", detour: PROXY_TAG },
    { tag: "dns-direct", address: opts.dns.direct || "https://223.5.5.5/dns-query", detour: DIRECT_TAG },
    { tag: "dns-block", address: "rcode://success" },
  ];

  const rules: object[] = [
    { outbound: "any", server: "dns-direct" },
    { rule_set: "geosite-cn", server: "dns-direct" },
  ];

  return {
    servers,
    rules,
    final: "dns-remote",
    strategy: "prefer_ipv4",
    independent_cache: true,
    ...(opts.fakeIp
      ? {
          fakeip: { enabled: true, inet4_range: "198.18.0.0/15", inet6_range: "fc00::/18" },
        }
      : {}),
  };
}

function buildRoute(opts: GenOptions): object {
  const rules: object[] = [
    { action: "sniff" },
    { protocol: "dns", action: "hijack-dns" },
  ];

  // Reject QUIC early so HTTP/3 cannot bypass the rules below over UDP/443.
  if (opts.blockQuic) {
    rules.push({ protocol: "quic", action: "reject" });
  }

  rules.push({ ip_is_private: true, outbound: DIRECT_TAG });

  // User rules win over the bundled geo rules.
  for (const rule of buildCustomRules(opts.customRules)) rules.push(rule);

  if (opts.routingMode === "rule") {
    rules.push(
      { rule_set: "geoip-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-ads", outbound: BLOCK_TAG },
    );
  }

  const rule_set =
    opts.routingMode === "rule"
      ? [
          ruleSet("geoip-cn", "geoip", "cn"),
          ruleSet("geosite-cn", "geosite", "cn"),
          ruleSet("geosite-ads", "geosite", "category-ads-all"),
        ]
      : [];

  return {
    rules,
    rule_set,
    final: opts.routingMode === "direct" ? DIRECT_TAG : PROXY_TAG,
    auto_detect_interface: true,
  };
}

/** Turn user rules into sing-box route rule objects (skips empty values). */
function buildCustomRules(rules: RoutingRule[] | undefined): object[] {
  if (!rules || rules.length === 0) return [];
  const out: object[] = [];
  for (const r of rules) {
    const value = r.value.trim();
    if (!value) continue;
    out.push({ [MATCH_KEY[r.match]]: [value], outbound: TARGET_OUTBOUND[r.target] });
  }
  return out;
}

function ruleSet(tag: string, kind: "geoip" | "geosite", name: string): object {
  const base =
    kind === "geoip"
      ? "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set"
      : "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set";
  return {
    tag,
    type: "remote",
    format: "binary",
    url: `${base}/${kind}-${name}.srs`,
    download_detour: PROXY_TAG,
  };
}

// -- Outbound builders ------------------------------------------------------

/**
 * sing-box stream multiplexing. Valid only on TCP-based protocols
 * (vless/vmess/trojan/shadowsocks); hysteria2 and tuic are UDP-native and must
 * never carry a multiplex block.
 */
function buildMultiplex(mux: GenOptions["mux"]): object | null {
  if (!mux || !mux.enabled) return null;
  return {
    enabled: true,
    protocol: mux.protocol,
    max_connections: 4,
    min_streams: 4,
    padding: false,
  };
}

function buildOutbound(s: ServerProfile, opts: GenOptions): object {
  const common = { tag: PROXY_TAG, server: s.address, server_port: s.port };
  const tls = buildTlsBlock(s);
  const transport = buildTransportBlock(s.transport);
  const multiplex = buildMultiplex(opts.mux);

  switch (s.protocol) {
    case "vless":
      return {
        type: "vless",
        ...common,
        uuid: s.uuid,
        ...(s.flow ? { flow: s.flow } : {}),
        ...(transport ? { transport } : {}),
        ...(tls ? { tls } : {}),
        ...(multiplex ? { multiplex } : {}),
      };
    case "vmess":
      return {
        type: "vmess",
        ...common,
        uuid: s.uuid,
        alter_id: s.alterId ?? 0,
        security: s.method || "auto",
        ...(transport ? { transport } : {}),
        ...(tls ? { tls } : {}),
        ...(multiplex ? { multiplex } : {}),
      };
    case "trojan":
      return {
        type: "trojan",
        ...common,
        password: s.password,
        ...(transport ? { transport } : {}),
        ...(tls ? { tls } : {}),
        ...(multiplex ? { multiplex } : {}),
      };
    case "shadowsocks":
      return {
        type: "shadowsocks",
        ...common,
        method: s.method,
        password: s.password,
        ...(multiplex ? { multiplex } : {}),
      };
    case "hysteria2":
      return {
        type: "hysteria2",
        ...common,
        password: s.password,
        ...(s.extra?.obfs
          ? { obfs: { type: s.extra.obfs, password: s.extra.obfsPassword } }
          : {}),
        ...(tls ? { tls } : { tls: { enabled: true } }),
      };
    case "tuic":
      return {
        type: "tuic",
        ...common,
        uuid: s.uuid,
        password: s.password,
        congestion_control: s.extra?.congestionControl || "bbr",
        udp_relay_mode: s.extra?.udpRelayMode || "native",
        ...(tls ? { tls } : { tls: { enabled: true } }),
      };
  }
}

function buildTlsBlock(s: ServerProfile): object | null {
  if (!s.tls.enabled) return null;
  const isReality = s.tls.security === "reality";
  const tls: Record<string, unknown> = {
    enabled: true,
    server_name: s.tls.sni || s.address,
    insecure: !!s.tls.allowInsecure,
  };
  if (s.tls.alpn?.length) tls.alpn = s.tls.alpn;
  // sing-box REQUIRES a utls block for Reality. Many 3x-ui share links omit the
  // `fp` param, so we must still emit utls (defaulting to "chrome") whenever
  // Reality is in use; otherwise the outbound is invalid and only plain-TLS
  // protocols (e.g. Trojan) connect.
  if (s.tls.fingerprint || isReality) {
    tls.utls = { enabled: true, fingerprint: s.tls.fingerprint || "chrome" };
  }
  if (isReality) {
    tls.reality = {
      enabled: true,
      public_key: s.tls.publicKey || "",
      short_id: s.tls.shortId || "",
    };
  }
  return tls;
}

function buildTransportBlock(t: TransportSettings): object | null {
  switch (t.type) {
    case "ws":
      return {
        type: "ws",
        path: t.path || "/",
        ...(t.host ? { headers: { Host: t.host } } : {}),
      };
    case "grpc":
      return { type: "grpc", service_name: t.serviceName || "" };
    case "h2":
      return { type: "http", path: t.path || "/", ...(t.host ? { host: [t.host] } : {}) };
    default:
      return null; // tcp / quic -- no transport block
  }
}
