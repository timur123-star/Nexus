/**
 * Parse a `nexusshield://` deep link into an importable blob of share-links.
 *
 * Supported shapes:
 *   nexusshield://import/<base64-or-url-encoded payload>
 *   nexusshield://import?data=<payload>&url=<subscription url>
 *   nexusshield://add/<single share-link, url-encoded>
 *
 * The payload may itself be a base64 blob of newline-separated links, a single
 * share link, or a raw list — all of which `addFromBlob` already understands, so
 * we only need to unwrap the transport layer here.
 */
export interface DeepLinkResult {
  /** Newline-joined share links / blob to feed to `addFromBlob`. */
  blob?: string;
  /** A subscription URL to add, if the link carried one. */
  subscriptionUrl?: string;
}

const SCHEME = "nexusshield://";

function tryDecodeBase64(s: string): string | null {
  try {
    // Tolerate URL-safe base64 and missing padding.
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const decoded = atob(b64);
    // Heuristic: a decoded subscription blob should look like text.
    if (/[\x00-\x08\x0e-\x1f]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Returns null when the input isn't a NexusShield deep link. */
export function parseDeepLink(raw: string): DeepLinkResult | null {
  const url = raw.trim();
  if (!url.toLowerCase().startsWith(SCHEME)) return null;

  // Split off an optional query string.
  const [pathPart, queryPart] = url.slice(SCHEME.length).split("?", 2);
  const segments = pathPart.split("/").filter(Boolean);
  const action = (segments.shift() ?? "").toLowerCase();
  const rest = segments.join("/");

  const result: DeepLinkResult = {};

  // Query parameters take priority and may carry both a blob and a sub URL.
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const data = params.get("data");
    const sub = params.get("url") ?? params.get("sub");
    if (sub) result.subscriptionUrl = sub;
    if (data) result.blob = tryDecodeBase64(data) ?? decodeURIComponent(data);
  }

  if (!result.blob && rest) {
    const decodedPath = (() => {
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    })();
    if (action === "import") {
      result.blob = tryDecodeBase64(decodedPath) ?? decodedPath;
    } else if (action === "add") {
      // A single share link, possibly the whole thing after the scheme.
      result.blob = decodedPath;
    } else {
      // Unknown action but still a nexusshield:// link — treat the remainder as a blob.
      result.blob = tryDecodeBase64(decodedPath) ?? decodedPath;
    }
  }

  if (!result.blob && !result.subscriptionUrl) return null;
  return result;
}
