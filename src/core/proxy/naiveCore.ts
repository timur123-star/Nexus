import { generateNaiveConfig } from "../naive/configGen";
import type { Protocol } from "../types";
import type { IProxyCore } from "./types";

/**
 * Naïve (naiveproxy) runs on its own `naive` binary and speaks only the Naïve
 * protocol over HTTP/2. It exposes a local SOCKS5 listener (no TUN, no Clash
 * API); the connection store routes a `naive` server here.
 */
export const naiveCore: IProxyCore = {
  kind: "naive",
  label: "Naïve",
  supports: (p: Protocol) => p === "naive",
  generateConfig: (server, opts) =>
    generateNaiveConfig(server, {
      mixedPort: opts.mixedPort,
      allowLan: opts.allowLan,
    }),
};
