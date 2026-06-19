import { describe, it, expect } from "vitest";
import { generateXrayConfig, type XrayGenOptions } from "./configGen";
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

const baseOpts: XrayGenOptions = {
  mixedPort: 2080,
  clashApiPort: 9090,
  routingMode: "rule",
  allowLan: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gen(opts: Partial<XrayGenOptions> = {}): any {
  return generateXrayConfig(server, { ...baseOpts, ...opts });
}

describe("generateXrayConfig — base", () => {
  it("builds http + socks inbounds and a vless proxy outbound", () => {
    const cfg = gen();
    const tags = cfg.inbounds.map((i: { tag: string }) => i.tag);
    expect(tags).toContain("http-in");
    expect(tags).toContain("socks-in");
    const proxy = cfg.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.protocol).toBe("vless");
  });

  it("rejects sing-box-only protocols", () => {
    expect(() => generateXrayConfig({ ...server, protocol: "hysteria2" }, baseOpts)).toThrow();
  });
});

describe("generateXrayConfig — fragment", () => {
  it("adds a fragment freedom outbound and dials the proxy through it", () => {
    const cfg = gen({
      fragment: { enabled: true, packets: "tlshello", length: "10-20", interval: "10-20" },
    });
    const frag = cfg.outbounds.find((o: { tag: string }) => o.tag === "fragment");
    expect(frag).toBeDefined();
    expect(frag.settings.fragment).toMatchObject({ packets: "tlshello", length: "10-20" });
    const proxy = cfg.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.streamSettings.sockopt.dialerProxy).toBe("fragment");
  });

  it("omits fragment plumbing when disabled", () => {
    const cfg = gen({
      fragment: { enabled: false, packets: "tlshello", length: "10-20", interval: "10-20" },
    });
    const frag = cfg.outbounds.find((o: { tag: string }) => o.tag === "fragment");
    expect(frag).toBeUndefined();
    const proxy = cfg.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.streamSettings.sockopt).toBeUndefined();
  });
});

describe("generateXrayConfig — mux", () => {
  it("enables mux on the proxy outbound", () => {
    const cfg = gen({ mux: { enabled: true, protocol: "smux" } });
    const proxy = cfg.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.mux).toMatchObject({ enabled: true });
  });

  it("omits mux when disabled", () => {
    const cfg = gen({ mux: { enabled: false } });
    const proxy = cfg.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.mux).toBeUndefined();
  });
});

describe("generateXrayConfig — xhttp + post-quantum reality", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function genFor(s: ServerProfile): any {
    return generateXrayConfig(s, baseOpts);
  }

  it("emits xhttpSettings (path/host/mode/extra) for an xhttp reality node", () => {
    const s: ServerProfile = {
      ...server,
      transport: {
        type: "xhttp",
        path: "/xh",
        host: "www.nvidia.com",
        mode: "auto",
        xhttpExtra: { xPaddingBytes: "100-1000" },
      },
      tls: { enabled: true, security: "reality", sni: "ya.ru", publicKey: "PBK", shortId: "SID" },
    };
    const ss = genFor(s).outbounds[0].streamSettings;
    expect(ss.network).toBe("xhttp");
    expect(ss.xhttpSettings).toEqual({
      path: "/xh",
      host: "www.nvidia.com",
      mode: "auto",
      extra: { xPaddingBytes: "100-1000" },
    });
    expect(ss.security).toBe("reality");
  });

  it("emits mldsa65Verify when a post-quantum reality key is present", () => {
    const s: ServerProfile = {
      ...server,
      transport: { type: "tcp" },
      tls: {
        enabled: true,
        security: "reality",
        sni: "vk.ru",
        publicKey: "PBK",
        shortId: "SID",
        postQuantum: "PQVKEY",
      },
    };
    const rs = genFor(s).outbounds[0].streamSettings.realitySettings;
    expect(rs.mldsa65Verify).toBe("PQVKEY");
  });
});

describe("generateXrayConfig — dns", () => {
  it("emits a dns block from custom resolvers", () => {
    const cfg = gen({
      dns: { remote: "https://1.1.1.1/dns-query", direct: "https://223.5.5.5/dns-query" },
    });
    expect(cfg.dns).toBeDefined();
    expect(cfg.dns.servers).toContain("https://1.1.1.1/dns-query");
    expect(cfg.dns.servers).toContain("https://223.5.5.5/dns-query");
    expect(cfg.dns.servers).toContain("localhost");
    expect(cfg.dns.queryStrategy).toBe("UseIPv4");
  });

  it("omits the dns block when no custom resolvers are set", () => {
    expect(gen().dns).toBeUndefined();
    expect(gen({ dns: null }).dns).toBeUndefined();
    expect(gen({ dns: { remote: "", direct: "" } }).dns).toBeUndefined();
  });
});

describe("generateXrayConfig — flow gating", () => {
  function srvFlow(overrides: Partial<ServerProfile>): ServerProfile {
    return { ...server, flow: "xtls-rprx-vision", ...(overrides as ServerProfile) };
  }
  it("drops vision flow over non-tcp transport (ws)", () => {
    const cfg: any = generateXrayConfig(
      srvFlow({ transport: { type: "ws", path: "/p" } }),
      baseOpts,
    );
    const proxy = cfg.outbounds.find((o: any) => o.tag === "proxy");
    expect(proxy.settings.vnext[0].users[0].flow).toBe("");
    expect(proxy.mux).toBeUndefined(); // (no mux requested)
  });
  it("keeps vision flow over raw tcp", () => {
    const cfg: any = generateXrayConfig(srvFlow({ transport: { type: "tcp" } }), baseOpts);
    const proxy = cfg.outbounds.find((o: any) => o.tag === "proxy");
    expect(proxy.settings.vnext[0].users[0].flow).toBe("xtls-rprx-vision");
  });
});

describe("generateXrayConfig — wireguard / socks", () => {
  function srv(overrides: Partial<ServerProfile>): ServerProfile {
    return { ...server, ...(overrides as ServerProfile) };
  }

  it("builds a wireguard outbound (secretKey + peers + reserved)", () => {
    const cfg: any = generateXrayConfig(
      srv({
        protocol: "wireguard",
        uuid: undefined,
        tls: { enabled: false, security: "none" },
        transport: { type: "tcp" },
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
    const proxy = cfg.outbounds.find((o: any) => o.tag === "proxy");
    expect(proxy.protocol).toBe("wireguard");
    expect(proxy.settings.secretKey).toBe("PRIV");
    expect(proxy.settings.peers[0].publicKey).toBe("PEER");
    expect(proxy.settings.peers[0].endpoint).toBe("example.com:443");
    expect(proxy.settings.address).toEqual(["172.16.0.2/32"]);
    expect(proxy.settings.reserved).toEqual([1, 2, 3]);
    expect(proxy.settings.mtu).toBe(1280);
    expect("streamSettings" in proxy).toBe(false);
  });

  it("builds a socks outbound with users", () => {
    const cfg: any = generateXrayConfig(
      srv({
        protocol: "socks",
        uuid: undefined,
        username: "alice",
        password: "pw",
        tls: { enabled: false, security: "none" },
        transport: { type: "tcp" },
      }),
      baseOpts,
    );
    const proxy = cfg.outbounds.find((o: any) => o.tag === "proxy");
    expect(proxy.protocol).toBe("socks");
    expect(proxy.settings.servers[0].address).toBe("example.com");
    expect(proxy.settings.servers[0].users[0].user).toBe("alice");
    expect(proxy.settings.servers[0].users[0].pass).toBe("pw");
  });

  it("rejects sing-box-only protocols (hysteria / anytls)", () => {
    expect(() =>
      generateXrayConfig(srv({ protocol: "anytls", uuid: undefined }), baseOpts),
    ).toThrow(/sing-box/);
    expect(() =>
      generateXrayConfig(srv({ protocol: "hysteria", uuid: undefined }), baseOpts),
    ).toThrow(/sing-box/);
  });
});
