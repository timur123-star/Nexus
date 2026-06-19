/** Low-level parsing helpers shared by every protocol parser. */

/** URL-safe + standard base64 decode that tolerates missing padding and
 * embedded whitespace (e.g. MIME line-wrapped subscription bodies). */
export function decodeBase64(input: string): string {
  // Strip ALL whitespace first: base64 ignores it per spec, but atob() and
  // Buffer treat embedded newlines/spaces as invalid input.
  let s = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  if (typeof atob === "function") {
    // Browser / WebView path — decode then fix UTF-8.
    const bin = atob(s);
    try {
      return decodeURIComponent(
        bin
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      );
    } catch {
      return bin;
    }
  }
  // Node / test path.
  return Buffer.from(s, "base64").toString("utf-8");
}

/** Heuristic: is this string base64 (and not already plain text)? */
export function looksBase64(input: string): boolean {
  const s = input.trim();
  if (s.length < 8 || s.length % 4 !== 0) {
    // allow url-safe unpadded
    if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(s)) return false;
  }
  return /^[A-Za-z0-9+/\-_]+={0,2}$/.test(s);
}

/**
 * Generate a stable-enough local id without external deps.
 * Not cryptographic — only used to key UI list items.
 */
export function makeId(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const rand = ((h >>> 0).toString(16) + (seed.length * 2654435761).toString(16)).slice(0, 12);
  return `srv_${rand}`;
}

/**
 * Parse a query string into a flat record (last value wins).
 *
 * KEYS are lower-cased; VALUES are left untouched. Share-link query keys are
 * case-insensitive identifiers, but panels are wildly inconsistent about
 * casing — 3x-ui / Hiddify exports routinely emit `Security=`, `PBK=`, `SID=`,
 * `Type=`. Without normalization those uppercase keys silently miss every
 * `q.security` / `q.pbk` lookup, so a REALITY node imports as plain TLS (or
 * `none`) and never completes its handshake. Lower-casing keys here fixes it
 * once for every protocol parser. Callers therefore read lower-case keys only
 * (`q.servicename`, not `q.serviceName`).
 */
export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const usp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [k, v] of usp.entries()) out[k.toLowerCase()] = v;
  return out;
}

/** Decode the #fragment of a share link into a human remark. */
export function decodeRemark(hash: string, fallback: string): string {
  if (!hash) return fallback;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw) || fallback;
  } catch {
    return raw || fallback;
  }
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly link?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}
