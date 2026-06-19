/**
 * Subscription/link import stress audit — throws realistic, real-world share
 * links and subscription bodies (base64, link-list, mixed, whitespace, comments,
 * URL-safe base64, padded/unpadded, MIME line-wrapped) at the parser and asserts
 * every entry is imported correctly, deduped sanely, and that subscription URLs
 * are never mistaken for proxy share links. Regression guard for the import flow.
 */
import { describe, it, expect } from "vitest";
import { parseMany, parseShareLink } from "./index";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const b64url = (s: string) =>
  Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// One realistic link per protocol / scheme.
const vmess =
  "vmess://" +
  b64(
    JSON.stringify({
      v: "2",
      ps: "VMess WS TLS",
      add: "v.example.com",
      port: "443",
      id: "b831381d-6324-4d53-ad4f-8cda48b30811",
      aid: "0",
      scy: "auto",
      net: "ws",
      type: "none",
      host: "cdn.example.com",
      path: "/vm",
      tls: "tls",
      sni: "cdn.example.com",
    }),
  );
const ssSip002 = "ss://" + b64("aes-256-gcm:hunter2") + "@ss.example.com:8388#SS%20SIP002";
const ssLegacy =
  "ss://" + b64("chacha20-ietf-poly1305:p%40ss@ss2.example.com:443") + "#SS%20Legacy";
const ssPlugin =
  "ss://" +
  b64("aes-128-gcm:secret") +
  "@ss3.example.com:8388?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dwww.bing.com#SS%20obfs";

const LINKS: Record<string, string> = {
  "vless-ws-tls":
    "vless://uuid-aaaa-bbbb@v.example.com:443?type=ws&security=tls&sni=ex.com&host=cdn.com&path=%2Fws&flow=&encryption=none#VLESS%20WS",
  "vless-reality":
    "vless://uuid-cccc-dddd@r.example.com:443?type=tcp&security=reality&pbk=PUBKEY123&sid=ab12&fp=chrome&sni=www.microsoft.com&flow=xtls-rprx-vision#VLESS%20REALITY",
  "vless-xhttp":
    "vless://uuid-eeee@x.example.com:443?type=xhttp&security=tls&path=%2Fxh&host=h.com&sni=h.com&mode=auto#XHTTP",
  vmess,
  "trojan-grpc":
    "trojan://p%40ssw0rd@t.example.com:443?type=grpc&serviceName=grpcsvc&security=tls&sni=t.example.com#Trojan%20gRPC",
  "ss-sip002": ssSip002,
  "ss-legacy": ssLegacy,
  "ss-plugin": ssPlugin,
  hysteria2:
    "hysteria2://pa%24%24@h2.example.com:443?sni=h2.example.com&obfs=salamander&obfs-password=zzz&insecure=1#Hy2",
  "hy2-alias": "hy2://auth123@h2b.example.com:8443?sni=h2b.example.com#Hy2%20alias",
  hysteria1:
    "hysteria://h1.example.com:36712?auth=secret&peer=h1.example.com&insecure=1&upmbps=50&downmbps=200&obfs=xplus#Hy1",
  tuic: "tuic://uuid-tttt:tpass@tu.example.com:443?congestion_control=bbr&udp_relay_mode=native&sni=tu.example.com&alpn=h3#TUIC",
  wireguard:
    "wireguard://cPrivKeyBase64%3D@wg.example.com:51820?publickey=PeerPubKey%3D&presharedkey=PSK%3D&address=172.16.0.2%2F32,fd01::2%2F128&reserved=0,0,0&mtu=1420#WG",
  "wg-alias": "wg://privKey2@wg2.example.com:51820?publickey=peer2&address=10.0.0.2#WG%20alias",
  anytls: "anytls://anypass@at.example.com:8443?sni=at.example.com&insecure=0#AnyTLS",
  shadowtls:
    "shadowtls://aes-256-gcm:innerpass@st.example.com:443?password=handshakepw&version=3&sni=www.apple.com#ShadowTLS",
  ssh: "ssh://root:rootpw@ssh.example.com:22#SSH",
  "ssh-key":
    "ssh://deploy@ssh2.example.com:2222?privateKey=" +
    b64url("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----") +
    "&passphrase=pp#SSH%20key",
  tor: "tor://#Tor",
  socks5: "socks5://" + b64("u:p") + "@sk.example.com:1080#SOCKS5",
  "socks-plain": "socks://user:pass@sk2.example.com:1080#SOCKS%20plain",
  http: "http://user:pass@hp.example.com:8080#HTTP%20proxy",
  https: "https://user:pass@hps.example.com:8443#HTTPS%20proxy",
};

describe("subscription import stress audit", () => {
  it("parses every protocol share link individually", () => {
    for (const [name, link] of Object.entries(LINKS)) {
      const s = parseShareLink(link);
      expect(s.address, `${name}: address`).toBeTruthy();
      expect(s.port, `${name}: port`).toBeGreaterThan(0);
      expect(s.protocol, `${name}: protocol`).toBeTruthy();
      expect(s.name, `${name}: name`).toBeTruthy();
    }
  });

  it("parses a plain newline link-list with comments & blank lines", () => {
    const body = [
      "# my subscription",
      "",
      LINKS["vless-ws-tls"],
      "  ",
      "// note",
      LINKS.vmess,
      LINKS["ss-sip002"],
      LINKS.tuic,
    ].join("\n");
    const { servers, errors } = parseMany(body);
    expect(errors).toHaveLength(0);
    expect(servers).toHaveLength(4);
  });

  it("parses a base64-encoded subscription body (padded)", () => {
    const raw = Object.values(LINKS).join("\n");
    const { servers, errors } = parseMany(b64(raw));
    expect(errors).toHaveLength(0);
    expect(servers.length).toBe(Object.keys(LINKS).length);
  });

  it("parses a URL-safe, UNPADDED base64 subscription body", () => {
    const raw = [LINKS["vless-reality"], LINKS.hysteria2, LINKS.wireguard, LINKS.shadowtls].join(
      "\n",
    );
    const { servers, errors } = parseMany(b64url(raw));
    expect(errors).toHaveLength(0);
    expect(servers).toHaveLength(4);
  });

  it("parses a MIME/line-wrapped (whitespace) base64 body", () => {
    const raw = [LINKS.vmess, LINKS["trojan-grpc"], LINKS["ss-legacy"]].join("\n");
    const wrapped = b64(raw).replace(/(.{16})/g, "$1\n"); // inject newlines every 16 chars
    const { servers, errors } = parseMany(wrapped);
    expect(errors).toHaveLength(0);
    expect(servers).toHaveLength(3);
  });

  it("dedups identical endpoints but keeps CDN variants distinct", () => {
    const dup = [LINKS["vless-ws-tls"], LINKS["vless-ws-tls"]].join("\n");
    expect(parseMany(dup).servers).toHaveLength(1);
    // same host/uuid but different path+host (CDN) must stay separate
    const variant = LINKS["vless-ws-tls"]
      .replace("%2Fws", "%2Fother")
      .replace("cdn.com", "cdn2.com");
    expect(parseMany([LINKS["vless-ws-tls"], variant].join("\n")).servers).toHaveLength(2);
  });

  it("collects errors for bad lines without dropping the good ones", () => {
    const body = [LINKS.vmess, "vless://", "garbage line", "ss://!!!invalid", LINKS.tuic].join(
      "\n",
    );
    const { servers, errors } = parseMany(body);
    expect(servers).toHaveLength(2); // vmess + tuic
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT misparse a real subscription URL as an http proxy", () => {
    expect(() => parseShareLink("https://panel.example.com/sub/abcd1234")).toThrow();
    expect(() =>
      parseShareLink("https://panel.example.com/api/v1/client/subscribe?token=x"),
    ).toThrow();
  });
});
