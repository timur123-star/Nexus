import type { Protocol } from "../../core/types";

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "SS",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
};

/** Accent colour per protocol for chips. */
export const PROTOCOL_COLOR: Record<Protocol, string> = {
  vless: "var(--color-indigo)",
  vmess: "#9b6af0",
  trojan: "#f0556b",
  shadowsocks: "#1ec8a4",
  hysteria2: "#f5b14c",
  tuic: "#4bd9bb",
};

export const ALL_PROTOCOLS: Protocol[] = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "tuic",
];
