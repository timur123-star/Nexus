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
    peers?: WarpPeer[];
    interface?: { addresses?: WarpAddresses };
  };
}

/**
 * Register a fresh WARP account and return a ready-to-import `wireguard://`
 * link. Throws with a human-readable message on any failure.
 */
export async function registerWarp(): Promise<string> {
  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  const privB64 = toBase64(priv);
  const pubB64 = toBase64(pub);

  const raw = await warpRegister(pubB64);
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
    reserved: "0,0,0",
    mtu: "1280",
  });
  return `wireguard://${encodeURIComponent(privB64)}@${host}:${port}?${q.toString()}#Cloudflare%20WARP`;
}
