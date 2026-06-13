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

describe("generateSingboxConfig rejects Xray-only features", () => {
  it("refuses xhttp transport (sing-box has no xhttp)", () => {
    expect(() =>
      generateSingboxConfig(server({ transport: { type: "xhttp", path: "/xh" } }), baseOpts),
    ).toThrow(/XHTTP/i);
  });

  it("refuses post-quantum reality (no ML-DSA-65 client in sing-box)", () => {
    expect(() =>
      generateSingboxConfig(
        server({ tls: { enabled: true, security: "reality", publicKey: "PBK", postQuantum: "PQV" } }),
        baseOpts,
      ),
    ).toThrow(/quantum/i);
  });
});

describe("generateSingboxConfig new protocols", () => {
  it("builds a WireGuard outbound with local_address + keys", () => {
    const cfg: any = generateSingboxConfig(
      server({
        protocol: "wireguard",
        uuid: undefined,
        tls: { enabled: false, security: "none" },
        wireguard: {
          privateKey: "PRIV",
          peerPublicKey: "PEER",
          localAddress: ["172.16.0.2/32"],
          reserved: [1, 2, 3],
          mtu: 1280,
        },
      }),
      baseOpts,
    );
    const out = cfg.outbounds[0];
    expect(out.type).toBe("wireguard");
    expect(out.private_key).toBe("PRIV");
    expect(out.peer_public_key).toBe("PEER");
    expect(out.local_address).toEqual(["172.16.0.2/32"]);
    expect(out.reserved).toEqual([1, 2, 3]);
    expect(out.mtu).toBe(1280);
  });

  it("builds a SOCKS5 outbound with credentials and no tls/mux", () => {
    const cfg: any = generateSingboxConfig(
      server({
        protocol: "socks",
        uuid: undefined,
        username: "alice",
        password: "pw",
        tls: { enabled: false, security: "none" },
      }),
      baseOpts,
    );
    const out = cfg.outbounds[0];
    expect(out.type).toBe("socks");
    expect(out.version).toBe("5");
    expect(out.username).toBe("alice");
    expect(out.password).toBe("pw");
    expect("tls" in out).toBe(false);
  });

  it("builds a Hysteria v1 outbound with auth_str + bandwidth", () => {
    const cfg: any = generateSingboxConfig(
      server({
        protocol: "hysteria",
        uuid: undefined,
        tls: { enabled: true, security: "tls", sni: "h.example.com" },
        extra: { auth: "tok", upMbps: 50, downMbps: 200, obfs: "xplus" },
      }),
      baseOpts,
    );
    const out = cfg.outbounds[0];
    expect(out.type).toBe("hysteria");
    expect(out.auth_str).toBe("tok");
    expect(out.up_mbps).toBe(50);
    expect(out.down_mbps).toBe(200);
    expect(out.obfs).toBe("xplus");
    expect(out.tls.enabled).toBe(true);
  });

  it("builds an AnyTLS outbound with password + tls", () => {
    const cfg: any = generateSingboxConfig(
      server({
        protocol: "anytls",
        uuid: undefined,
        password: "pw123",
        tls: { enabled: true, security: "tls", sni: "a.example.com" },
      }),
      baseOpts,
    );
    const out = cfg.outbounds[0];
    expect(out.type).toBe("anytls");
    expect(out.password).toBe("pw123");
    expect(out.tls.enabled).toBe(true);
  });
});
