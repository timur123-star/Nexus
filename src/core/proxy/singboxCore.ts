import { generateSingboxConfig } from "../singbox/configGen";
import type { IProxyCore } from "./types";

/** sing-box runs every protocol NexusShield supports. */
export const singboxCore: IProxyCore = {
  kind: "sing-box",
  label: "sing-box",
  supports: () => true,
  generateConfig: (server, opts) => generateSingboxConfig(server, opts),
};
