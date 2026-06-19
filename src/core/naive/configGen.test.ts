import { describe, expect, it } from "vitest";
import { generateNaiveConfig } from "./configGen";
import { parseShareLink } from "../parser";
import type { ServerProfile } from "../types";

const naive = (link = "naive+https://user1:pass1@nv.example.com:443#NV"): ServerProfile =>
  parseShareLink(link);

const baseOpts = { mixedPort: 2080, allowLan: false };

describe("generateNaiveConfig", () => {
  it("defaults to an HTTP listener so the app's HTTP-proxy + system proxy reach it", () => {
    // The whole app dials the proxy as `http://127.0.0.1:port` and the Windows
    // system proxy is HTTP — a SOCKS-only listener would leave naïve dead.
    const cfg: any = generateNaiveConfig(naive(), baseOpts);
    expect(cfg.listen).toBe("http://127.0.0.1:2080");
  });

  it("builds the upstream proxy URL from credentials + host", () => {
    const cfg: any = generateNaiveConfig(naive(), baseOpts);
    expect(cfg.proxy).toBe("https://user1:pass1@nv.example.com:443");
  });

  it("binds all interfaces when LAN sharing is on", () => {
    const cfg: any = generateNaiveConfig(naive(), { ...baseOpts, allowLan: true });
    expect(cfg.listen).toBe("http://0.0.0.0:2080");
  });

  it("honours an explicit SOCKS listener override", () => {
    const cfg: any = generateNaiveConfig(naive(), { ...baseOpts, listenScheme: "socks" });
    expect(cfg.listen).toBe("socks://127.0.0.1:2080");
  });

  it("percent-encodes credentials with reserved characters", () => {
    const cfg: any = generateNaiveConfig(
      naive("naive+https://u%24er:p%40ss%3Aword@nv.example.com:443#x"),
      baseOpts,
    );
    // ':' and '@' inside the password must stay encoded so the URL stays valid.
    expect(cfg.proxy).toBe("https://u%24er:p%40ss%3Aword@nv.example.com:443");
  });

  it("omits userinfo entirely when there are no credentials", () => {
    const cfg: any = generateNaiveConfig(naive("naive+https://open.example.com:443#x"), baseOpts);
    expect(cfg.proxy).toBe("https://open.example.com:443");
  });

  it("refuses a non-naive protocol", () => {
    const wrong = { ...naive(), protocol: "vless" } as ServerProfile;
    expect(() => generateNaiveConfig(wrong, baseOpts)).toThrow();
  });
});
