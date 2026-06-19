import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSingboxConfig } from "./singbox/configGen";
import { generateXrayConfig } from "./xray/configGen";
import { parseMany } from "./parser/index";
import type { ServerProfile } from "./types";

/**
 * Live integration: the configs our generators emit must be *accepted by the
 * real core binaries*, not merely match a hand-written expected-JSON snapshot.
 * `sing-box check` / `xray run -test` fully parse and validate the config
 * (every field, every transport) and exit non-zero on anything they can't run.
 *
 * Skips automatically when the sidecar binaries haven't been fetched (e.g. a
 * CI lane that runs unit tests before `npm run fetch-cores`), so it never makes
 * the suite red on a machine without cores.
 */
const BIN = join(process.cwd(), "src-tauri", "binaries");
const SINGBOX = join(BIN, process.platform === "win32" ? "sing-box.exe" : "sing-box");
const XRAY = join(BIN, process.platform === "win32" ? "xray.exe" : "xray");
const haveSingbox = existsSync(SINGBOX);
const haveXray = existsSync(XRAY);

const sbOpts = {
  mixedPort: 2080,
  clashApiPort: 9090,
  clashSecret: "s",
  routingMode: "rule" as const,
  tun: { enabled: false, stack: "system" as const },
  allowLan: false,
  fakeIp: true,
  dns: { remote: "", direct: "" },
};

function srv(over: Partial<ServerProfile>): ServerProfile {
  return {
    id: "t",
    name: "t",
    protocol: "vless",
    address: "example.com",
    port: 443,
    transport: { type: "tcp" },
    tls: { enabled: false, security: "none" },
    tags: [],
    favorite: false,
    latencyMs: null,
    createdAt: 0,
    ...over,
  } as ServerProfile;
}

const dir = mkdtempSync(join(tmpdir(), "nexus-cfg-"));
function checkSingbox(cfg: unknown, name: string): void {
  const p = join(dir, `sb-${name}.json`);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  // `sing-box check` exits 0 only when the whole config is valid & runnable.
  execFileSync(SINGBOX, ["check", "-c", p], { stdio: "pipe" });
}
function checkXray(cfg: unknown, name: string): void {
  const p = join(dir, `xr-${name}.json`);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  // `xray run -test -c` fully loads the config then exits 0 without serving.
  execFileSync(XRAY, ["run", "-test", "-c", p], { stdio: "pipe" });
}

describe.skipIf(!haveSingbox)("sing-box accepts generated configs", () => {
  it("VLESS + REALITY", () => {
    const cfg = generateSingboxConfig(
      srv({
        uuid: "u",
        tls: {
          enabled: true,
          security: "reality",
          publicKey: "mL8S_P3Szjj-uDI32836ntWvHTJDu52Q-uMLnsBuyAU",
          shortId: "0123abcd",
        },
      }),
      sbOpts,
    );
    expect(() => checkSingbox(cfg, "vless-reality")).not.toThrow();
  });
  it("Hysteria2", () => {
    const cfg = generateSingboxConfig(
      srv({
        protocol: "hysteria2",
        password: "pw",
        tls: { enabled: true, security: "tls", sni: "h" },
      }),
      sbOpts,
    );
    expect(() => checkSingbox(cfg, "hy2")).not.toThrow();
  });
  it("Trojan", () => {
    const cfg = generateSingboxConfig(
      srv({
        protocol: "trojan",
        password: "pw",
        tls: { enabled: true, security: "tls", sni: "h" },
      }),
      sbOpts,
    );
    expect(() => checkSingbox(cfg, "trojan")).not.toThrow();
  });
  it("Shadowsocks", () => {
    const cfg = generateSingboxConfig(
      srv({
        protocol: "shadowsocks",
        method: "aes-128-gcm",
        password: "pw",
        tls: { enabled: false, security: "none" },
      }),
      sbOpts,
    );
    expect(() => checkSingbox(cfg, "ss")).not.toThrow();
  });
});

describe.skipIf(!haveXray)("xray accepts generated configs", () => {
  it("VLESS + REALITY", () => {
    const cfg = generateXrayConfig(
      srv({
        uuid: "u",
        tls: {
          enabled: true,
          security: "reality",
          publicKey: "mL8S_P3Szjj-uDI32836ntWvHTJDu52Q-uMLnsBuyAU",
          shortId: "0123abcd",
        },
      }),
      { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule", allowLan: false },
    );
    expect(() => checkXray(cfg, "vless-reality")).not.toThrow();
  });
});

/**
 * End-to-end on a REAL sing-box full-config subscription body (the kittenx/x-ui
 * shape that previously imported zero servers): parse it, then prove every
 * imported node generates a config the real cores accept — including TUN mode,
 * which is the exact path that silently tunnelled nothing before.
 */
const SUB_CONFIG = JSON.stringify({
  outbounds: [
    { type: "selector", tag: "select", outbounds: ["auto"] },
    {
      type: "vless",
      tag: "Reality",
      server: "87.228.102.178",
      server_port: 443,
      uuid: "054b3fef-e801-4fe5-9533-7202105fb066",
      tls: {
        enabled: true,
        server_name: "www.vk.ru",
        utls: { enabled: true, fingerprint: "chrome" },
        reality: {
          enabled: true,
          public_key: "mL8S_P3Szjj-uDI32836ntWvHTJDu52Q-uMLnsBuyAU",
          short_id: "0123abcd",
        },
      },
    },
    {
      type: "trojan",
      tag: "Trojan",
      server: "87.228.102.178",
      server_port: 8442,
      password: "XHI1PspzT4U67Ka_SYauC1",
      tls: {
        enabled: true,
        server_name: "87.228.102.178",
        insecure: true,
        alpn: ["h2", "http/1.1"],
      },
    },
    {
      type: "hysteria2",
      tag: "Hysteria2",
      server: "87.228.102.178",
      server_port: 8443,
      password: "hy_swrcfpyp",
      tls: { enabled: true, server_name: "87.228.102.178", insecure: true, alpn: ["h3"] },
    },
    { type: "direct", tag: "direct" },
  ],
});

/**
 * Broad protocol matrix validated against the REAL sing-box binary. These are
 * the combos that previously slipped through (the cores unit test only checks
 * JSON-serializability, never real-core acceptance). Each must `check` clean.
 */
describe.skipIf(!haveSingbox)("sing-box accepts every supported protocol", () => {
  const cases: Array<[string, ServerProfile]> = [
    [
      "vmess-ws",
      srv({
        protocol: "vmess",
        uuid: "11112222-3333-4444-5555-666677778888",
        transport: { type: "ws", path: "/ws", host: "h.com" },
        tls: { enabled: true, security: "tls", sni: "h.com" },
      }),
    ],
    [
      "tuic",
      srv({
        protocol: "tuic",
        uuid: "11112222-3333-4444-5555-666677778888",
        password: "pw",
        transport: { type: "quic" },
        tls: { enabled: true, security: "tls", sni: "h" },
      }),
    ],
    // hysteria v1 WITHOUT bandwidth in `extra` — regression for the FATAL
    // "missing upload speed" the generator now fixes with defaults.
    [
      "hysteria-no-bw",
      srv({
        protocol: "hysteria",
        password: "pw",
        transport: { type: "quic" },
        tls: { enabled: true, security: "tls", sni: "h" },
      }),
    ],
    [
      "shadowtls",
      srv({
        protocol: "shadowtls",
        transport: { type: "tcp" },
        tls: { enabled: true, security: "tls", sni: "www.microsoft.com" },
        shadowtls: { version: 3, password: "hs", method: "aes-128-gcm", ssPassword: "sspw" },
      }),
    ],
    [
      "socks",
      srv({
        protocol: "socks",
        port: 1080,
        transport: { type: "tcp" },
        tls: { enabled: false, security: "none" },
      }),
    ],
    [
      "http",
      srv({
        protocol: "http",
        port: 8080,
        transport: { type: "tcp" },
        tls: { enabled: false, security: "none" },
      }),
    ],
  ];
  for (const [name, server] of cases) {
    it(name, () => {
      const cfg = generateSingboxConfig(server, sbOpts);
      expect(() => checkSingbox(cfg, `matrix-${name}`)).not.toThrow();
    });
  }
});

describe.skipIf(!haveSingbox)("real subscription config → sing-box (incl. TUN)", () => {
  const servers = parseMany(SUB_CONFIG).servers;

  it("imports the expected proxy nodes", () => {
    expect(servers.map((s) => s.protocol).sort()).toEqual(["hysteria2", "trojan", "vless"]);
  });

  it("every imported node is accepted by sing-box in proxy mode", () => {
    for (const s of servers) {
      const cfg = generateSingboxConfig(s, sbOpts);
      expect(() => checkSingbox(cfg, `sub-proxy-${s.protocol}`)).not.toThrow();
    }
  });

  it("every imported node is accepted by sing-box in TUN (VPN) mode", () => {
    for (const s of servers) {
      const cfg = generateSingboxConfig(s, {
        ...sbOpts,
        tun: { enabled: true, stack: "system" as const },
      });
      expect(() => checkSingbox(cfg, `sub-tun-${s.protocol}`)).not.toThrow();
    }
  });
});
