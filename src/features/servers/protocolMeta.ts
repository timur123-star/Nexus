import type { Protocol } from "../../core/types";

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "SS",
  hysteria2: "Hysteria2",
  hysteria: "Hysteria",
  tuic: "TUIC",
  wireguard: "WireGuard",
  socks: "SOCKS5",
  anytls: "AnyTLS",
  shadowtls: "ShadowTLS",
  ssh: "SSH",
  tor: "Tor",
};

/** Accent colour per protocol for chips — kept visually distinct for quick
 *  recognition while staying coherent with the crimson/dark theme. */
export const PROTOCOL_COLOR: Record<Protocol, string> = {
  vless: "var(--color-indigo)",
  vmess: "#f0556b",
  trojan: "#fb923c",
  shadowsocks: "#f5b14c",
  hysteria2: "#ec4899",
  hysteria: "#f472b6",
  tuic: "#a78bfa",
  wireguard: "#34d399",
  socks: "#60a5fa",
  anytls: "#2dd4bf",
  shadowtls: "#c084fc",
  ssh: "#94a3b8",
  tor: "#7e57c2",
};

export const ALL_PROTOCOLS: Protocol[] = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "hysteria",
  "tuic",
  "wireguard",
  "socks",
  "anytls",
  "shadowtls",
  "ssh",
  "tor",
];
