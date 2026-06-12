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
  const u = new URL(link);
  if (!u.username) throw new ParseError("vless: missing uuid", link);
  const q = parseQuery(u.search);
  const net = normalizeTransport(q.type);
  const security = normalizeSecurity(q.security);
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "vless",
      address: u.hostname,
      port: Number(u.port) || 443,
      uuid: decodeURIComponent(u.username),
      flow: q.flow || undefined,
      transport: buildTransport(q, net),
      tls: buildTls(q, security),
    },
    link,
  );
}

export function parseTrojan(link: string): ServerProfile {
  const u = new URL(link);
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
      port: Number(u.port) || 443,
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
  const net = normalizeTransport(g("net"));
  const security = normalizeSecurity(g("tls") ? "tls" : "none");
  const transport = buildTransport(
    { path: g("path"), host: g("host"), serviceName: g("path") },
    net,
  );
  const tls = buildTls({ sni: g("sni") || g("host"), alpn: g("alpn"), fp: g("fp") }, security);
  return finalize(
    {
      name: g("ps") || `${g("add")}:${g("port")}`,
      protocol: "vmess",
      address: g("add"),
      port: Number(g("port")) || 443,
      uuid: g("id"),
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

  if (!host || !port) throw new ParseError("ss: missing host/port", link);

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
  const u = new URL(normalized);
  const q = parseQuery(u.search);
  const security: Security = "tls";
  const tls = buildTls({ sni: q.sni, alpn: q.alpn, insecure: q.insecure, fp: q.fp }, security);
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "hysteria2",
      address: u.hostname,
      port: Number(u.port) || 443,
      password: decodeURIComponent(u.username || u.password || ""),
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
  const u = new URL(link);
  const q = parseQuery(u.search);
  const tls = buildTls({ sni: q.sni, alpn: q.alpn, insecure: q.allow_insecure }, "tls");
  return finalize(
    {
      name: decodeRemark(u.hash, `${u.hostname}:${u.port}`),
      protocol: "tuic",
      address: u.hostname,
      port: Number(u.port) || 443,
      uuid: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
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

// ── tiny string helpers ───────────────────────────────────────────────────
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

export const SCHEME_PARSERS: Record<string, (link: string) => ServerProfile> = {
  vless: parseVless,
  vmess: parseVmess,
  trojan: parseTrojan,
  ss: parseShadowsocks,
  hysteria2: parseHysteria2,
  hy2: parseHysteria2,
  tuic: parseTuic,
};

export const SUPPORTED_SCHEMES = Object.keys(SCHEME_PARSERS) as readonly string[];
export type SupportedScheme = Protocol | "hy2";
