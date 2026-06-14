/**
 * Per-protocol share-link parsers.
 *
 * Each `parseX` takes a single share link and returns a `ServerProfile`.
 * Common defaults (id, tags, timestamps) are filled by `finalize`.
 */
import type {
  Protocol,
  Security,
  ServerProfile,
  Transport,
  TransportSettings,
  TlsSettings,
} from "../types";
import { ParseError, decodeBase64, decodeRemark, makeId, parseQuery } from "./util";

/** Map a variety of "network"/"type" spellings to our Transport union. */
function normalizeTransport(raw: string | undefined): Transport {
  switch ((raw || "tcp").toLowerCase()) {
    case "ws":
    case "websocket":
      return "ws";
    case "grpc":
      return "grpc";
    case "h2":
    case "http":
      return "h2";
    case "quic":
      return "quic";
    // XHTTP (a.k.a. the former "splithttp") is an Xray-core transport used by
    // modern 3x-ui panels. Without this case it silently fell back to "tcp" and
    // the generated outbound never completed its handshake — only plain TCP /
    // Trojan nodes connected from such subscriptions.
    case "xhttp":
    case "splithttp":
      return "xhttp";
    default:
      return "tcp";
  }
}

function normalizeSecurity(raw: string | undefined): Security {
  const v = (raw || "none").toLowerCase();
  if (v === "reality") return "reality";
  if (v === "tls" || v === "xtls") return "tls";
  return "none";
}

function buildTransport(q: Record<string, string>, net: Transport): TransportSettings {
  const t: TransportSettings = { type: net };
  if (q.path) t.path = q.path;
  if (q.host) t.host = q.host;
  if (q.serviceName) t.serviceName = q.serviceName;
  if (net === "grpc" && q.serviceName === undefined && q.path) t.serviceName = q.path;
  if (net === "xhttp") {
    if (q.mode) t.mode = q.mode;
    // `extra` is a URL-encoded JSON blob (e.g. {"xPaddingBytes":"100-1000"}).
    // Some panels instead pass discrete params like `x_padding_bytes`.
    const extra: Record<string, unknown> = {};
    if (q.extra) {
      try {
        Object.assign(extra, JSON.parse(q.extra));
      } catch {
        /* ignore malformed extra */
      }
    }
    if (q.x_padding_bytes && extra.xPaddingBytes === undefined) {
      extra.xPaddingBytes = q.x_padding_bytes;
    }
    if (Object.keys(extra).length > 0) t.xhttpExtra = extra;
  }
  return t;
}

function buildTls(q: Record<string, string>, security: Security): TlsSettings {
  const tls: TlsSettings = {
    enabled: security !== "none",
    security,
  };
  if (q.sni || q.peer) tls.sni = q.sni || q.peer;
  if (q.fp) tls.fingerprint = q.fp;
  if (q.alpn) tls.alpn = q.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  if (q.allowInsecure === "1" || q.insecure === "1") tls.allowInsecure = true;
  if (security === "reality") {
    tls.publicKey = q.pbk;
    tls.shortId = q.sid;
    tls.spiderX = q.spx;
    // Post-quantum REALITY (ML-DSA-65). The server advertises `pqv` in the
    // share link; dropping it makes the handshake fail against PQ-enabled nodes.
    if (q.pqv) tls.postQuantum = q.pqv;
  }
  return tls;
}

/** Fill protocol-agnostic defaults to produce a complete ServerProfile. */
function finalize(
  partial: Omit<ServerProfile, "id" | "tags" | "favorite" | "createdAt" | "latencyMs">,
  rawLink: string,
): ServerProfile {
  return {
    ...partial,
    id: makeId(rawLink),
    tags: [],
    favorite: false,
    latencyMs: null,
    createdAt: 0, // stamped by the store on import (Date.now unavailable in tests)
  };
}

export function parseVless(link: string): ServerProfile {
  const u = safeUrl(link, "vless");
  if (!u.username) throw new ParseError("vless: missing uuid", link);
  const q = parseQuery(u.search);
  const net = normalizeTransport(q.type);
  const security = normalizeSecurity(q.security);
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "vless",
      address: u.hostname,
      port: parsePort(u.port),
      uuid: decodeURIComponent(u.username),
      flow: q.flow || undefined,
      transport: buildTransport(q, net),
      tls: buildTls(q, security),
    },
    link,
  );
}

export function parseTrojan(link: string): ServerProfile {
  const u = safeUrl(link, "trojan");
  if (!u.username) throw new ParseError("trojan: missing password", link);
  const q = parseQuery(u.search);
  const net = normalizeTransport(q.type);
  // Trojan defaults to TLS unless explicitly told otherwise.
  const security = normalizeSecurity(q.security || "tls");
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "trojan",
      address: u.hostname,
      port: parsePort(u.port),
      password: decodeURIComponent(u.username),
      transport: buildTransport(q, net),
      tls: buildTls(q, security),
    },
    link,
  );
}

export function parseVmess(link: string): ServerProfile {
  const body = link.slice("vmess://".length);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(decodeBase64(body));
  } catch {
    throw new ParseError("vmess: payload is not valid base64-JSON", link);
  }
  const g = (k: string): string => (json[k] === undefined ? "" : String(json[k]));
  const address = g("add");
  const uuid = g("id");
  if (!address) throw new ParseError("vmess: missing address (add)", link);
  if (!uuid) throw new ParseError("vmess: missing uuid (id)", link);
  const net = normalizeTransport(g("net"));
  const security = normalizeSecurity(g("tls"));
  const transport = buildTransport(
    { path: g("path"), host: g("host"), serviceName: g("path") },
    net,
  );
  const tls = buildTls({ sni: g("sni") || g("host"), alpn: g("alpn"), fp: g("fp") }, security);
  return finalize(
    {
      name: g("ps") || `${address}:${g("port")}`,
      protocol: "vmess",
      address,
      port: parsePort(g("port")),
      uuid,
      alterId: Number(g("aid")) || 0,
      method: g("scy") || "auto",
      transport,
      tls,
    },
    link,
  );
}

export function parseShadowsocks(link: string): ServerProfile {
  // Two encodings:
  //   ss://base64(method:password@host:port)#tag        (legacy)
  //   ss://base64(method:password)@host:port#tag         (SIP002)
  const hashIdx = link.indexOf("#");
  const remark = hashIdx >= 0 ? decodeRemark(link.slice(hashIdx), "") : "";
  const core = (hashIdx >= 0 ? link.slice(0, hashIdx) : link).slice("ss://".length);

  let method = "";
  let password = "";
  let host = "";
  let port = 0;
  let pluginQuery: Record<string, string> = {};

  if (core.includes("@")) {
    // SIP002: userinfo may be base64 or plain.
    const at = core.lastIndexOf("@");
    const userinfo = core.slice(0, at);
    const hostPart = core.slice(at + 1);
    const decoded = userinfo.includes(":") ? userinfo : decodeBase64(userinfo);
    [method, password] = splitFirst(decoded, ":");
    const qIdx = hostPart.indexOf("?");
    const hp = qIdx >= 0 ? hostPart.slice(0, qIdx) : hostPart;
    if (qIdx >= 0) pluginQuery = parseQuery(hostPart.slice(qIdx));
    [host, port] = splitHostPort(hp);
  } else {
    // Legacy: whole thing base64.
    const decoded = decodeBase64(core);
    const at = decoded.lastIndexOf("@");
    if (at < 0) throw new ParseError("ss: malformed legacy payload", link);
    [method, password] = splitFirst(decoded.slice(0, at), ":");
    [host, port] = splitHostPort(decoded.slice(at + 1));
  }

  if (!host || !port || !Number.isInteger(port)) {
    throw new ParseError("ss: missing or invalid host/port", link);
  }

  return finalize(
    {
      name: remark || `${host}:${port}`,
      protocol: "shadowsocks",
      address: host,
      port,
      method,
      password,
      transport: { type: "tcp" },
      tls: { enabled: false, security: "none" },
      extra: pluginQuery.plugin ? { obfs: pluginQuery.plugin } : undefined,
    },
    link,
  );
}

export function parseHysteria2(link: string): ServerProfile {
  const normalized = link.replace(/^hy2:\/\//, "hysteria2://");
  const u = safeUrl(normalized, "hysteria2");
  const q = parseQuery(u.search);
  const security: Security = "tls";
  const tls = buildTls({ sni: q.sni, alpn: q.alpn, insecure: q.insecure, fp: q.fp }, security);
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "hysteria2",
      address: u.hostname,
      port: parsePort(u.port),
      password: decodeURIComponent(u.username || u.password || q.auth || ""),
      transport: { type: "quic" },
      tls,
      extra: {
        obfs: q.obfs,
        obfsPassword: q["obfs-password"],
      },
    },
    link,
  );
}

export function parseTuic(link: string): ServerProfile {
  const u = safeUrl(link, "tuic");
  const q = parseQuery(u.search);
  const tls = buildTls({ sni: q.sni, alpn: q.alpn, insecure: q.allow_insecure }, "tls");
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "tuic",
      address: u.hostname,
      port: parsePort(u.port),
      uuid: decodeURIComponent(u.username || "") || q.uuid || "",
      password: decodeURIComponent(u.password || "") || q.password || "",
      transport: { type: "quic" },
      tls,
      extra: {
        congestionControl: q.congestion_control,
        udpRelayMode: q.udp_relay_mode,
      },
    },
    link,
  );
}

export function parseHysteria(link: string): ServerProfile {
  // Hysteria v1 single-port: hysteria://host:port?auth=...&peer=sni&insecure=1
  //   &upmbps=...&downmbps=...&obfs=...&protocol=udp#name
  const u = safeUrl(link, "hysteria");
  const q = parseQuery(u.search);
  const tls = buildTls(
    { sni: q.peer || q.sni, alpn: q.alpn, insecure: q.insecure || q.allowInsecure },
    "tls",
  );
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "hysteria",
      address: u.hostname,
      port: parsePort(u.port),
      password: decodeURIComponent(u.username || ""),
      transport: { type: "quic" },
      tls,
      extra: {
        auth: q.auth || q.auth_str || decodeURIComponent(u.username || ""),
        obfs: q.obfs,
        upMbps: q.upmbps ? Number(q.upmbps) : undefined,
        downMbps: q.downmbps ? Number(q.downmbps) : undefined,
      },
    },
    link,
  );
}

export function parseAnytls(link: string): ServerProfile {
  // anytls://password@host:port?sni=...&insecure=1#name
  const u = safeUrl(link, "anytls");
  if (!u.username) throw new ParseError("anytls: missing password", link);
  const q = parseQuery(u.search);
  const tls = buildTls(
    { sni: q.sni || q.peer, alpn: q.alpn, insecure: q.insecure || q.allowInsecure },
    "tls",
  );
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "anytls",
      address: u.hostname,
      port: parsePort(u.port),
      password: decodeURIComponent(u.username),
      transport: { type: "tcp" },
      tls,
    },
    link,
  );
}

export function parseShadowtls(link: string): ServerProfile {
  // ShadowTLS v2/v3 wrapping an inner Shadowsocks connection.
  //   shadowtls://method:ssPassword@host:port?password=<handshake>&version=3
  //     &sni=example.com&insecure=0#name
  // The userinfo carries the inner SS cipher + password; query carries the
  // ShadowTLS handshake password / version / TLS camouflage SNI.
  const u = safeUrl(link, "shadowtls");
  if (!u.username) throw new ParseError("shadowtls: missing inner SS method", link);
  const q = parseQuery(u.search);
  const method = decodeURIComponent(u.username);
  const ssPassword = decodeURIComponent(u.password || q.ss_password || "");
  const version = Number(q.version || q.v || 3) || 3;
  const handshake = decodeURIComponent(q.password || q.shadowtls_password || "");
  const tls = buildTls(
    { sni: q.sni || q.host, alpn: q.alpn, insecure: q.insecure || q.allowInsecure, fp: q.fp },
    "tls",
  );
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "shadowtls",
      address: u.hostname,
      port: parsePort(u.port),
      transport: { type: "tcp" },
      tls,
      shadowtls: { version, password: handshake, method, ssPassword },
    },
    link,
  );
}

export function parseSsh(link: string): ServerProfile {
  // ssh://user:password@host:port#name
  //   or ssh://user@host:port?privateKey=<base64-PEM>&passphrase=...#name
  const u = safeUrl(link, "ssh");
  if (!u.username) throw new ParseError("ssh: missing user", link);
  const q = parseQuery(u.search);
  const user = decodeURIComponent(u.username);
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  // Private key may be passed base64-encoded (to survive URL encoding) or raw.
  let privateKey = q.privateKey || q.private_key || q.pk || undefined;
  if (privateKey && !privateKey.includes("BEGIN")) {
    privateKey = safeB64(privateKey) || privateKey;
  }
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "ssh",
      address: u.hostname,
      port: parsePort(u.port, 22),
      transport: { type: "tcp" },
      tls: { enabled: false, security: "none" },
      ssh: {
        user,
        password,
        privateKey: privateKey || undefined,
        privateKeyPassphrase: q.passphrase ? decodeURIComponent(q.passphrase) : undefined,
      },
    },
    link,
  );
}

export function parseTor(link: string): ServerProfile {
  // tor://[host[:port]]#name — connects through the embedded Tor SOCKS path.
  // No credentials are required; host/port are cosmetic placeholders.
  const normalized = link.replace(/^tor:\/\/$/, "tor://localhost");
  const u = safeUrl(
    normalized.includes("//") && normalized.length > "tor://".length
      ? normalized
      : "tor://localhost",
    "tor",
  );
  return finalize(
    {
      name: decodeRemark(u.hash, u.hostname ? `Tor (${u.hostname})` : "Tor"),
      protocol: "tor",
      address: u.hostname || "127.0.0.1",
      port: parsePort(u.port, 9050),
      transport: { type: "tcp" },
      tls: { enabled: false, security: "none" },
    },
    link,
  );
}

export function parseSocks(link: string): ServerProfile {
  // socks://[base64(user:pass) | user:pass]@host:port#name  (also socks5://)
  const normalized = link.replace(/^socks5:\/\//, "socks://");
  const hashIdx = normalized.indexOf("#");
  const remark = hashIdx >= 0 ? decodeRemark(normalized.slice(hashIdx), "") : "";
  const core = (hashIdx >= 0 ? normalized.slice(0, hashIdx) : normalized).slice("socks://".length);

  let username = "";
  let password = "";
  let hostPart = core;
  if (core.includes("@")) {
    const at = core.lastIndexOf("@");
    const userinfo = core.slice(0, at);
    hostPart = core.slice(at + 1);
    // userinfo may be base64 (Nekobox) or plain user:pass.
    const decoded = userinfo.includes(":") ? userinfo : safeB64(userinfo);
    [username, password] = splitFirst(decoded, ":");
  }
  // Strip any trailing query (rarely used for socks).
  const qIdx = hostPart.indexOf("?");
  const hp = qIdx >= 0 ? hostPart.slice(0, qIdx) : hostPart;
  const [host, port] = splitHostPort(hp);
  if (!host || !port) throw new ParseError("socks: missing host/port", link);
  return finalize(
    {
      name: remark || `${host}:${port}`,
      protocol: "socks",
      address: host,
      port,
      username: username || undefined,
      password: password || undefined,
      transport: { type: "tcp" },
      tls: { enabled: false, security: "none" },
    },
    link,
  );
}

export function parseHttp(link: string): ServerProfile {
  // http(s)://[user:pass@]host:port#name  — an HTTP(S) CONNECT proxy outbound.
  // `https://` enables TLS. Guarded so subscription URLs (which carry a path
  // and/or omit an explicit port) are NOT mistaken for proxy share links.
  const secure = /^https:\/\//i.test(link);
  const scheme = secure ? "https://" : "http://";
  const hashIdx = link.indexOf("#");
  const remark = hashIdx >= 0 ? decodeRemark(link.slice(hashIdx), "") : "";
  const core = (hashIdx >= 0 ? link.slice(0, hashIdx) : link).slice(scheme.length);

  let username = "";
  let password = "";
  let hostPart = core;
  if (core.includes("@")) {
    const at = core.lastIndexOf("@");
    const userinfo = core.slice(0, at);
    hostPart = core.slice(at + 1);
    // userinfo may be base64 or plain user:pass.
    const decoded = userinfo.includes(":") ? userinfo : safeB64(userinfo);
    [username, password] = splitFirst(decoded, ":");
  }
  // A genuine proxy link is host:port with no path; a subscription URL has a
  // path ("/sub", "/api/...") and/or no explicit port → reject those so they
  // fall through to the subscription import flow instead of becoming a server.
  const qIdx = hostPart.indexOf("?");
  if (qIdx >= 0) hostPart = hostPart.slice(0, qIdx);
  const slashIdx = hostPart.indexOf("/");
  if (slashIdx >= 0) {
    const path = hostPart.slice(slashIdx);
    hostPart = hostPart.slice(0, slashIdx);
    if (path !== "/" && path !== "") {
      throw new ParseError("http: looks like a URL, not a proxy (has path)", link);
    }
  }
  const [host, port] = splitHostPort(hostPart);
  if (!host || !port) throw new ParseError("http: missing host/port", link);
  return finalize(
    {
      name: remark || `${host}:${port}`,
      protocol: "http",
      address: host,
      port,
      username: username || undefined,
      password: password || undefined,
      transport: { type: "tcp" },
      tls: secure
        ? { enabled: true, security: "tls", sni: host }
        : { enabled: false, security: "none" },
    },
    link,
  );
}

export function parseWireguard(link: string): ServerProfile {
  // wireguard://<privateKey>@host:port?publickey=<peerPub>&presharedkey=<psk>
  //   &address=172.16.0.2/32,fd01::2/128&reserved=0,0,0&mtu=1420#name
  // (wg:// is an accepted alias.)
  const normalized = link.replace(/^wg:\/\//, "wireguard://");
  const u = safeUrl(normalized, "wireguard");
  const rawQ = parseQuery(u.search);
  // WireGuard share links vary in key casing (publickey / PublicKey / pubkey).
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawQ)) q[k.toLowerCase()] = v;
  const privateKey = decodeURIComponent(u.username || q.privatekey || q.secretkey || "");
  if (!privateKey) throw new ParseError("wireguard: missing private key", link);
  const peerPublicKey = q.publickey || q.pubkey || q.peer_public_key || q.public_key || "";
  if (!peerPublicKey) throw new ParseError("wireguard: missing peer public key", link);

  const addressRaw = q.address || q.ip || "172.16.0.2/32";
  const localAddress = addressRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (a.includes("/") ? a : `${a}/32`));

  const reserved = parseReserved(q.reserved);
  const mtu = q.mtu ? Number(q.mtu) : undefined;

  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "wireguard",
      address: u.hostname,
      port: parsePort(u.port),
      transport: { type: "tcp" }, // not used for WireGuard, kept for type-shape
      tls: { enabled: false, security: "none" },
      wireguard: {
        privateKey,
        peerPublicKey,
        preSharedKey: q.presharedkey || q.pre_shared_key || undefined,
        localAddress: localAddress.length ? localAddress : ["172.16.0.2/32"],
        reserved,
        mtu: Number.isFinite(mtu) ? mtu : undefined,
      },
    },
    link,
  );
}

/** Parse a WireGuard `reserved` value — either "1,2,3" or a base64 of 3 bytes. */
function parseReserved(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  if (raw.includes(",")) {
    const nums = raw
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n));
    return nums.length ? nums : undefined;
  }
  // base64 → bytes
  try {
    const bytes = decodeBase64(raw);
    const arr = Array.from(bytes, (c) => c.charCodeAt(0));
    return arr.length ? arr : undefined;
  } catch {
    return undefined;
  }
}

/** decodeBase64 that returns "" instead of throwing (for optional userinfo). */
function safeB64(s: string): string {
  try {
    return decodeBase64(s);
  } catch {
    return s;
  }
}

// ── tiny string helpers ────────────────────────────────────
function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

function splitHostPort(s: string): [string, number] {
  // IPv6 literal: [::1]:443
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    const host = s.slice(1, close);
    const port = Number(s.slice(close + 2));
    return [host, port];
  }
  const i = s.lastIndexOf(":");
  if (i < 0) return [s, 0];
  return [s.slice(0, i), Number(s.slice(i + 1))];
}

/** Construct a URL, converting the native TypeError into a clean ParseError. */
function safeUrl(link: string, proto: string): URL {
  try {
    return new URL(link);
  } catch {
    throw new ParseError(`${proto}: malformed URL`, link);
  }
}

/** Parse + validate a port, falling back to 443 for missing/invalid values. */
function parsePort(raw: string | number | undefined, fallback = 443): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

export const SCHEME_PARSERS: Record<string, (link: string) => ServerProfile> = {
  vless: parseVless,
  vmess: parseVmess,
  trojan: parseTrojan,
  ss: parseShadowsocks,
  hysteria2: parseHysteria2,
  hy2: parseHysteria2,
  hysteria: parseHysteria,
  tuic: parseTuic,
  wireguard: parseWireguard,
  wg: parseWireguard,
  socks: parseSocks,
  socks5: parseSocks,
  http: parseHttp,
  https: parseHttp,
  anytls: parseAnytls,
  shadowtls: parseShadowtls,
  ssh: parseSsh,
  tor: parseTor,
};

export const SUPPORTED_SCHEMES = Object.keys(SCHEME_PARSERS) as readonly string[];
export type SupportedScheme = Protocol | "hy2" | "wg" | "socks5" | "https";
