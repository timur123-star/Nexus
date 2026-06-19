/**
 * Cloudflare WARP auto-registration.
 *
 * WARP is just a managed WireGuard tunnel, so we can enroll a brand-new peer
 * entirely from the client: generate an X25519 key pair locally, register the
 * public key with Cloudflare's public client API (via the Rust `warp_register`
 * command, which performs the cross-origin HTTPS POST the webview can't), then
 * fold the response into a `wireguard://` share link the existing parser
 * already understands. One click → a working WARP server, no binaries.
 */
import { x25519 } from "@noble/curves/ed25519";
import { warpRegister } from "./ipc";

/**
 * Built-in WARP relay (see `warp-relay/`). Cloudflare's enrollment API is
 * blocked from some regions (e.g. RU), so by default we enroll through this
 * hosted relay running outside the blocked region — the "Create WARP" button
 * then just works out of the box, no configuration needed. Only the public key
 * is ever sent to it; the private key never leaves this machine. Users may
 * override it with their own relay via the `warpRelayUrl` setting, or pass an
 * empty string somewhere upstream to fall back to the direct Cloudflare path.
 */
export const DEFAULT_WARP_RELAY = "https://nexus-warp-production.up.railway.app";

/** Base64-encode raw bytes using the browser's btoa (binary-safe). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface WarpEndpoint {
  host?: string;
}
interface WarpPeer {
  public_key?: string;
  endpoint?: WarpEndpoint;
}
interface WarpAddresses {
  v4?: string;
  v6?: string;
}
interface WarpRegResponse {
  config?: {
    client_id?: string;
    peers?: WarpPeer[];
    interface?: { addresses?: WarpAddresses };
  };
}

/**
 * Cloudflare returns a base64 `client_id` (3 bytes). WireGuard implementations
 * that talk to WARP must echo those 3 bytes in every packet's `reserved`
 * field, otherwise Cloudflare silently drops the traffic. Decode it to the
 * `a,b,c` form our parser understands; fall back to `0,0,0` if absent.
 */
function reservedFromClientId(clientId: string | undefined): string {
  if (!clientId) return "0,0,0";
  try {
    const bin = atob(clientId);
    const bytes = [bin.charCodeAt(0), bin.charCodeAt(1), bin.charCodeAt(2)];
    if (bytes.every((b) => Number.isFinite(b))) return bytes.join(",");
  } catch {
    /* fall through */
  }
  return "0,0,0";
}

/**
 * Enroll a WARP peer through a user-deployed relay (see `warp-relay/`). Used
 * when Cloudflare's API is blocked locally (e.g. RU): the relay runs outside
 * the blocked region and performs the registration on our behalf. Only the
 * public key is ever sent — the private key stays on this machine.
 */
async function registerViaRelay(relayUrl: string, pubB64: string): Promise<string> {
  const base = relayUrl.trim().replace(/\/+$/, "");
  const endpoint = /\/reg$/.test(base) ? base : `${base}/reg`;
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: pubB64 }),
    });
  } catch (e) {
    throw new Error(
      `Could not reach the WARP relay at ${base}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { error?: string; detail?: string };
      detail = j.error || detail;
    } catch {
      /* keep raw text */
    }
    throw new Error(`WARP relay error (HTTP ${resp.status}): ${detail}`);
  }
  return text;
}

/**
 * Register a fresh WARP account and return a ready-to-import `wireguard://`
 * link. Throws with a human-readable message on any failure. When `relayUrl`
 * is provided, enrollment goes through that relay instead of Cloudflare
 * directly (to bypass regional blocks of api.cloudflareclient.com).
 */
export async function registerWarp(relayUrl?: string): Promise<string> {
  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  const privB64 = toBase64(priv);
  const pubB64 = toBase64(pub);

  // The relay is the primary, RU-friendly path: a user-configured one wins,
  // otherwise the built-in default. If the relay is unreachable/erroring we
  // fall back to a direct Cloudflare enrollment (works wherever the API isn't
  // regionally blocked) so a relay hiccup never breaks WARP for everyone.
  const relay = (relayUrl ?? "").trim() || DEFAULT_WARP_RELAY;
  let raw: string;
  try {
    raw = await registerViaRelay(relay, pubB64);
  } catch (relayErr) {
    let fallback = "";
    try {
      fallback = await warpRegister(pubB64);
    } catch {
      throw relayErr;
    }
    if (!fallback) throw relayErr;
    raw = fallback;
  }
  if (!raw) throw new Error("WARP registration unavailable (run inside the app)");

  let data: WarpRegResponse;
  try {
    data = JSON.parse(raw) as WarpRegResponse;
  } catch {
    throw new Error("WARP registration returned an unexpected response");
  }

  const peer = data.config?.peers?.[0];
  const peerPub = peer?.public_key?.trim();
  if (!peerPub) throw new Error("WARP registration returned no peer key");

  const endpointHost = peer?.endpoint?.host?.trim() || "engage.cloudflareclient.com:2408";
  const addrs = data.config?.interface?.addresses ?? {};
  const v4 = (addrs.v4 || "172.16.0.2").trim();
  const v6 = (addrs.v6 || "").trim();
  const address = v6 ? `${v4}/32,${v6}/128` : `${v4}/32`;

  // Split "host:port" from the right so IPv6 hosts survive intact.
  const lastColon = endpointHost.lastIndexOf(":");
  const host = lastColon > 0 ? endpointHost.slice(0, lastColon) : endpointHost;
  const port = lastColon > 0 ? endpointHost.slice(lastColon + 1) : "2408";

  const q = new URLSearchParams({
    publickey: peerPub,
    address,
    reserved: reservedFromClientId(data.config?.client_id),
    mtu: "1280",
  });
  return `wireguard://${encodeURIComponent(privB64)}@${host}:${port}?${q.toString()}#Cloudflare%20WARP`;
}
