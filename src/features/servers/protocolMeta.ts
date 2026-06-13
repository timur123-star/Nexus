import type { Protocol } from "../../core/types";

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "SS",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
};

/** Accent colour per protocol for chips — kept visually distinct for quick
 *  recognition while staying coherent with the crimson/dark theme. */
export const PROTOCOL_COLOR: Record<Protocol, string> = {
  vless: "var(--color-indigo)",
  vmess: "#f0556b",
  trojan: "#fb923c",
  shadowsocks: "#f5b14c",
  hysteria2: "#ec4899",
  tuic: "#a78bfa",
};

export const ALL_PROTOCOLS: Protocol[] = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "tuic",
];
