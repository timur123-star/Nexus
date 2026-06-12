import { describe, it, expect } from "vitest";
import { generateXrayConfig } from "./configGen";
import type { ServerProfile } from "../types";

const base: ServerProfile = {
  id: "1",
  name: "test",
  protocol: "vless",
  address: "example.com",
  port: 443,
  uuid: "00000000-0000-0000-0000-000000000000",
  transport: { type: "ws", path: "/path", host: "host.com" },
  tls: { enabled: true, security: "tls", sni: "host.com" },
  tags: [],
  favorite: false,
  createdAt: 0,
};

const opts = { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule" as const, allowLan: false };

describe("generateXrayConfig", () => {
  it("builds a vless ws+tls outbound", () => {
    const c = generateXrayConfig(base, opts) as any;
    expect(c.outbounds[0].protocol).toBe("vless");
    expect(c.outbounds[0].streamSettings.network).toBe("ws");
    expect(c.outbounds[0].streamSettings.security).toBe("tls");
    expect(c.outbounds[0].streamSettings.wsSettings.path).toBe("/path");
  });

  it("exposes an http inbound on the mixed port for system proxy", () => {
    const c = generateXrayConfig(base, opts) as any;
    const http = c.inbounds.find((i: any) => i.protocol === "http");
    expect(http.port).toBe(2080);
  });

  it("maps reality security", () => {
    const reality: ServerProfile = {
      ...base,
      tls: { enabled: true, security: "reality", sni: "host.com", publicKey: "pk", shortId: "sid" },
    };
    const c = generateXrayConfig(reality, opts) as any;
    expect(c.outbounds[0].streamSettings.security).toBe("reality");
    expect(c.outbounds[0].streamSettings.realitySettings.publicKey).toBe("pk");
  });

  it("rejects hysteria2 / tuic (sing-box only)", () => {
    expect(() => generateXrayConfig({ ...base, protocol: "hysteria2" }, opts)).toThrow();
    expect(() => generateXrayConfig({ ...base, protocol: "tuic" }, opts)).toThrow();
  });
});
