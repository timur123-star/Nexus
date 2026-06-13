import { describe, expect, it } from "vitest";
import { generateSingboxConfig } from "./configGen";

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

function server(overrides: any = {}): any {
  return {
    id: "t",
    name: "t",
    protocol: "vless",
    address: "example.com",
    port: 443,
    uuid: "uuid-1",
    transport: { type: "tcp" },
    tls: { enabled: true, security: "reality", publicKey: "PBK", shortId: "SID" },
    tags: [],
    favorite: false,
    latencyMs: null,
    createdAt: 0,
    ...overrides,
  };
}

describe("generateSingboxConfig VLESS Reality", () => {
  it("always emits a utls block for Reality (default chrome) even without fp", () => {
    const cfg: any = generateSingboxConfig(server(), baseOpts);
    const out = cfg.outbounds[0];
    expect(out.type).toBe("vless");
    expect(out.tls.reality.enabled).toBe(true);
    expect(out.tls.reality.public_key).toBe("PBK");
    expect(out.tls.reality.short_id).toBe("SID");
    expect(out.tls.utls.enabled).toBe(true);
    expect(out.tls.utls.fingerprint).toBe("chrome");
  });

  it("honours an explicit fingerprint when provided", () => {
    const cfg: any = generateSingboxConfig(
      server({ tls: { enabled: true, security: "reality", publicKey: "PBK", fingerprint: "firefox" } }),
      baseOpts,
    );
    expect(cfg.outbounds[0].tls.utls.fingerprint).toBe("firefox");
  });

  it("emits flow only when set", () => {
    const withFlow: any = generateSingboxConfig(server({ flow: "xtls-rprx-vision" }), baseOpts);
    expect(withFlow.outbounds[0].flow).toBe("xtls-rprx-vision");
    const noFlow: any = generateSingboxConfig(server(), baseOpts);
    expect("flow" in noFlow.outbounds[0]).toBe(false);
  });
});

describe("generateSingboxConfig Shadowsocks plugin", () => {
  function ss(overrides: any = {}): any {
    return server({
      protocol: "shadowsocks",
      method: "aes-128-gcm",
      password: "pw",
      uuid: undefined,
      transport: { type: "tcp" },
      tls: { enabled: false, security: "none" },
      ...overrides,
    });
  }

  it("splits the SIP002 plugin string into plugin + plugin_opts", () => {
    const cfg: any = generateSingboxConfig(
      ss({ extra: { obfs: "obfs-local;obfs=http;obfs-host=example.com" } }),
      baseOpts,
    );
    const out = cfg.outbounds[0];
    expect(out.type).toBe("shadowsocks");
    expect(out.plugin).toBe("obfs-local");
    expect(out.plugin_opts).toBe("obfs=http;obfs-host=example.com");
  });

  it("emits plugin without opts when none are present", () => {
    const cfg: any = generateSingboxConfig(ss({ extra: { obfs: "v2ray-plugin" } }), baseOpts);
    const out = cfg.outbounds[0];
    expect(out.plugin).toBe("v2ray-plugin");
    expect("plugin_opts" in out).toBe(false);
  });

  it("omits plugin fields entirely for a plain shadowsocks server", () => {
    const cfg: any = generateSingboxConfig(ss(), baseOpts);
    const out = cfg.outbounds[0];
    expect("plugin" in out).toBe(false);
    expect("plugin_opts" in out).toBe(false);
  });
});
