/**
 * Generate a runnable naïve (naiveproxy) configuration from a ServerProfile.
 *
 * Naïve tunnels over HTTP/2 (or HTTP/3) through Chromium's network stack and
 * runs on its own `naive` binary — neither sing-box nor Xray implements it. The
 * binary exposes a local SOCKS5 (or HTTP) listener and forwards to an upstream
 * `https://` proxy.
 *
 * Reference: https://github.com/klzgrad/naiveproxy (config file schema)
 */
import type { ServerProfile } from "../types";

export interface NaiveGenOptions {
  /** Local listener port (reused as the app's SOCKS endpoint). */
  mixedPort: number;
  /** Bind on all interfaces when LAN sharing is on, else loopback only. */
  allowLan: boolean;
  /** "socks" (default) or "http" local listener. */
  listenScheme?: "socks" | "http";
}

/** Percent-encode a userinfo component so credentials survive in the proxy URL. */
function enc(v: string | undefined): string {
  return encodeURIComponent(v ?? "");
}

export function generateNaiveConfig(server: ServerProfile, opts: NaiveGenOptions): object {
  if (server.protocol !== "naive") {
    throw new Error(`naive core cannot run protocol "${server.protocol}"`);
  }
  const host = opts.allowLan ? "0.0.0.0" : "127.0.0.1";
  const scheme = opts.listenScheme ?? "socks";

  // Build the upstream proxy URL: https://[user:pass@]host:port
  const auth =
    server.username || server.password ? `${enc(server.username)}:${enc(server.password)}@` : "";
  const proxy = `https://${auth}${server.address}:${server.port}`;

  return {
    listen: `${scheme}://${host}:${opts.mixedPort}`,
    proxy,
  };
}
