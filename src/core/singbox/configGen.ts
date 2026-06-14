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

// Plain inline matchers map straight onto a sing-box route-rule field. geoip /
// geosite are handled separately because modern sing-box expresses them through
// generated rule-sets rather than an inline field.
const MATCH_KEY: Record<
  Exclude<RoutingRuleMatch, "geoip" | "geosite" | "port">,
  string
> = {
  domain: "domain",
  domain_suffix: "domain_suffix",
  domain_keyword: "domain_keyword",
  domain_regex: "domain_regex",
  ip_cidr: "ip_cidr",
  process_name: "process_name",
};

const TARGET_OUTBOUND: Record<RoutingTarget, string> = {
  proxy: PROXY_TAG,
  direct: DIRECT_TAG,
  block: BLOCK_TAG,
};

export function generateSingboxConfig(server: ServerProfile, opts: GenOptions): object {
  // sing-box has no XHTTP transport and no post-quantum (ML-DSA-65) REALITY
  // client. Such nodes must run on Xray-core; refuse here so the connection
  // store transparently falls back instead of emitting a silently-broken config.
  if (server.transport.type === "xhttp") {
    throw new Error("Транспорт XHTTP поддерживается только ядром Xray");
  }
  if (server.tls.security === "reality" && server.tls.postQuantum) {
    throw new Error("Post-quantum REALITY поддерживается только ядром Xray");
  }
  const inbounds = buildInbounds(opts);
  const proxyOutbounds = buildProxyOutbounds(server, opts);

  return {
    log: { level: opts.logLevel ?? "info", timestamp: true },
    dns: buildDns(opts),
    inbounds,
    outbounds: [
      ...proxyOutbounds,
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

  // User rules win over the bundled geo rules. geoip / geosite matches also
  // contribute their own remote rule-sets, collected here for the route block.
  const custom = buildCustomRules(opts.customRules);
  for (const rule of custom.rules) rules.push(rule);

  if (opts.routingMode === "rule") {
    rules.push(
      { rule_set: "geoip-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-ads", outbound: BLOCK_TAG },
    );
  }

  const baseRuleSets =
    opts.routingMode === "rule"
      ? [
          ruleSet("geoip-cn", "geoip", "cn"),
          ruleSet("geosite-cn", "geosite", "cn"),
          ruleSet("geosite-ads", "geosite", "category-ads-all"),
        ]
      : [];

  // Dedupe rule-sets by tag so a base set and a user set never collide.
  const rule_set = [...baseRuleSets];
  const seen = new Set(rule_set.map((r) => (r as { tag: string }).tag));
  for (const rs of custom.ruleSets) {
    const tag = (rs as { tag: string }).tag;
    if (!seen.has(tag)) {
      seen.add(tag);
      rule_set.push(rs);
    }
  }

  return {
    rules,
    rule_set,
    final: opts.routingMode === "direct" ? DIRECT_TAG : PROXY_TAG,
    auto_detect_interface: true,
  };
}

/** Strip a leading "geoip:" / "geosite:" prefix and normalise the geo code. */
function geoCode(raw: string): string {
  return raw.replace(/^geo(ip|site):/i, "").trim().toLowerCase();
}

/**
 * Turn user rules into sing-box route rule objects (skips empty values).
 * geoip / geosite matches are expressed via generated remote rule-sets, so we
 * return both the route rules and the rule-set definitions they reference.
 */
function buildCustomRules(rules: RoutingRule[] | undefined): {
  rules: object[];
  ruleSets: object[];
} {
  if (!rules || rules.length === 0) return { rules: [], ruleSets: [] };
  const out: object[] = [];
  const ruleSets: object[] = [];
  for (const r of rules) {
    const value = r.value.trim();
    if (!value) continue;
    const outbound = TARGET_OUTBOUND[r.target];
    if (r.match === "geoip" || r.match === "geosite") {
      const kind = r.match === "geoip" ? "geoip" : "geosite";
      const code = geoCode(value);
      if (!code) continue;
      const tag = `${kind}-${code}`;
      out.push({ rule_set: tag, outbound });
      ruleSets.push(ruleSet(tag, kind, code));
    } else if (r.match === "port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      out.push({ port: [port], outbound });
    } else {
      out.push({ [MATCH_KEY[r.match]]: [value], outbound });
    }
  }
  return { rules: out, ruleSets };
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

/**
 * Shadowsocks SIP002 carries an optional plugin in the form
 * "name;opt=val;opt=val" (the parser keeps this raw string in extra.obfs).
 * sing-box wants it split into a `plugin` name and a `plugin_opts` string, so
 * a server that needs simple-obfs / v2ray-plugin actually negotiates instead
 * of silently connecting plugin-less and failing.
 */
function buildShadowsocksPlugin(raw: string | undefined): object {
  const value = raw?.trim();
  if (!value) return {};
  const semi = value.indexOf(";");
  const name = (semi >= 0 ? value.slice(0, semi) : value).trim();
  const opts = semi >= 0 ? value.slice(semi + 1).trim() : "";
  if (!name) return {};
  return { plugin: name, ...(opts ? { plugin_opts: opts } : {}) };
}

/**
 * Build the proxy outbound(s) for a server. Most protocols emit a single
 * outbound tagged "proxy"; ShadowTLS emits a chain (a `shadowtls` detour plus
 * the inner `shadowsocks` outbound that dials through it).
 */
function buildProxyOutbounds(s: ServerProfile, opts: GenOptions): object[] {
  if (s.protocol === "shadowtls") {
    const st = s.shadowtls;
    const detourTag = "proxy-shadowtls";
    const detour: Record<string, unknown> = {
      type: "shadowtls",
      tag: detourTag,
      server: s.address,
      server_port: s.port,
      version: st?.version ?? 3,
      // v1 carries no password; v2/v3 require the handshake password.
      ...((st?.version ?? 3) >= 2 && st?.password ? { password: st.password } : {}),
      tls: buildShadowtlsTls(s),
    };
    const inner = {
      type: "shadowsocks",
      tag: PROXY_TAG,
      detour: detourTag,
      method: st?.method || "2022-blake3-aes-128-gcm",
      password: st?.ssPassword || "",
    };
    return [detour, inner];
  }
  return [buildOutbound(s, opts)];
}

/** TLS camouflage block for a ShadowTLS detour (always TLS, utls required). */
function buildShadowtlsTls(s: ServerProfile): object {
  return {
    enabled: true,
    server_name: s.tls.sni || s.address,
    ...(s.tls.alpn?.length ? { alpn: s.tls.alpn } : {}),
    utls: { enabled: true, fingerprint: s.tls.fingerprint || "chrome" },
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
        // xtls-rprx-vision is incompatible with multiplex in sing-box; emitting
        // both makes the outbound invalid, so drop mux whenever a flow is set.
        ...(multiplex && !s.flow ? { multiplex } : {}),
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
        ...buildShadowsocksPlugin(s.extra?.obfs),
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
    case "hysteria":
      return {
        type: "hysteria",
        ...common,
        ...(s.extra?.auth || s.password
          ? { auth_str: s.extra?.auth || s.password }
          : {}),
        ...(s.extra?.upMbps ? { up_mbps: s.extra.upMbps } : {}),
        ...(s.extra?.downMbps ? { down_mbps: s.extra.downMbps } : {}),
        ...(s.extra?.obfs ? { obfs: s.extra.obfs } : {}),
        ...(tls ? { tls } : { tls: { enabled: true } }),
      };
    case "anytls":
      return {
        type: "anytls",
        ...common,
        password: s.password,
        ...(tls ? { tls } : { tls: { enabled: true } }),
      };
    case "socks":
      // sing-box socks outbound does not support multiplex/TLS.
      return {
        type: "socks",
        ...common,
        version: "5",
        ...(s.username ? { username: s.username } : {}),
        ...(s.password ? { password: s.password } : {}),
      };
    case "wireguard": {
      const wg = s.wireguard;
      return {
        type: "wireguard",
        ...common,
        local_address: wg?.localAddress ?? ["172.16.0.2/32"],
        private_key: wg?.privateKey ?? "",
        peer_public_key: wg?.peerPublicKey ?? "",
        ...(wg?.preSharedKey ? { pre_shared_key: wg.preSharedKey } : {}),
        ...(wg?.reserved && wg.reserved.length ? { reserved: wg.reserved } : {}),
        ...(wg?.mtu ? { mtu: wg.mtu } : {}),
      };
    }
    case "ssh": {
      const ssh = s.ssh;
      return {
        type: "ssh",
        ...common,
        user: ssh?.user || "root",
        ...(ssh?.password ? { password: ssh.password } : {}),
        ...(ssh?.privateKey ? { private_key: ssh.privateKey } : {}),
        ...(ssh?.privateKeyPassphrase
          ? { private_key_passphrase: ssh.privateKeyPassphrase }
          : {}),
      };
    }
    case "tor":
      // Embedded Tor outbound. Requires a sing-box build compiled with Tor
      // support; the camouflage host/port are not used by the engine.
      return { type: "tor", tag: PROXY_TAG };
    case "shadowtls":
      // ShadowTLS is emitted as a chain by buildProxyOutbounds; this branch is
      // unreachable but kept for switch exhaustiveness.
      throw new Error("shadowtls handled by buildProxyOutbounds");
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
    case "http":
      return { type: "http", path: t.path || "/", ...(t.host ? { host: [t.host] } : {}) };
    default:
      return null; // tcp / quic -- no transport block
  }
}
