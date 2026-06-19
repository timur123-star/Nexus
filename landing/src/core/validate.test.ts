import { describe, expect, it } from "vitest";
import { parseShareLink } from "./parser";
import { validateServerForLaunch } from "./validate";
import { generateXrayConfig } from "./xray/configGen";
import type { ServerProfile } from "./types";

const XOPTS = {
  mixedPort: 2080,
  clashApiPort: 9090,
  routingMode: "rule" as const,
  allowLan: false,
};

const REALITY_FULL =
  "vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=AbCdEfPublicKey123&sid=0123abcd&spx=%2F&type=tcp#Reality";
// Same node but WITHOUT the pbk= parameter — this is the field failure from core.log.
const REALITY_NO_PBK =
  "vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&sid=0123abcd&spx=%2F&type=tcp#RealityNoPbk";

describe("validateServerForLaunch", () => {
  it("passes a complete REALITY node", () => {
    const srv = parseShareLink(REALITY_FULL);
    expect(validateServerForLaunch(srv, "ru")).toBeNull();
  });

  it("rejects a REALITY node missing publicKey (pbk) with a clear localized message", () => {
    const srv = parseShareLink(REALITY_NO_PBK);
    const err = validateServerForLaunch(srv, "ru");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("reality_missing_pbk");
    expect(err!.message).toContain("pbk");
    // English fallback works too.
    expect(validateServerForLaunch(srv, "en")!.message).toMatch(/public key/i);
  });

  it("rejects missing address / port", () => {
    const base = parseShareLink(REALITY_FULL);
    expect(validateServerForLaunch({ ...base, address: "" }, "en")!.code).toBe("missing_address");
    expect(validateServerForLaunch({ ...base, port: 0 }, "en")!.code).toBe("missing_port");
  });

  it("rejects vless without uuid and shadowsocks without method", () => {
    const vless = parseShareLink(REALITY_FULL);
    expect(validateServerForLaunch({ ...vless, uuid: "" }, "en")!.code).toBe("missing_uuid");
    const ss = parseShareLink(
      "ss://" + btoa("aes-128-gcm:pw") + "@h.example.com:8388#SS",
    ) as ServerProfile;
    expect(validateServerForLaunch({ ...ss, method: "" }, "en")!.code).toBe("missing_ss_method");
  });

  it("rejects ShadowTLS whose inner Shadowsocks password is empty", () => {
    // Mirrors the field core.log FATAL `initialize outbound[1]: missing password`:
    // the inner SS outbound is generated with an empty password and crash-loops.
    const base = parseShareLink(REALITY_FULL);
    const shadowtls = {
      ...base,
      protocol: "shadowtls" as const,
      shadowtls: {
        version: 3,
        password: "handshake",
        method: "2022-blake3-aes-128-gcm",
        ssPassword: "",
      },
    };
    const err = validateServerForLaunch(shadowtls, "en");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("missing_password");
    // A complete ShadowTLS node passes.
    expect(
      validateServerForLaunch(
        { ...shadowtls, shadowtls: { ...shadowtls.shadowtls, ssPassword: "innerpw" } },
        "en",
      ),
    ).toBeNull();
  });

  it("rejects AnyTLS — unsupported by the bundled sing-box 1.11 / Xray cores", () => {
    const anytls = parseShareLink("anytls://pw123@a.example.com:8443?sni=a.example.com#ANY");
    const err = validateServerForLaunch(anytls, "en");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("unsupported_anytls");
    expect(validateServerForLaunch(anytls, "ru")!.message).toMatch(/AnyTLS/);
  });
});

describe("configGen defense-in-depth", () => {
  it("xray throws (not emits empty publicKey) for REALITY without pbk", () => {
    const srv = parseShareLink(REALITY_NO_PBK);
    expect(() => generateXrayConfig(srv, XOPTS)).toThrow(/public key|pbk/i);
  });

  it("xray still builds a valid config for a complete REALITY node", () => {
    const srv = parseShareLink(REALITY_FULL);
    const cfg = generateXrayConfig(srv, XOPTS) as {
      outbounds: Array<{
        tag: string;
        streamSettings?: { realitySettings?: { publicKey: string } };
      }>;
    };
    const proxy = cfg.outbounds.find((o) => o.tag === "proxy");
    expect(proxy?.streamSettings?.realitySettings?.publicKey).toBe("AbCdEfPublicKey123");
  });
});
