import { describe, it, expect } from "vitest";
import { generateSingboxConfig, type GenOptions } from "./configGen";
import type { ServerProfile } from "../types";

const server: ServerProfile = {
  id: "srv_1",
  name: "Test",
  protocol: "vless",
  address: "example.com",
  port: 443,
  uuid: "uuid-1",
  transport: { type: "ws", path: "/p", host: "h.com" },
  tls: { enabled: true, security: "tls", sni: "h.com" },
  tags: [],
  favorite: false,
  latencyMs: null,
  createdAt: 0,
};

const baseOpts: GenOptions = {
  mixedPort: 2080,
  clashApiPort: 9090,
  clashSecret: "x",
  routingMode: "rule",
  tun: { enabled: false, stack: "system" },
  allowLan: false,
  fakeIp: true,
  dns: { remote: "", direct: "" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gen(opts: Partial<GenOptions> = {}): any {
  return generateSingboxConfig(server, { ...baseOpts, ...opts });
}

describe("generateSingboxConfig — routing modes", () => {
  it("rule mode bundles the three geo rule-sets and proxies by default", () => {
    const cfg = gen({ routingMode: "rule" });
    expect(cfg.route.final).toBe("proxy");
    expect(cfg.route.rule_set).toHaveLength(3);
    expect(cfg.route.rules).toContainEqual({ rule_set: "geoip-cn", outbound: "direct" });
    expect(cfg.route.rules).toContainEqual({ rule_set: "geosite-ads", outbound: "block" });
  });

  it("direct mode sends everything direct and ships no rule-sets", () => {
    const cfg = gen({ routingMode: "direct" });
    expect(cfg.route.final).toBe("direct");
    expect(cfg.route.rule_set).toHaveLength(0);
  });

  it("global mode proxies everything with no geo rules", () => {
    const cfg = gen({ routingMode: "global" });
    expect(cfg.route.final).toBe("proxy");
    expect(cfg.route.rule_set).toHaveLength(0);
    expect(cfg.route.rules).not.toContainEqual({ rule_set: "geosite-cn", outbound: "direct" });
  });
});

describe("generateSingboxConfig — custom rules", () => {
  it("emits user rules with the right match key and outbound", () => {
    const cfg = gen({
      customRules: [
        { match: "domain_suffix", value: "openai.com", target: "proxy" },
        { match: "ip_cidr", value: "10.0.0.0/8", target: "direct" },
        { match: "domain_keyword", value: "ads", target: "block" },
        { match: "process_name", value: "telegram.exe", target: "proxy" },
      ],
    });
    expect(cfg.route.rules).toContainEqual({ domain_suffix: ["openai.com"], outbound: "proxy" });
    expect(cfg.route.rules).toContainEqual({ ip_cidr: ["10.0.0.0/8"], outbound: "direct" });
    expect(cfg.route.rules).toContainEqual({ domain_keyword: ["ads"], outbound: "block" });
    expect(cfg.route.rules).toContainEqual({ process_name: ["telegram.exe"], outbound: "proxy" });
  });

  it("skips rules with blank values", () => {
    const cfg = gen({ customRules: [{ match: "domain", value: "   ", target: "proxy" }] });
    const hasBlank = cfg.route.rules.some(
      (r: Record<string, unknown>) => Array.isArray(r.domain),
    );
    expect(hasBlank).toBe(false);
  });
});

describe("generateSingboxConfig — QUIC + TUN", () => {
  it("rejects QUIC when blockQuic is on", () => {
    const cfg = gen({ blockQuic: true });
    expect(cfg.route.rules).toContainEqual({ protocol: "quic", action: "reject" });
  });

  it("omits the QUIC reject when blockQuic is off", () => {
    const cfg = gen({ blockQuic: false });
    expect(cfg.route.rules).not.toContainEqual({ protocol: "quic", action: "reject" });
  });

  it("adds a tun inbound when TUN is enabled", () => {
    const cfg = gen({ tun: { enabled: true, stack: "gvisor" } });
    const tags = cfg.inbounds.map((i: { tag: string }) => i.tag);
    expect(tags).toContain("tun-in");
    const tun = cfg.inbounds.find((i: { tag: string }) => i.tag === "tun-in");
    expect(tun.stack).toBe("gvisor");
  });
});

describe("generateSingboxConfig — outbound", () => {
  it("builds a vless + ws + tls outbound", () => {
    const cfg = gen();
    const proxy = cfg.outbounds[0];
    expect(proxy.type).toBe("vless");
    expect(proxy.uuid).toBe("uuid-1");
    expect(proxy.transport.type).toBe("ws");
    expect(proxy.transport.path).toBe("/p");
    expect(proxy.tls.server_name).toBe("h.com");
  });
});

describe("generateSingboxConfig — multiplex", () => {
  it("adds a multiplex block to the proxy outbound when mux is enabled", () => {
    const cfg = gen({ mux: { enabled: true, protocol: "smux" } });
    const proxy = cfg.outbounds[0];
    expect(proxy.multiplex).toMatchObject({ enabled: true, protocol: "smux" });
  });

  it("omits multiplex when mux is disabled", () => {
    const cfg = gen({ mux: { enabled: false, protocol: "smux" } });
    expect(cfg.outbounds[0].multiplex).toBeUndefined();
  });

  it("omits multiplex when mux is not provided", () => {
    const cfg = gen();
    expect(cfg.outbounds[0].multiplex).toBeUndefined();
  });
});
