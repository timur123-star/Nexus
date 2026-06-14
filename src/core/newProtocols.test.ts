import { describe, it, expect } from "vitest";
import { parseShareLink } from "./parser";
import { serverToShareLink } from "./share/serialize";
import { generateSingboxConfig } from "./singbox/configGen";
import { generateXrayConfig } from "./xray/configGen";
import type { GenOptions } from "./singbox/configGen";

const baseOpts = (over: Partial<GenOptions> = {}): GenOptions =>
  ({
    mixedPort: 2080,
    clashApiPort: 9090,
    clashSecret: "",
    routingMode: "rule",
    tun: { enabled: false },
    allowLan: false,
    fakeIp: false,
    dns: {},
    customRules: [],
    blockQuic: false,
    ...over,
  }) as GenOptions;

describe("ssh outbound", () => {
  it("parses and round-trips ssh credentials", () => {
    const s = parseShareLink("ssh://root:secret@1.2.3.4:22#myssh");
    expect(s.protocol).toBe("ssh");
    expect(s.ssh?.user).toBe("root");
    expect(s.ssh?.password).toBe("secret");
    const r = parseShareLink(serverToShareLink(s));
    expect(r.ssh).toEqual(s.ssh);
  });

  it("emits a sing-box ssh outbound", () => {
    const s = parseShareLink("ssh://root:secret@1.2.3.4:22#x");
    const cfg = generateSingboxConfig(s, baseOpts({ routingMode: "global" })) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const o = cfg.outbounds.find((x) => x.type === "ssh");
    expect(o).toBeTruthy();
    expect(o?.user).toBe("root");
    expect(o?.password).toBe("secret");
  });

  it("is rejected by the Xray core (sing-box only)", () => {
    const s = parseShareLink("ssh://root:secret@1.2.3.4:22#x");
    expect(() => generateXrayConfig(s, baseOpts({ routingMode: "global" }))).toThrow();
  });
});

describe("shadowtls outbound", () => {
  const link =
    "shadowtls://2022-blake3-aes-128-gcm:sspass@1.2.3.4:443?password=hs&version=3&sni=www.microsoft.com#st";

  it("parses inner SS + handshake fields", () => {
    const s = parseShareLink(link);
    expect(s.protocol).toBe("shadowtls");
    expect(s.shadowtls?.method).toBe("2022-blake3-aes-128-gcm");
    expect(s.shadowtls?.ssPassword).toBe("sspass");
    expect(s.shadowtls?.password).toBe("hs");
    expect(s.shadowtls?.version).toBe(3);
  });

  it("round-trips through a share link", () => {
    const r = parseShareLink(serverToShareLink(parseShareLink(link)));
    expect(r.shadowtls?.ssPassword).toBe("sspass");
    expect(r.shadowtls?.password).toBe("hs");
  });

  it("emits a shadowtls detour + inner shadowsocks chain", () => {
    const s = parseShareLink(link);
    const cfg = generateSingboxConfig(s, baseOpts()) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const st = cfg.outbounds.find((o) => o.type === "shadowtls");
    const inner = cfg.outbounds.find((o) => o.type === "shadowsocks" && o.tag === "proxy");
    expect(st).toBeTruthy();
    expect(inner).toBeTruthy();
    expect(inner?.detour).toBe(st?.tag);
  });
});

describe("tor outbound", () => {
  it("parses a tor link and emits a tor outbound", () => {
    const s = parseShareLink("tor://#Tor");
    expect(s.protocol).toBe("tor");
    const cfg = generateSingboxConfig(s, baseOpts({ routingMode: "global" })) as {
      outbounds: Array<Record<string, unknown>>;
    };
    expect(cfg.outbounds.some((o) => o.type === "tor")).toBe(true);
  });
});

describe("advanced routing matches", () => {
  it("turns geoip/geosite into rule-sets and handles port/regex inline", () => {
    const s = parseShareLink("ssh://root:secret@1.2.3.4:22#x");
    const cfg = generateSingboxConfig(
      s,
      baseOpts({
        customRules: [
          { match: "geoip", value: "ir", target: "direct" },
          { match: "geosite", value: "telegram", target: "proxy" },
          { match: "port", value: "443", target: "proxy" },
          { match: "domain_regex", value: "^.*\\.openai\\.com$", target: "proxy" },
        ],
      }),
    ) as {
      route: { rules: Array<Record<string, unknown>>; rule_set: Array<{ tag: string }> };
    };
    const tags = cfg.route.rule_set.map((r) => r.tag);
    expect(tags).toContain("geoip-ir");
    expect(tags).toContain("geosite-telegram");
    expect(cfg.route.rules.some((r) => Array.isArray(r.port) && (r.port as number[])[0] === 443)).toBe(
      true,
    );
    expect(cfg.route.rules.some((r) => Array.isArray(r.domain_regex))).toBe(true);
  });

  it("maps geo/regex/port matches in the Xray router", () => {
    const s = parseShareLink("vless://uuid@1.2.3.4:443?security=none#x");
    const cfg = generateXrayConfig(
      s,
      baseOpts({
        customRules: [
          { match: "geoip", value: "ir", target: "direct" },
          { match: "geosite", value: "telegram", target: "proxy" },
          { match: "port", value: "443", target: "block" },
        ],
      }),
    ) as { routing: { rules: Array<Record<string, unknown>> } };
    const flat = JSON.stringify(cfg.routing.rules);
    expect(flat).toContain("geoip:ir");
    expect(flat).toContain("geosite:telegram");
  });
});

describe("http proxy outbound", () => {
  it("parses an http proxy link with credentials", () => {
    const s = parseShareLink("http://user:pass@1.2.3.4:8080#myhttp");
    expect(s.protocol).toBe("http");
    expect(s.address).toBe("1.2.3.4");
    expect(s.port).toBe(8080);
    expect(s.username).toBe("user");
    expect(s.password).toBe("pass");
    expect(s.tls.enabled).toBe(false);
  });

  it("parses an https proxy link with TLS enabled and round-trips", () => {
    const s = parseShareLink("https://u:p@proxy.example:443#secure");
    expect(s.protocol).toBe("http");
    expect(s.tls.enabled).toBe(true);
    const r = parseShareLink(serverToShareLink(s));
    expect(r.protocol).toBe("http");
    expect(r.tls.enabled).toBe(true);
    expect(r.username).toBe("u");
    expect(serverToShareLink(s).startsWith("https://")).toBe(true);
  });

  it("rejects a subscription-style URL (has a path) as not a proxy", () => {
    expect(() => parseShareLink("https://panel.example.com/sub/abc123")).toThrow();
    expect(() => parseShareLink("http://host.example/api/v1/clients")).toThrow();
  });

  it("emits a sing-box http outbound (with TLS for https)", () => {
    const s = parseShareLink("https://u:p@1.2.3.4:8443#x");
    const cfg = generateSingboxConfig(s, baseOpts({ routingMode: "global" })) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const o = cfg.outbounds.find((x) => x.type === "http");
    expect(o).toBeTruthy();
    expect(o?.username).toBe("u");
    expect((o?.tls as { enabled: boolean }).enabled).toBe(true);
  });

  it("emits an xray http outbound", () => {
    const s = parseShareLink("http://user:pass@1.2.3.4:8080#x");
    const cfg = generateXrayConfig(s, baseOpts({ routingMode: "global" })) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const o = cfg.outbounds.find((x) => x.protocol === "http");
    expect(o).toBeTruthy();
    const settings = o?.settings as { servers: Array<{ users: Array<{ user: string }> }> };
    expect(settings.servers[0].users[0].user).toBe("user");
  });
});
