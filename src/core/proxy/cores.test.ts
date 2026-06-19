import { describe, expect, it } from "vitest";
import { getCore, ALL_CORES } from "./index";
import { singboxCore } from "./singboxCore";
import { xrayCore } from "./xrayCore";
import { juicityCore } from "./juicityCore";
import { naiveCore } from "./naiveCore";
import { parseShareLink } from "../parser";
import type { Protocol } from "../types";

const baseOpts: any = {
  mixedPort: 2080,
  clashApiPort: 9090,
  clashSecret: "nexusshield",
  routingMode: "rule",
  tun: { enabled: false, stack: "system" },
  allowLan: false,
  fakeIp: true,
  dns: { remote: "", direct: "" },
};

// Real share-links — one per protocol — exercised through the real parser so we
// build genuine ServerProfile objects, not hand-waved fixtures.
const LINKS: Record<string, string> = {
  vless: "vless://11112222-3333-4444-5555-666677778888@example.com:443?type=tcp&security=tls#V",
  vmess:
    "vmess://eyJ2IjoiMiIsInBzIjoidm0iLCJhZGQiOiIxLjIuMy40IiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTIyMjItMzMzMy00NDQ0LTU1NTUtNjY2Njc3Nzc4ODg4IiwiYWlkIjoiMCIsIm5ldCI6IndzIiwidGxzIjoidGxzIn0=",
  trojan: "trojan://secretpass@host.com:443?sni=host.com#T",
  shadowsocks: "ss://aes-256-gcm:pw123@1.2.3.4:8388#SS",
  hysteria2: "hysteria2://pw@h2.example.com:443?sni=h2.example.com#H2",
  hysteria: "hysteria://h.example.com:443?auth=tok&peer=h.example.com&upmbps=50&downmbps=200#HY",
  tuic: "tuic://uuid-1:pass-1@t.example.com:443?congestion_control=bbr#TUIC",
  anytls: "anytls://pw123@a.example.com:8443?sni=a.example.com#ANY",
  socks: "socks://1.2.3.4:1080#Proxy",
  shadowtls:
    "shadowtls://2022-blake3-aes-128-gcm:sspass@1.2.3.4:443?password=hs&version=3&sni=www.microsoft.com#st",
  wireguard:
    "wireguard://cPrivKeyBase64%3D@engage.cloudflareclient.com:2408?publickey=PUBKEY&address=172.16.0.2/32&mtu=1280#WG",
};

describe("getCore resolution", () => {
  it("maps the known core kinds", () => {
    expect(getCore("sing-box")).toBe(singboxCore);
    expect(getCore("xray")).toBe(xrayCore);
    expect(getCore("juicity")).toBe(juicityCore);
    expect(getCore("naive")).toBe(naiveCore);
  });
  it("defaults to sing-box for unknown/empty values", () => {
    expect(getCore(undefined)).toBe(singboxCore);
    expect(getCore(null)).toBe(singboxCore);
    expect(getCore("nonsense" as any)).toBe(singboxCore);
  });
  it("exposes exactly four cores with stable identity", () => {
    expect(ALL_CORES).toHaveLength(4);
    expect(ALL_CORES.map((c) => c.kind).sort()).toEqual([
      "juicity",
      "naive",
      "sing-box",
      "xray",
    ]);
    expect(singboxCore.label).toBe("sing-box");
    expect(xrayCore.label).toBe("Xray-core");
  });

  it("only sing-box exposes the Clash API that powers live traffic counters", () => {
    expect(singboxCore.providesClashApi).toBe(true);
    // Xray uses its own stats API; the dedicated engines have none.
    expect(xrayCore.providesClashApi).toBe(false);
    expect(juicityCore.providesClashApi).toBe(false);
    expect(naiveCore.providesClashApi).toBe(false);
    // Exactly one core feeds the live graph.
    expect(ALL_CORES.filter((c) => c.providesClashApi)).toHaveLength(1);
  });

  it("dedicated-engine cores advertise only their own protocol", () => {
    expect(juicityCore.supports("juicity")).toBe(true);
    expect(juicityCore.supports("naive")).toBe(false);
    expect(juicityCore.supports("vless")).toBe(false);
    expect(naiveCore.supports("naive")).toBe(true);
    expect(naiveCore.supports("juicity")).toBe(false);
    expect(naiveCore.supports("vless")).toBe(false);
    // sing-box / xray must NOT claim the dedicated-engine protocols.
    expect(singboxCore.supports("juicity")).toBe(false);
    expect(singboxCore.supports("naive")).toBe(false);
    expect(xrayCore.supports("juicity")).toBe(false);
    expect(xrayCore.supports("naive")).toBe(false);
  });
});

describe("core capability matrix", () => {
  it("sing-box runs every protocol NexusShield can parse", () => {
    for (const proto of Object.keys(LINKS) as Protocol[]) {
      expect(singboxCore.supports(proto)).toBe(true);
    }
  });
  it("xray advertises only the v2ray-family protocols", () => {
    expect(xrayCore.supports("vless")).toBe(true);
    expect(xrayCore.supports("vmess")).toBe(true);
    expect(xrayCore.supports("trojan")).toBe(true);
    expect(xrayCore.supports("shadowsocks")).toBe(true);
    expect(xrayCore.supports("wireguard")).toBe(true);
    expect(xrayCore.supports("socks")).toBe(true);
    // sing-box-only transports must NOT be advertised by Xray.
    expect(xrayCore.supports("hysteria2")).toBe(false);
    expect(xrayCore.supports("hysteria")).toBe(false);
    expect(xrayCore.supports("tuic")).toBe(false);
    expect(xrayCore.supports("anytls")).toBe(false);
    expect(xrayCore.supports("shadowtls")).toBe(false);
  });
});

describe("generateConfig produces a runnable, JSON-safe config per core", () => {
  for (const [proto, link] of Object.entries(LINKS)) {
    it(`sing-box: ${proto}`, () => {
      const server = parseShareLink(link);
      const cfg: any = singboxCore.generateConfig(server, baseOpts);
      expect(cfg && typeof cfg).toBe("object");
      // Round-trips through JSON without throwing (no circular refs / functions).
      const json = JSON.stringify(cfg);
      expect(json.length).toBeGreaterThan(0);
      expect(Array.isArray(cfg.outbounds)).toBe(true);
      // The server's address must appear somewhere in the emitted outbound.
      expect(json).toContain(server.address);
    });

    it(`xray: ${proto}${xrayCore.supports(proto as Protocol) ? "" : " (skipped — unsupported)"}`, () => {
      const server = parseShareLink(link);
      if (!xrayCore.supports(server.protocol)) {
        expect(xrayCore.supports(server.protocol)).toBe(false);
        return;
      }
      const cfg: any = xrayCore.generateConfig(server, baseOpts);
      expect(cfg && typeof cfg).toBe("object");
      const json = JSON.stringify(cfg);
      expect(Array.isArray(cfg.outbounds)).toBe(true);
      expect(json).toContain(server.address);
    });
  }
});
