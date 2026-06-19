import { generateSingboxConfig } from "./src/core/singbox/configGen";
import { generateXrayConfig } from "./src/core/xray/configGen";

const baseOpts: any = {
  mixedPort: 2080,
  clashApiPort: 9090,
  clashSecret: "testsecret",
  routingMode: "rule",
  tun: { enabled: false, stack: "system" },
  allowLan: false,
  fakeIp: true,
  dns: { remote: "https://1.1.1.1/dns-query", direct: "https://223.5.5.5/dns-query" },
  customRules: [],
  blockQuic: false,
  mux: { enabled: false, protocol: "smux" },
  fragment: { enabled: false, packets: "tlshello", length: "10-20", interval: "10-20" },
};

const trojan: any = {
  id: "t1", name: "DESKTOP Trojan", protocol: "trojan",
  address: "trojan.example.com", port: 443, password: "pw123",
  transport: { type: "tcp" },
  tls: { enabled: true, security: "tls", sni: "trojan.example.com" },
  tags: [], favorite: false, createdAt: 0,
};

const reality: any = {
  id: "r1", name: "DESKTOP Reality", protocol: "vless",
  address: "reality.example.com", port: 443, uuid: "11111111-2222-3333-4444-555555555555",
  flow: "xtls-rprx-vision",
  transport: { type: "tcp" },
  tls: { enabled: true, security: "reality", sni: "www.microsoft.com", publicKey: "PUBKEYBASE64", shortId: "abcd", fingerprint: "chrome" },
  tags: [], favorite: false, createdAt: 0,
};

function dump(label: string, fn: () => object) {
  console.log("\n===== " + label + " =====");
  try {
    const cfg = fn();
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.log("THREW: " + (e instanceof Error ? e.message : String(e)));
  }
}

dump("sing-box / Trojan / rule", () => generateSingboxConfig(trojan, baseOpts));
dump("sing-box / Reality / rule", () => generateSingboxConfig(reality, baseOpts));
dump("sing-box / Trojan / global", () => generateSingboxConfig(trojan, { ...baseOpts, routingMode: "global" }));
dump("xray / Reality / rule", () => generateXrayConfig(reality, { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule", allowLan: false, customRules: [], blockQuic: false, fragment: null, mux: null } as any));
dump("xray / Trojan / rule", () => generateXrayConfig(trojan, { mixedPort: 2080, clashApiPort: 9090, routingMode: "rule", allowLan: false, customRules: [], blockQuic: false, fragment: null, mux: null } as any));
