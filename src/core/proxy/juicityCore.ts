import { generateJuicityConfig } from "../juicity/configGen";
import type { Protocol } from "../types";
import type { IProxyCore } from "./types";

/**
 * Juicity runs on its own `juicity-client` binary and speaks only the Juicity
 * protocol. It exposes a local SOCKS5 listener (no TUN, no Clash API), so the
 * connection store routes a `juicity` server here and the Rust supervisor falls
 * back to its no-API readiness path.
 */
export const juicityCore: IProxyCore = {
  kind: "juicity",
  label: "Juicity",
  supports: (p: Protocol) => p === "juicity",
  generateConfig: (server, opts) =>
    generateJuicityConfig(server, {
      mixedPort: opts.mixedPort,
      allowLan: opts.allowLan,
      logLevel: opts.logLevel,
    }),
};
