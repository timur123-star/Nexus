import { describe, it, expect } from "vitest";
import { parseMany } from "./index";
import { parseSingboxConfig, looksLikeSingboxConfig } from "./singboxImport";

/**
 * Regression for the real-world failure where a subscription serves a full
 * sing-box JSON config (Content-Type: application/json) instead of a base64
 * list of share links. The import used to report "added" but yield 0 servers.
 */
const REAL_CONFIG = JSON.stringify({
  log: { level: "warn" },
  dns: { servers: [{ tag: "remote", address: "tls://1.1.1.1" }] },
  outbounds: [
    { type: "selector", tag: "select", outbounds: ["auto"] },
    { type: "urltest", tag: "auto", outbounds: [] },
    {
      type: "vless",
      tag: "DESCTOP · Reality",
      server: "87.228.102.178",
      server_port: 443,
      uuid: "054b3fef-e801-4fe5-9533-7202105fb066",
      flow: "",
      packet_encoding: "xudp",
      tls: {
        enabled: true,
        server_name: "www.vk.ru",
        utls: { enabled: true, fingerprint: "chrome" },
        reality: {
          enabled: true,
          public_key: "efbWeEnb7GzOCmWYwzow_ULRRXuTh_aihEv-9yOyHls",
          short_id: "291c0761c8",
        },
      },
    },
    {
      type: "shadowtls",
      tag: "carrier",
      server: "87.228.102.178",
      server_port: 8445,
      version: 3,
      password: "RU_ShadowTLS_2026!",
      tls: { enabled: true, server_name: "dzen.ru", utls: { enabled: true, fingerprint: "chrome" } },
    },
    {
      type: "trojan",
      tag: "DESCTOP · Trojan",
      server: "87.228.102.178",
      server_port: 8442,
      password: "XHI1PspzT4U67Ka_SYauC1",
      tls: { enabled: true, server_name: "87.228.102.178", insecure: true, alpn: ["h2", "http/1.1"] },
    },
    {
      type: "hysteria2",
      tag: "DESCTOP · Hysteria2",
      server: "87.228.102.178",
      server_port: 8443,
      password: "hy_swrcfpyp",
      tls: { enabled: true, server_name: "87.228.102.178", insecure: true, alpn: ["h3"] },
    },
    { type: "direct", tag: "direct" },
    { type: "block", tag: "block" },
    { type: "dns", tag: "dns-out" },
  ],
});

describe("sing-box full-config subscription import", () => {
  it("detects a sing-box config document", () => {
    expect(looksLikeSingboxConfig(REAL_CONFIG)).toBe(true);
    expect(looksLikeSingboxConfig('{"outbounds":[]}')).toBe(true);
    expect(looksLikeSingboxConfig("vless://x@h:443")).toBe(false);
    expect(looksLikeSingboxConfig("not json")).toBe(false);
    expect(looksLikeSingboxConfig("{}")).toBe(false);
  });

  it("imports every real proxy outbound, skipping selectors and utilities", () => {
    const servers = parseSingboxConfig(REAL_CONFIG);
    // vless + shadowtls + trojan + hysteria2 = 4 (selector/urltest/direct/block/dns skipped)
    expect(servers.map((s) => s.protocol).sort()).toEqual([
      "hysteria2",
      "shadowtls",
      "trojan",
      "vless",
    ]);
  });

  it("maps VLESS Reality fields correctly", () => {
    const vless = parseSingboxConfig(REAL_CONFIG).find((s) => s.protocol === "vless")!;
    expect(vless.address).toBe("87.228.102.178");
    expect(vless.port).toBe(443);
    expect(vless.uuid).toBe("054b3fef-e801-4fe5-9533-7202105fb066");
    expect(vless.tls.security).toBe("reality");
    expect(vless.tls.sni).toBe("www.vk.ru");
    expect(vless.tls.publicKey).toBe("efbWeEnb7GzOCmWYwzow_ULRRXuTh_aihEv-9yOyHls");
    expect(vless.tls.shortId).toBe("291c0761c8");
    expect(vless.tls.fingerprint).toBe("chrome");
  });

  it("maps trojan + hysteria2 credentials and insecure TLS", () => {
    const servers = parseSingboxConfig(REAL_CONFIG);
    const trojan = servers.find((s) => s.protocol === "trojan")!;
    expect(trojan.password).toBe("XHI1PspzT4U67Ka_SYauC1");
    expect(trojan.tls.allowInsecure).toBe(true);
    const hy2 = servers.find((s) => s.protocol === "hysteria2")!;
    expect(hy2.password).toBe("hy_swrcfpyp");
    expect(hy2.transport.type).toBe("quic");
  });

  it("routes a JSON config body through parseMany end-to-end", () => {
    const r = parseMany(REAL_CONFIG);
    expect(r.servers.length).toBe(4);
    expect(r.errors.length).toBe(0);
  });

  it("reports a config with no proxy outbounds instead of silently yielding none", () => {
    const r = parseMany('{"outbounds":[{"type":"direct","tag":"direct"}]}');
    expect(r.servers.length).toBe(0);
    expect(r.errors.length).toBe(1);
  });

  it("still parses ordinary link lists and base64 (no regression)", () => {
    const links = parseMany("vless://054b3fef@87.228.102.178:443?security=reality&pbk=x#A");
    expect(links.servers.length).toBe(1);
    expect(links.servers[0].protocol).toBe("vless");
  });
});
