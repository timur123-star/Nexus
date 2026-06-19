// src/core/singbox/configGen.ts
var PROXY_TAG = "proxy";
var DIRECT_TAG = "direct";
var BLOCK_TAG = "block";
var MATCH_KEY = {
  domain: "domain",
  domain_suffix: "domain_suffix",
  domain_keyword: "domain_keyword",
  domain_regex: "domain_regex",
  ip_cidr: "ip_cidr",
  process_name: "process_name"
};
var TARGET_OUTBOUND = {
  proxy: PROXY_TAG,
  direct: DIRECT_TAG,
  block: BLOCK_TAG
};
function generateSingboxConfig(server, opts) {
  if (server.transport.type === "xhttp") {
    throw new Error("\u0422\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442 XHTTP \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u044F\u0434\u0440\u043E\u043C Xray");
  }
  if (server.tls.security === "reality" && server.tls.postQuantum) {
    throw new Error("Post-quantum REALITY \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u044F\u0434\u0440\u043E\u043C Xray");
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
      { type: "block", tag: BLOCK_TAG }
    ],
    route: buildRoute(opts),
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${opts.clashApiPort}`,
        secret: opts.clashSecret
      },
      cache_file: { enabled: true }
    }
  };
}
function buildInbounds(opts) {
  const inbounds = [
    {
      type: "mixed",
      tag: "mixed-in",
      listen: opts.allowLan ? "0.0.0.0" : "127.0.0.1",
      listen_port: opts.mixedPort,
      sniff: true,
      sniff_override_destination: false
    }
  ];
  if (opts.tun.enabled) {
    inbounds.push({
      type: "tun",
      tag: "tun-in",
      interface_name: "nexus-tun",
      // sing-box 1.10+ merged the legacy `inet4_address` / `inet6_address`
      // fields into a single `address` array. The old fields are a FATAL error
      // on 1.11+ ("legacy tun address fields is deprecated … set
      // ENABLE_DEPRECATED_TUN_ADDRESS_X=true"), so the whole VPN/TUN mode failed
      // to start. Use the modern `address` form.
      address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
      auto_route: true,
      strict_route: true,
      stack: opts.tun.stack ?? "system",
      sniff: true,
      mtu: 9e3
    });
  }
  return inbounds;
}
function buildDns(opts) {
  const servers = [
    { tag: "dns-remote", address: opts.dns.remote || "https://1.1.1.1/dns-query", detour: PROXY_TAG },
    { tag: "dns-direct", address: opts.dns.direct || "https://223.5.5.5/dns-query", detour: DIRECT_TAG },
    { tag: "dns-block", address: "rcode://success" }
  ];
  const rules = [{ outbound: "any", server: "dns-direct" }];
  if (opts.fakeIp) {
    servers.push({ tag: "dns-fakeip", address: "fakeip" });
    rules.push({ query_type: ["A", "AAAA"], server: "dns-fakeip" });
  }
  return {
    servers,
    rules,
    final: "dns-remote",
    strategy: "prefer_ipv4",
    independent_cache: true,
    ...opts.fakeIp ? {
      fakeip: { enabled: true, inet4_range: "198.18.0.0/15", inet6_range: "fc00::/18" }
    } : {}
  };
}
function buildRoute(opts) {
  const rules = [
    { action: "sniff" },
    { protocol: "dns", action: "hijack-dns" }
  ];
  if (opts.blockQuic) {
    rules.push({ protocol: "quic", action: "reject" });
  }
  rules.push({ ip_is_private: true, outbound: DIRECT_TAG });
  const custom = buildCustomRules(opts.customRules);
  for (const rule of custom.rules) rules.push(rule);
  if (opts.routingMode === "rule") {
    rules.push(
      { rule_set: "geoip-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-cn", outbound: DIRECT_TAG },
      { rule_set: "geosite-ads", outbound: BLOCK_TAG }
    );
  }
  const baseRuleSets = opts.routingMode === "rule" ? [
    ruleSet("geoip-cn", "geoip", "cn"),
    ruleSet("geosite-cn", "geosite", "cn"),
    ruleSet("geosite-ads", "geosite", "category-ads-all")
  ] : [];
  const rule_set = [...baseRuleSets];
  const seen = new Set(rule_set.map((r) => r.tag));
  for (const rs of custom.ruleSets) {
    const tag = rs.tag;
    if (!seen.has(tag)) {
      seen.add(tag);
      rule_set.push(rs);
    }
  }
  return {
    rules,
    rule_set,
    final: opts.routingMode === "direct" ? DIRECT_TAG : PROXY_TAG,
    auto_detect_interface: true
  };
}
function geoCode(raw) {
  return raw.replace(/^geo(ip|site):/i, "").trim().toLowerCase();
}
function buildCustomRules(rules) {
  if (!rules || rules.length === 0) return { rules: [], ruleSets: [] };
  const out = [];
  const ruleSets = [];
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
function ruleSet(tag, kind, name) {
  const base = kind === "geoip" ? "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set" : "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set";
  return {
    tag,
    type: "remote",
    format: "binary",
    url: `${base}/${kind}-${name}.srs`,
    download_detour: PROXY_TAG
  };
}
function buildMultiplex(mux) {
  if (!mux || !mux.enabled) return null;
  return {
    enabled: true,
    protocol: mux.protocol,
    max_connections: 4,
    min_streams: 4,
    padding: false
  };
}
function buildShadowsocksPlugin(raw) {
  const value = raw?.trim();
  if (!value) return {};
  const semi = value.indexOf(";");
  const name = (semi >= 0 ? value.slice(0, semi) : value).trim();
  const opts = semi >= 0 ? value.slice(semi + 1).trim() : "";
  if (!name) return {};
  return { plugin: name, ...opts ? { plugin_opts: opts } : {} };
}
function buildProxyOutbounds(s, opts) {
  if (s.protocol === "shadowtls") {
    const st = s.shadowtls;
    const detourTag = "proxy-shadowtls";
    const detour = {
      type: "shadowtls",
      tag: detourTag,
      server: s.address,
      server_port: s.port,
      version: st?.version ?? 3,
      // v1 carries no password; v2/v3 require the handshake password.
      ...(st?.version ?? 3) >= 2 && st?.password ? { password: st.password } : {},
      tls: buildShadowtlsTls(s)
    };
    const inner = {
      type: "shadowsocks",
      tag: PROXY_TAG,
      detour: detourTag,
      method: st?.method || "2022-blake3-aes-128-gcm",
      password: st?.ssPassword || ""
    };
    return [detour, inner];
  }
  return [buildOutbound(s, opts)];
}
function buildShadowtlsTls(s) {
  return {
    enabled: true,
    server_name: s.tls.sni || s.address,
    ...s.tls.alpn?.length ? { alpn: s.tls.alpn } : {},
    utls: { enabled: true, fingerprint: s.tls.fingerprint || "chrome" }
  };
}
function buildOutbound(s, opts) {
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
        ...s.flow ? { flow: s.flow } : {},
        ...transport ? { transport } : {},
        ...tls ? { tls } : {},
        // xtls-rprx-vision is incompatible with multiplex in sing-box; emitting
        // both makes the outbound invalid, so drop mux whenever a flow is set.
        ...multiplex && !s.flow ? { multiplex } : {}
      };
    case "vmess":
      return {
        type: "vmess",
        ...common,
        uuid: s.uuid,
        alter_id: s.alterId ?? 0,
        security: s.method || "auto",
        ...transport ? { transport } : {},
        ...tls ? { tls } : {},
        ...multiplex ? { multiplex } : {}
      };
    case "trojan":
      return {
        type: "trojan",
        ...common,
        password: s.password,
        ...transport ? { transport } : {},
        ...tls ? { tls } : {},
        ...multiplex ? { multiplex } : {}
      };
    case "shadowsocks":
      return {
        type: "shadowsocks",
        ...common,
        method: s.method,
        password: s.password,
        ...buildShadowsocksPlugin(s.extra?.obfs),
        ...multiplex ? { multiplex } : {}
      };
    case "hysteria2":
      return {
        type: "hysteria2",
        ...common,
        password: s.password,
        ...s.extra?.obfs ? { obfs: { type: s.extra.obfs, password: s.extra.obfsPassword } } : {},
        ...tls ? { tls } : { tls: { enabled: true } }
      };
    case "tuic":
      return {
        type: "tuic",
        ...common,
        uuid: s.uuid,
        password: s.password,
        congestion_control: s.extra?.congestionControl || "bbr",
        udp_relay_mode: s.extra?.udpRelayMode || "native",
        ...tls ? { tls } : { tls: { enabled: true } }
      };
    case "hysteria":
      return {
        type: "hysteria",
        ...common,
        ...s.extra?.auth || s.password ? { auth_str: s.extra?.auth || s.password } : {},
        // sing-box REQUIRES up_mbps/down_mbps for hysteria v1 and exits FATAL
        // ("missing upload speed") when either is absent or 0. Most share links
        // omit them, so fall back to sane non-zero defaults instead of crashing
        // the core. The server enforces its own caps; these are just the
        // client's advertised estimate.
        up_mbps: s.extra?.upMbps && s.extra.upMbps > 0 ? s.extra.upMbps : 50,
        down_mbps: s.extra?.downMbps && s.extra.downMbps > 0 ? s.extra.downMbps : 200,
        ...s.extra?.obfs ? { obfs: s.extra.obfs } : {},
        ...tls ? { tls } : { tls: { enabled: true } }
      };
    case "anytls":
      return {
        type: "anytls",
        ...common,
        password: s.password,
        ...tls ? { tls } : { tls: { enabled: true } }
      };
    case "socks":
      return {
        type: "socks",
        ...common,
        version: "5",
        ...s.username ? { username: s.username } : {},
        ...s.password ? { password: s.password } : {}
      };
    case "http":
      return {
        type: "http",
        ...common,
        ...s.username ? { username: s.username } : {},
        ...s.password ? { password: s.password } : {},
        ...s.tls.enabled ? {
          tls: {
            enabled: true,
            ...s.tls.sni ? { server_name: s.tls.sni } : {},
            ...s.tls.allowInsecure ? { insecure: true } : {}
          }
        } : {}
      };
    case "wireguard": {
      const wg = s.wireguard;
      return {
        type: "wireguard",
        ...common,
        local_address: wg?.localAddress ?? ["172.16.0.2/32"],
        private_key: wg?.privateKey ?? "",
        peer_public_key: wg?.peerPublicKey ?? "",
        ...wg?.preSharedKey ? { pre_shared_key: wg.preSharedKey } : {},
        ...wg?.reserved && wg.reserved.length ? { reserved: wg.reserved } : {},
        ...wg?.mtu ? { mtu: wg.mtu } : {}
      };
    }
    case "ssh": {
      const ssh = s.ssh;
      return {
        type: "ssh",
        ...common,
        user: ssh?.user || "root",
        ...ssh?.password ? { password: ssh.password } : {},
        ...ssh?.privateKey ? { private_key: ssh.privateKey } : {},
        ...ssh?.privateKeyPassphrase ? { private_key_passphrase: ssh.privateKeyPassphrase } : {}
      };
    }
    case "tor":
      return { type: "tor", tag: PROXY_TAG };
    case "shadowtls":
      throw new Error("shadowtls handled by buildProxyOutbounds");
  }
}
function buildTlsBlock(s) {
  if (!s.tls.enabled) return null;
  const isReality = s.tls.security === "reality";
  const tls = {
    enabled: true,
    server_name: s.tls.sni || s.address,
    insecure: !!s.tls.allowInsecure
  };
  if (s.tls.alpn?.length) tls.alpn = s.tls.alpn;
  if (s.tls.fingerprint || isReality) {
    tls.utls = { enabled: true, fingerprint: s.tls.fingerprint || "chrome" };
  }
  if (isReality) {
    if (!(s.tls.publicKey ?? "").trim()) {
      throw new Error(
        `REALITY server "${s.name || s.address}" is missing its public key (pbk) \u2014 re-import the share link.`
      );
    }
    tls.reality = {
      enabled: true,
      public_key: s.tls.publicKey || "",
      short_id: s.tls.shortId || ""
    };
  }
  return tls;
}
function buildTransportBlock(t) {
  switch (t.type) {
    case "ws":
      return {
        type: "ws",
        path: t.path || "/",
        ...t.host ? { headers: { Host: t.host } } : {}
      };
    case "grpc":
      return { type: "grpc", service_name: t.serviceName || "" };
    case "h2":
    case "http":
      return { type: "http", path: t.path || "/", ...t.host ? { host: [t.host] } : {} };
    default:
      return null;
  }
}

// src/core/xray/configGen.ts
var PROXY_TAG2 = "proxy";
var DIRECT_TAG2 = "direct";
var BLOCK_TAG2 = "block";
var FRAGMENT_TAG = "fragment";
function generateXrayConfig(server, opts) {
  if (server.protocol === "hysteria2" || server.protocol === "hysteria" || server.protocol === "tuic" || server.protocol === "anytls" || server.protocol === "shadowtls" || server.protocol === "ssh" || server.protocol === "tor") {
    throw new Error(
      `\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B ${server.protocol} \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u044F\u0434\u0440\u043E\u043C sing-box`
    );
  }
  const listen = opts.allowLan ? "0.0.0.0" : "127.0.0.1";
  const socksPort = opts.socksPort ?? opts.mixedPort + 1;
  const sniffing = { enabled: true, destOverride: ["http", "tls", "quic"] };
  const fragmentEnabled = !!opts.fragment?.enabled;
  const outbounds = [
    buildXrayOutbound(server, { mux: opts.mux ?? null, fragment: fragmentEnabled }),
    { tag: DIRECT_TAG2, protocol: "freedom" },
    { tag: BLOCK_TAG2, protocol: "blackhole" }
  ];
  if (fragmentEnabled && opts.fragment) {
    outbounds.push({
      tag: FRAGMENT_TAG,
      protocol: "freedom",
      settings: {
        fragment: {
          packets: opts.fragment.packets || "tlshello",
          length: opts.fragment.length || "10-20",
          interval: opts.fragment.interval || "10-20"
        }
      }
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
        sniffing
      },
      {
        tag: "socks-in",
        listen,
        port: socksPort,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
        sniffing
      }
    ],
    outbounds,
    routing: buildXrayRouting(opts.routingMode, opts.customRules, opts.blockQuic)
  };
}
function buildXrayOutbound(s, extra) {
  if (s.protocol === "wireguard") {
    const wg = s.wireguard;
    return {
      tag: PROXY_TAG2,
      protocol: "wireguard",
      settings: {
        secretKey: wg?.privateKey ?? "",
        address: wg?.localAddress ?? ["172.16.0.2/32"],
        peers: [
          {
            publicKey: wg?.peerPublicKey ?? "",
            endpoint: `${s.address}:${s.port}`,
            ...wg?.preSharedKey ? { preSharedKey: wg.preSharedKey } : {}
          }
        ],
        ...wg?.reserved && wg.reserved.length ? { reserved: wg.reserved } : {},
        ...wg?.mtu ? { mtu: wg.mtu } : {}
      }
    };
  }
  if (s.protocol === "socks") {
    return {
      tag: PROXY_TAG2,
      protocol: "socks",
      settings: {
        servers: [
          {
            address: s.address,
            port: s.port,
            ...s.username || s.password ? { users: [{ user: s.username ?? "", pass: s.password ?? "" }] } : {}
          }
        ]
      }
    };
  }
  if (s.protocol === "http") {
    return {
      tag: PROXY_TAG2,
      protocol: "http",
      settings: {
        servers: [
          {
            address: s.address,
            port: s.port,
            ...s.username || s.password ? { users: [{ user: s.username ?? "", pass: s.password ?? "" }] } : {}
          }
        ]
      },
      // An `https://` proxy is reached over a TLS stream.
      ...s.tls.enabled ? {
        streamSettings: {
          network: "tcp",
          security: "tls",
          tlsSettings: {
            serverName: s.tls.sni || s.address,
            allowInsecure: !!s.tls.allowInsecure
          }
        }
      } : {}
    };
  }
  const streamSettings = buildXrayStream(s, extra.fragment);
  const visionFlow = s.protocol === "vless" && !!s.flow;
  const muxBlock = extra.mux?.enabled && !visionFlow ? { mux: { enabled: true, concurrency: 8 } } : {};
  switch (s.protocol) {
    case "vless":
      return {
        tag: PROXY_TAG2,
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: s.address,
              port: s.port,
              users: [{ id: s.uuid, encryption: "none", flow: s.flow || "" }]
            }
          ]
        },
        streamSettings,
        ...muxBlock
      };
    case "vmess":
      return {
        tag: PROXY_TAG2,
        protocol: "vmess",
        settings: {
          vnext: [
            {
              address: s.address,
              port: s.port,
              users: [{ id: s.uuid, alterId: s.alterId ?? 0, security: s.method || "auto" }]
            }
          ]
        },
        streamSettings,
        ...muxBlock
      };
    case "trojan":
      return {
        tag: PROXY_TAG2,
        protocol: "trojan",
        settings: { servers: [{ address: s.address, port: s.port, password: s.password }] },
        streamSettings,
        ...muxBlock
      };
    case "shadowsocks":
      return {
        tag: PROXY_TAG2,
        protocol: "shadowsocks",
        settings: {
          servers: [{ address: s.address, port: s.port, method: s.method, password: s.password }]
        },
        streamSettings,
        ...muxBlock
      };
    default:
      throw new Error(`Unsupported protocol for xray: ${s.protocol}`);
  }
}
function buildXrayStream(s, fragment) {
  const network = mapNetwork(s.transport.type);
  const ss = { network };
  switch (network) {
    case "ws":
      ss.wsSettings = {
        path: s.transport.path || "/",
        ...s.transport.host ? { headers: { Host: s.transport.host } } : {}
      };
      break;
    case "grpc":
      ss.grpcSettings = { serviceName: s.transport.serviceName || "" };
      break;
    case "http":
      ss.httpSettings = {
        path: s.transport.path || "/",
        ...s.transport.host ? { host: [s.transport.host] } : {}
      };
      break;
    case "xhttp":
      ss.xhttpSettings = {
        path: s.transport.path || "/",
        ...s.transport.host ? { host: s.transport.host } : {},
        mode: s.transport.mode || "auto",
        ...s.transport.xhttpExtra ? { extra: s.transport.xhttpExtra } : {}
      };
      break;
    default:
      break;
  }
  if (s.tls.enabled && s.tls.security === "reality") {
    if (!(s.tls.publicKey ?? "").trim()) {
      throw new Error(
        `REALITY server "${s.name || s.address}" is missing its public key (pbk) \u2014 re-import the share link.`
      );
    }
    ss.security = "reality";
    ss.realitySettings = {
      serverName: s.tls.sni || s.address,
      publicKey: s.tls.publicKey || "",
      shortId: s.tls.shortId || "",
      fingerprint: s.tls.fingerprint || "chrome",
      spiderX: s.tls.spiderX || "",
      // Post-quantum REALITY (ML-DSA-65) — required to handshake with PQ nodes.
      ...s.tls.postQuantum ? { mldsa65Verify: s.tls.postQuantum } : {}
    };
  } else if (s.tls.enabled) {
    ss.security = "tls";
    ss.tlsSettings = {
      serverName: s.tls.sni || s.address,
      allowInsecure: !!s.tls.allowInsecure,
      ...s.tls.alpn && s.tls.alpn.length ? { alpn: s.tls.alpn } : {},
      ...s.tls.fingerprint ? { fingerprint: s.tls.fingerprint } : {}
    };
  } else {
    ss.security = "none";
  }
  if (fragment) {
    ss.sockopt = { dialerProxy: FRAGMENT_TAG };
  }
  return ss;
}
function mapNetwork(t) {
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
function buildXrayCustomRule(r) {
  const value = r.value.trim();
  if (!value) return null;
  const outboundTag = r.target === "proxy" ? PROXY_TAG2 : r.target === "direct" ? DIRECT_TAG2 : BLOCK_TAG2;
  switch (r.match) {
    case "domain":
      return { type: "field", domain: [`full:${value}`], outboundTag };
    case "domain_suffix":
      return { type: "field", domain: [`domain:${value}`], outboundTag };
    case "domain_keyword":
      return { type: "field", domain: [value], outboundTag };
    case "domain_regex":
      return { type: "field", domain: [`regexp:${value}`], outboundTag };
    case "ip_cidr":
      return { type: "field", ip: [value], outboundTag };
    case "geoip":
      return { type: "field", ip: [`geoip:${value.replace(/^geoip:/i, "")}`], outboundTag };
    case "geosite":
      return {
        type: "field",
        domain: [`geosite:${value.replace(/^geosite:/i, "")}`],
        outboundTag
      };
    case "port": {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { type: "field", port: String(port), outboundTag };
    }
    case "process_name":
      return null;
    // Xray has no process-based routing
    default:
      return null;
  }
}
function buildXrayRouting(mode, customRules, blockQuic) {
  const rules = [];
  if (blockQuic) {
    rules.push({ type: "field", network: "udp", port: 443, outboundTag: BLOCK_TAG2 });
  }
  for (const r of customRules ?? []) {
    const mapped = buildXrayCustomRule(r);
    if (mapped) rules.push(mapped);
  }
  if (mode === "direct") {
    rules.push({ type: "field", network: "tcp,udp", outboundTag: DIRECT_TAG2 });
    return { domainStrategy: "AsIs", rules };
  }
  if (mode === "global") {
    rules.push({ type: "field", network: "tcp,udp", outboundTag: PROXY_TAG2 });
    return { domainStrategy: "IPIfNonMatch", rules };
  }
  rules.push(
    { type: "field", domain: ["geosite:category-ads-all"], outboundTag: BLOCK_TAG2 },
    { type: "field", domain: ["geosite:cn"], outboundTag: DIRECT_TAG2 },
    { type: "field", ip: ["geoip:cn", "geoip:private"], outboundTag: DIRECT_TAG2 },
    { type: "field", network: "tcp,udp", outboundTag: PROXY_TAG2 }
  );
  return { domainStrategy: "IPIfNonMatch", rules };
}

// audit_gen.ts
var baseOpts = {
  mixedPort: 2080,
  clashApiPort: 9090,
  clashSecret: "testsecret",
  routingMode: "rule",
  tun: { enabled: false, stack: "system" },
  allowLan: false,
  fakeIp: true,
  dns: { remote: "https://1.1.1.1/dns-query", direct: "https://223.5.5.5/dns-query" },
  customRules: [],
  blockQuic: false,
  mux: { enabled: false, protocol: "smux" },
  fragment: { enabled: false, packets: "tlshello", length: "10-20", interval: "10-20" }
};
var trojan = {
  id: "t1",
  name: "DESKTOP Trojan",
  protocol: "trojan",
  address: "trojan.example.com",
  port: 443,
  password: "pw123",
  transport: { type: "tcp" },
  tls: { enabled: true, security: "tls", sni: "trojan.example.com" },
  tags: [],
  favorite: false,
  createdAt: 0
};
var reality = {
  id: "r1",
  name: "DESKTOP Reality",
  protocol: "vless",
  address: "reality.example.com",
  port: 443,
  uuid: "11111111-2222-3333-4444-555555555555",
  flow: "xtls-rprx-vision",
  transport: { type: "tcp" },
  tls: { enabled: true, security: "reality", sni: "www.microsoft.com", publicKey: "PUBKEYBASE64", shortId: "abcd", fingerprint: "chrome" },
  tags: [],
  favorite: false,
  createdAt: 0
};
function dump(label, fn) {
  console.log("\n===== " + label + " =====");
  try {
    const cfg = fn();
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.log("THREW: " + (e instanceof Error ? e.message : String(e)));
  }
}
dump("sing-box / Trojan / rule", () => generateSingboxConfig(trojan, baseOpts));
dump("sing-box / Reality / rule", () => generateSingboxConfig(reality, baseOpts));
dump("sing-box / Trojan / global", () => generateSingboxConfig(trojan, { ...baseOpts, routingMode: "global" }));
dump("xray / Reality / rule", () => generateXrayConfig(reality, { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule", allowLan: false, customRules: [], blockQuic: false, fragment: null, mux: null }));
dump("xray / Trojan / rule", () => generateXrayConfig(trojan, { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule", allowLan: false, customRules: [], blockQuic: false, fragment: null, mux: null }));
