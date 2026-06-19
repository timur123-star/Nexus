import { generateSingboxConfig } from "../singbox/configGen";
import type { Protocol } from "../types";
import type { IProxyCore } from "./types";

// Protocols that need their own dedicated engine binary — sing-box cannot run
// them, so it must NOT claim them. Otherwise selectCore (which checks
// supports() in preference order) would route a juicity/naive server to
// sing-box and the config generator would throw at startup.
const DEDICATED_ENGINE_ONLY: ReadonlySet<Protocol> = new Set<Protocol>([
  "juicity",
  "naive",
]);

/** sing-box runs every protocol NexusShield supports except dedicated-engine ones. */
export const singboxCore: IProxyCore = {
  kind: "sing-box",
  label: "sing-box",
  providesClashApi: true,
  supports: (p) => !DEDICATED_ENGINE_ONLY.has(p),
  generateConfig: (server, opts) => generateSingboxConfig(server, opts),
};
