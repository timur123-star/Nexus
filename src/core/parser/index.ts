/**
 * Public parsing API.
 *
 *   parseShareLink(link)      -> one ServerProfile (throws ParseError)
 *   parseMany(text)           -> ServerProfile[] from any blob (links, base64,
 *                                newline list, subscription body)
 *   detectFormat(text)        -> describe what a blob looks like
 */
import type { ServerProfile } from "../types";
import { ParseError, decodeBase64, looksBase64 } from "./util";
import { SCHEME_PARSERS, SUPPORTED_SCHEMES } from "./protocols";
import { looksLikeSingboxConfig, parseSingboxConfig } from "./singboxImport";

export { ParseError } from "./util";
export { SUPPORTED_SCHEMES } from "./protocols";

const SCHEME_RE = new RegExp(`^(${SUPPORTED_SCHEMES.join("|")})://`, "i");

/** Parse exactly one share link. Throws ParseError on unknown/invalid input. */
export function parseShareLink(link: string): ServerProfile {
  const trimmed = link.trim();
  const m = /^([a-z0-9]+):\/\//i.exec(trimmed);
  if (!m) throw new ParseError("not a share link (no scheme://)", link);
  const scheme = m[1].toLowerCase();
  const parser = SCHEME_PARSERS[scheme];
  if (!parser) throw new ParseError(`unsupported protocol: ${scheme}`, link);
  return parser(trimmed);
}

export interface ParseResult {
  servers: ServerProfile[];
  /** Links that failed, with their reason — surfaced in the import dialog. */
  errors: { line: string; reason: string }[];
}

/**
 * A config-level identity for de-duplication. Two entries that resolve to the
 * exact same outbound (ignoring only the human remark / name) collapse to one,
 * but servers that share a domain+port+credential yet differ by transport,
 * path, host, SNI, security or flow — as CDN / 3x-ui subscriptions routinely
 * do — are kept as distinct endpoints.
 */
function identityKey(s: ServerProfile): string {
  return [
    s.protocol,
    s.address,
    s.port,
    s.uuid ?? "",
    s.password ?? "",
    s.method ?? "",
    s.transport.type,
    s.transport.path ?? "",
    s.transport.host ?? "",
    s.transport.serviceName ?? "",
    s.tls.security,
    s.tls.sni ?? "",
    s.flow ?? "",
  ].join("|");
}

/**
 * Parse an arbitrary blob into servers. Handles:
 *  - a single share link
 *  - many links separated by newlines / whitespace
 *  - a base64-encoded subscription body (decode, then recurse), including
 *    MIME / line-wrapped base64 bodies
 */
export function parseMany(text: string): ParseResult {
  const input = text.trim();
  const servers: ServerProfile[] = [];
  const errors: { line: string; reason: string }[] = [];

  // A full sing-box JSON config ({ outbounds: [...] }) — served by sing-box /
  // Hiddify "full config" subscriptions and kittenx/x-ui forks under a JSON
  // content-type — is neither a link list nor base64. Convert its outbounds to
  // servers directly; without this the import silently yielded zero servers.
  if (looksLikeSingboxConfig(input)) {
    const fromConfig = parseSingboxConfig(input);
    if (fromConfig.length) {
      const seenCfg = new Set<string>();
      for (const s of fromConfig) {
        const key = identityKey(s);
        if (seenCfg.has(key)) continue;
        seenCfg.add(key);
        servers.push(s);
      }
      return { servers, errors };
    }
    // A config with no importable outbounds — report it instead of falling
    // through to "unrecognised line" noise for every JSON line.
    errors.push({ line: "sing-box config", reason: "no proxy outbounds found" });
    return { servers, errors };
  }

  // If the blob is base64 and does NOT itself start with a scheme, it's almost
  // certainly a base64 subscription — decode and recurse once. Strip whitespace
  // first so MIME / line-wrapped base64 bodies are recognised too.
  const compact = input.replace(/\s+/g, "");
  if (!SCHEME_RE.test(input) && looksBase64(compact)) {
    try {
      const decoded = decodeBase64(compact);
      if (/:\/\//.test(decoded)) return parseMany(decoded);
    } catch {
      /* fall through to line-based parsing */
    }
  }

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

  const seen = new Set<string>();
  for (const line of lines) {
    if (!SCHEME_RE.test(line)) {
      errors.push({ line: truncate(line), reason: "unrecognised line" });
      continue;
    }
    try {
      const server = parseShareLink(line);
      const dupKey = identityKey(server);
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      servers.push(server);
    } catch (e) {
      errors.push({
        line: truncate(line),
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { servers, errors };
}

export type DetectedFormat =
  | "share-link"
  | "base64-subscription"
  | "link-list"
  | "json"
  | "unknown";

/** Best-effort classification for the import dialog's auto-detect hint. */
export function detectFormat(text: string): DetectedFormat {
  const t = text.trim();
  if (!t) return "unknown";
  if (/^\s*[[{]/.test(t)) return "json";
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 1 && lines.every((l) => SCHEME_RE.test(l.trim()))) return "link-list";
  if (SCHEME_RE.test(t)) return "share-link";
  if (looksBase64(t.replace(/\s+/g, ""))) return "base64-subscription";
  return "unknown";
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}
