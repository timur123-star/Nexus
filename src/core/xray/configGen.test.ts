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
    expect(() =>
      generateXrayConfig({ ...server, protocol: "hysteria2" }, baseOpts),
    ).toThrow();
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
