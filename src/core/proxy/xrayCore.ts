import { generateXrayConfig } from "../xray/configGen";
import type { Protocol } from "../types";
import type { IProxyCore } from "./types";

/**
 * Xray-core supports the v2ray-family protocols. Hysteria2 / TUIC are
 * sing-box-only, so we advertise a narrower `supports()` set and the connection
 * store falls back / warns accordingly.
 */
const XRAY_PROTOCOLS: ReadonlySet<Protocol> = new Set<Protocol>([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
]);

export const xrayCore: IProxyCore = {
  kind: "xray",
  label: "Xray-core",
  supports: (p) => XRAY_PROTOCOLS.has(p),
  generateConfig: (server, opts) =>
    generateXrayConfig(server, {
      mixedPort: opts.mixedPort,
      clashApiPort: opts.clashApiPort,
      routingMode: opts.routingMode,
      allowLan: opts.allowLan,
      customRules: opts.customRules,
      blockQuic: opts.blockQuic,
      fragment: opts.fragment ?? null,
      mux: opts.mux ?? null,
    }),
};
