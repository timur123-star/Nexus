/**
 * Import servers from a full sing-box JSON config (an `{ outbounds: [...] }`
 * document), as opposed to a list of `vless://` share links.
 *
 * Many modern panels (sing-box / Hiddify "full config" subscriptions, the
 * kittenx / x-ui forks used by RU anti-censorship setups, etc.) serve the whole
 * runnable client config — `{ "log": …, "dns": …, "outbounds": [...] }` — under
 * a `Content-Type: application/json` subscription URL, NOT a base64 blob of
 * share links. Before this, `parseMany` only understood links / base64 / vmess
 * and silently returned zero servers for such a body: the import reported
 * "added" but nothing showed up. This converter turns each proxy outbound into a
 * `ServerProfile` so those subscriptions work like any other.
 *
 * Clash YAML is intentionally out of scope — only sing-box JSON is handled here.
 */
import type { Protocol, Security, ServerProfile, TlsSettings, TransportSettings } from "../types";
import { makeId } from "./util";

/** Outbound `type`s that are real proxy servers (not selectors / utilities). */
const PROXY_TYPES: ReadonlySet<string> = new Set([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "hysteria",
  "tuic",
  "shadowtls",
  "anytls",
  "socks",
  "http",
  "wireguard",
]);

/** Non-server outbounds emitted by every config — never imported as nodes. */
const SKIP_TAGS_RE = /^(direct|block|dns-out|dns|reject)$/i;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * True when `text` looks like a sing-box config document rather than a link
 * list. We only claim it when an `outbounds` array is actually present, so a
 * stray `{}`/array body still falls through to the normal parse path.
 */
export function looksLikeSingboxConfig(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  try {
    const j = JSON.parse(t);
    return isObj(j) && Array.isArray((j as Obj).outbounds);
  } catch {
    return false;
  }
}

/** Map a sing-box outbound `tls` object to our TlsSettings. */
function tlsFromOutbound(tls: unknown): TlsSettings {
  if (!isObj(tls) || tls.enabled === false) {
    return { enabled: false, security: "none" };
  }
  const reality = isObj(tls.reality) && tls.reality.enabled !== false ? tls.reality : undefined;
  const security: Security = reality ? "reality" : "tls";
  const out: TlsSettings = { enabled: true, security };
  const sni = str(tls.server_name);
  if (sni) out.sni = sni;
  if (Array.isArray(tls.alpn)) {
    const alpn = tls.alpn.filter((a): a is string => typeof a === "string");
    if (alpn.length) out.alpn = alpn;
  }
  if (isObj(tls.utls)) {
    const fp = str(tls.utls.fingerprint);
    if (fp) out.fingerprint = fp;
  }
  if (tls.insecure === true) out.allowInsecure = true;
  if (reality) {
    out.publicKey = str(reality.public_key);
    out.shortId = str(reality.short_id);
  }
  return out;
}

/** Map a sing-box `transport` object to our TransportSettings. */
function transportFromOutbound(o: Obj): TransportSettings {
  const tr = isObj(o.transport) ? o.transport : undefined;
  if (!tr) return { type: "tcp" };
  const kind = str(tr.type);
  const t: TransportSettings = { type: "tcp" };
  switch (kind) {
    case "ws":
      t.type = "ws";
      if (str(tr.path)) t.path = str(tr.path);
      if (isObj(tr.headers) && str(tr.headers.Host)) t.host = str(tr.headers.Host);
      break;
    case "grpc":
      t.type = "grpc";
      if (str(tr.service_name)) t.serviceName = str(tr.service_name);
      break;
    case "http":
      t.type = "h2";
      if (str(tr.path)) t.path = str(tr.path);
      if (Array.isArray(tr.host) && typeof tr.host[0] === "string") t.host = tr.host[0];
      else if (str(tr.host)) t.host = str(tr.host);
      break;
    case "quic":
      t.type = "quic";
      break;
    default:
      t.type = "tcp";
  }
  return t;
}

function base(o: Obj, protocol: Protocol): Omit<ServerProfile, "id"> {
  const server = str(o.server) ?? "";
  const port = num(o.server_port) ?? 443;
  const name = str(o.tag) || `${server}:${port}`;
  return {
    name,
    protocol,
    address: server,
    port,
    transport: transportFromOutbound(o),
    tls: tlsFromOutbound(o.tls),
    tags: [],
    favorite: false,
    latencyMs: null,
    createdAt: 0,
  };
}

/** Inner Shadowsocks credentials pulled from an outbound that detours through a
 *  ShadowTLS carrier. */
interface InnerSs {
  method?: string;
  password?: string;
}

/** Convert one sing-box outbound into a ServerProfile, or null if unsupported.
 *  `innerSs` is only consulted for shadowtls carriers. */
function convertOutbound(o: Obj, innerSs?: InnerSs): ServerProfile | null {
  const type = str(o.type);
  if (!type || !PROXY_TYPES.has(type)) return null;
  const server = str(o.server);
  if (!server && type !== "wireguard") return null;

  const idSeed = `${type}|${str(o.server)}|${num(o.server_port)}|${str(o.tag)}`;
  const id = makeId(idSeed);

  switch (type) {
    case "vless":
      return { ...base(o, "vless"), id, uuid: str(o.uuid), flow: str(o.flow) || undefined };
    case "vmess":
      return {
        ...base(o, "vmess"),
        id,
        uuid: str(o.uuid),
        alterId: num(o.alter_id) ?? 0,
        method: str(o.security) || "auto",
      };
    case "trojan":
      return { ...base(o, "trojan"), id, password: str(o.password) };
    case "shadowsocks":
      return {
        ...base(o, "shadowsocks"),
        id,
        method: str(o.method),
        password: str(o.password),
      };
    case "hysteria2":
      return {
        ...base(o, "hysteria2"),
        id,
        password: str(o.password),
        transport: { type: "quic" },
        extra: {
          obfs: isObj(o.obfs) ? str(o.obfs.type) : undefined,
          obfsPassword: isObj(o.obfs) ? str(o.obfs.password) : undefined,
        },
      };
    case "hysteria":
      return {
        ...base(o, "hysteria"),
        id,
        transport: { type: "quic" },
        extra: { auth: str(o.auth_str) },
      };
    case "tuic":
      return {
        ...base(o, "tuic"),
        id,
        uuid: str(o.uuid),
        password: str(o.password),
        transport: { type: "quic" },
        extra: {
          congestionControl: str(o.congestion_control),
          udpRelayMode: str(o.udp_relay_mode),
        },
      };
    case "anytls":
      return { ...base(o, "anytls"), id, password: str(o.password) };
    case "shadowtls": {
      // A bare shadowtls outbound is the TLS-camouflage *carrier* for an inner
      // SS connection. Modern panels split it: a shadowsocks outbound with
      // `detour` pointing at this carrier. `innerSs` (resolved by the caller from
      // that detouring outbound) carries the inner method/password — without them
      // the node fails pre-flight validation as "missing password".
      return {
        ...base(o, "shadowtls"),
        id,
        shadowtls: {
          version: num(o.version) ?? 3,
          password: str(o.password) ?? "",
          method: innerSs?.method ?? "",
          ssPassword: innerSs?.password ?? "",
        },
      };
    }
    case "socks":
      return {
        ...base(o, "socks"),
        id,
        username: str(o.username) || undefined,
        password: str(o.password) || undefined,
        tls: { enabled: false, security: "none" },
      };
    case "http":
      return {
        ...base(o, "http"),
        id,
        username: str(o.username) || undefined,
        password: str(o.password) || undefined,
      };
    case "wireguard": {
      const server2 = str(o.server);
      if (!server2) return null;
      const localAddr = Array.isArray(o.local_address)
        ? o.local_address.filter((a): a is string => typeof a === "string")
        : [];
      return {
        ...base(o, "wireguard"),
        id,
        wireguard: {
          privateKey: str(o.private_key) ?? "",
          peerPublicKey: str(o.peer_public_key) ?? "",
          preSharedKey: str(o.pre_shared_key) || undefined,
          localAddress: localAddr.length ? localAddr : ["172.16.0.2/32"],
          reserved: Array.isArray(o.reserved)
            ? o.reserved.filter((n): n is number => typeof n === "number")
            : undefined,
          mtu: num(o.mtu),
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Parse a sing-box JSON config string into ServerProfiles. Returns `[]` for
 * anything that isn't a valid config with an `outbounds` array, so callers can
 * fall through to link/base64 parsing safely.
 */
export function parseSingboxConfig(text: string): ServerProfile[] {
  let j: unknown;
  try {
    j = JSON.parse(text.trim());
  } catch {
    return [];
  }
  if (!isObj(j) || !Array.isArray(j.outbounds)) return [];
  const outbounds = j.outbounds.filter(isObj) as Obj[];

  // Tags of the actual ShadowTLS carrier outbounds. We only treat an SS outbound
  // as the "inner half" of a chain if its `detour` points at one of THESE — an SS
  // outbound that uses `detour` for ordinary chaining (to a non-shadowtls
  // outbound) is a legitimate standalone server and must NOT be dropped.
  const shadowtlsTags = new Set(
    outbounds
      .filter((o) => str(o.type) === "shadowtls")
      .map((o) => str(o.tag))
      .filter((t): t is string => !!t),
  );

  // Index inner-SS creds by the ShadowTLS carrier tag they `detour` through, so
  // the carrier can recover its inner method/password (which live on the
  // separate detouring outbound, not on the carrier itself).
  const innerByCarrier = new Map<string, InnerSs>();
  const innerTags = new Set<string>();
  for (const o of outbounds) {
    const detour = str(o.detour);
    const tag = str(o.tag);
    if (detour && str(o.type) === "shadowsocks" && shadowtlsTags.has(detour)) {
      innerByCarrier.set(detour, {
        method: str(o.method),
        password: str(o.password),
      });
      // This SS exists solely as the inner half of the chain — don't also import
      // it as a standalone node.
      if (tag) innerTags.add(tag);
    }
  }

  const servers: ServerProfile[] = [];
  for (const o of outbounds) {
    const tag = str(o.tag);
    if (tag && SKIP_TAGS_RE.test(tag)) continue;
    if (tag && innerTags.has(tag)) continue;
    const innerSs = tag ? innerByCarrier.get(tag) : undefined;
    const conv = convertOutbound(o, innerSs);
    if (conv && conv.address) servers.push(conv);
  }
  return servers;
}
