/**
 * Generate a runnable juicity-client configuration from a ServerProfile.
 *
 * Juicity is a QUIC-based protocol that neither sing-box nor Xray implements, so
 * it runs on its own `juicity-client` binary. The client's `listen` serves both
 * HTTP and SOCKS5 on the same port (our mixed port) — so the app's HTTP-proxy
 * probes and the Windows system proxy reach it — and dials the server over QUIC.
 *
 * Reference: https://github.com/juicity/juicity (client config schema)
 */
import type { ServerProfile } from "../types";

export interface JuicityGenOptions {
  /** Local listener port (reused as the app's SOCKS endpoint). */
  mixedPort: number;
  /** Bind on all interfaces when LAN sharing is on, else loopback only. */
  allowLan: boolean;
  logLevel?: "trace" | "debug" | "info" | "warn" | "error";
}

export function generateJuicityConfig(server: ServerProfile, opts: JuicityGenOptions): object {
  if (server.protocol !== "juicity") {
    throw new Error(`juicity core cannot run protocol "${server.protocol}"`);
  }
  if (!(server.uuid ?? "").trim()) throw new Error("juicity: missing uuid");
  if (!(server.password ?? "").trim()) throw new Error("juicity: missing password");

  const host = opts.allowLan ? "0.0.0.0" : "127.0.0.1";
  return {
    listen: `${host}:${opts.mixedPort}`,
    server: `${server.address}:${server.port}`,
    uuid: server.uuid,
    password: server.password,
    // SNI defaults to the dial address when the share link omits it.
    sni: server.tls.sni || server.address,
    allow_insecure: !!server.tls.allowInsecure,
    congestion_control: server.extra?.congestionControl || "bbr",
    log_level: opts.logLevel ?? "info",
  };
}
