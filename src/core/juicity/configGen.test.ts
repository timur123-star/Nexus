import { describe, expect, it } from "vitest";
import { generateJuicityConfig } from "./configGen";
import { parseShareLink } from "../parser";
import type { ServerProfile } from "../types";

const LINK =
  "juicity://11112222-3333-4444-5555-666677778888:secretpw@jc.example.com:443?sni=jc.example.com&congestion_control=bbr#JC";
const juicity = (link = LINK): ServerProfile => parseShareLink(link);

const baseOpts = { mixedPort: 2080, allowLan: false };

describe("generateJuicityConfig", () => {
  it("listens on the mixed port (juicity serves HTTP+SOCKS there)", () => {
    const cfg: any = generateJuicityConfig(juicity(), baseOpts);
    expect(cfg.listen).toBe("127.0.0.1:2080");
    expect(cfg.server).toBe("jc.example.com:443");
  });

  it("carries uuid + password + sni straight through", () => {
    const cfg: any = generateJuicityConfig(juicity(), baseOpts);
    expect(cfg.uuid).toBe("11112222-3333-4444-5555-666677778888");
    expect(cfg.password).toBe("secretpw");
    expect(cfg.sni).toBe("jc.example.com");
  });

  it("falls back to the dial address when the SNI is omitted", () => {
    const cfg: any = generateJuicityConfig(
      juicity("juicity://uuid-x:pw@jc2.example.com:8443#x"),
      baseOpts,
    );
    expect(cfg.sni).toBe("jc2.example.com");
  });

  it("defaults the congestion control to bbr", () => {
    const cfg: any = generateJuicityConfig(
      juicity("juicity://uuid-x:pw@jc.example.com:443#x"),
      baseOpts,
    );
    expect(cfg.congestion_control).toBe("bbr");
  });

  it("binds all interfaces when LAN sharing is on", () => {
    const cfg: any = generateJuicityConfig(juicity(), { ...baseOpts, allowLan: true });
    expect(cfg.listen).toBe("0.0.0.0:2080");
  });

  it("rejects a profile missing the uuid or password", () => {
    expect(() => generateJuicityConfig({ ...juicity(), uuid: "" } as ServerProfile, baseOpts)).toThrow();
    expect(() =>
      generateJuicityConfig({ ...juicity(), password: "" } as ServerProfile, baseOpts),
    ).toThrow();
  });

  it("refuses a non-juicity protocol", () => {
    const wrong = { ...juicity(), protocol: "tuic" } as ServerProfile;
    expect(() => generateJuicityConfig(wrong, baseOpts)).toThrow();
  });
});
