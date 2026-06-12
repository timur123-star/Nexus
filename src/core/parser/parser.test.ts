import { describe, it, expect } from "vitest";
import { parseShareLink, parseMany, detectFormat, ParseError } from "./index";

describe("parseShareLink — vless", () => {
  it("parses a Reality vless link with vision flow", () => {
    const link =
      "vless://11112222-3333-4444-5555-666677778888@example.com:443" +
      "?type=tcp&security=reality&sni=www.microsoft.com&fp=chrome" +
      "&pbk=ABCDEF&sid=00aa&flow=xtls-rprx-vision#RU-Reality";
    const s = parseShareLink(link);
    expect(s.protocol).toBe("vless");
    expect(s.address).toBe("example.com");
    expect(s.port).toBe(443);
    expect(s.uuid).toBe("11112222-3333-4444-5555-666677778888");
    expect(s.flow).toBe("xtls-rprx-vision");
    expect(s.name).toBe("RU-Reality");
    expect(s.tls.security).toBe("reality");
    expect(s.tls.publicKey).toBe("ABCDEF");
    expect(s.tls.shortId).toBe("00aa");
    expect(s.tls.fingerprint).toBe("chrome");
    expect(s.transport.type).toBe("tcp");
  });

  it("parses a ws+tls vless link with path and host", () => {
    const link =
      "vless://uuid-x@cf.example.com:2053?type=ws&security=tls" +
      "&path=%2Fwspath&host=cdn.example.com&sni=cdn.example.com#FR-CDN";
    const s = parseShareLink(link);
    expect(s.transport.type).toBe("ws");
    expect(s.transport.path).toBe("/wspath");
    expect(s.transport.host).toBe("cdn.example.com");
    expect(s.tls.security).toBe("tls");
    expect(s.tls.sni).toBe("cdn.example.com");
  });
});

describe("parseShareLink — vmess", () => {
  it("parses a base64 vmess link", () => {
    const json = {
      v: "2",
      ps: "MyVmess",
      add: "1.2.3.4",
      port: "443",
      id: "aaaa-bbbb",
      aid: "0",
      scy: "auto",
      net: "ws",
      path: "/v",
      host: "h.example.com",
      tls: "tls",
      sni: "h.example.com",
    };
    const link = "vmess://" + Buffer.from(JSON.stringify(json)).toString("base64");
    const s = parseShareLink(link);
    expect(s.protocol).toBe("vmess");
    expect(s.name).toBe("MyVmess");
    expect(s.address).toBe("1.2.3.4");
    expect(s.uuid).toBe("aaaa-bbbb");
    expect(s.transport.type).toBe("ws");
    expect(s.transport.path).toBe("/v");
    expect(s.tls.enabled).toBe(true);
  });

  it("throws on non-base64 vmess payload", () => {
    expect(() => parseShareLink("vmess://%%%notbase64%%%")).toThrow(ParseError);
  });
});

describe("parseShareLink — trojan", () => {
  it("defaults to TLS and parses password", () => {
    const s = parseShareLink("trojan://secretpass@host.com:443?sni=host.com#T1");
    expect(s.protocol).toBe("trojan");
    expect(s.password).toBe("secretpass");
    expect(s.tls.security).toBe("tls");
    expect(s.tls.sni).toBe("host.com");
  });
});

describe("parseShareLink — shadowsocks", () => {
  it("parses SIP002 (plain userinfo)", () => {
    const s = parseShareLink("ss://aes-256-gcm:pw123@1.2.3.4:8388#SS-Plain");
    expect(s.protocol).toBe("shadowsocks");
    expect(s.method).toBe("aes-256-gcm");
    expect(s.password).toBe("pw123");
    expect(s.port).toBe(8388);
  });

  it("parses SIP002 with base64 userinfo", () => {
    const userinfo = Buffer.from("chacha20-ietf-poly1305:secret").toString("base64");
    const s = parseShareLink(`ss://${userinfo}@9.9.9.9:8388#SS-B64`);
    expect(s.method).toBe("chacha20-ietf-poly1305");
    expect(s.password).toBe("secret");
    expect(s.address).toBe("9.9.9.9");
  });

  it("parses legacy fully-base64 form", () => {
    const body = Buffer.from("aes-128-gcm:pw@5.5.5.5:1234").toString("base64");
    const s = parseShareLink(`ss://${body}#Legacy`);
    expect(s.method).toBe("aes-128-gcm");
    expect(s.port).toBe(1234);
  });
});

describe("parseShareLink — hysteria2 / tuic", () => {
  it("parses hy2 alias with obfs", () => {
    const s = parseShareLink("hy2://pw@h.example.com:443?sni=h.example.com&obfs=salamander&obfs-password=xyz#HY2");
    expect(s.protocol).toBe("hysteria2");
    expect(s.password).toBe("pw");
    expect(s.extra?.obfs).toBe("salamander");
    expect(s.extra?.obfsPassword).toBe("xyz");
  });

  it("parses tuic with uuid:password", () => {
    const s = parseShareLink("tuic://uuid-1:pass-1@t.example.com:443?congestion_control=bbr&udp_relay_mode=native#TUIC");
    expect(s.protocol).toBe("tuic");
    expect(s.uuid).toBe("uuid-1");
    expect(s.password).toBe("pass-1");
    expect(s.extra?.congestionControl).toBe("bbr");
  });
});

describe("parseShareLink — errors", () => {
  it("rejects unknown scheme", () => {
    expect(() => parseShareLink("ftp://x")).toThrow(/unsupported protocol/);
  });
  it("rejects non-links", () => {
    expect(() => parseShareLink("just some text")).toThrow(/no scheme/);
  });
});

describe("parseMany", () => {
  it("parses a newline list and de-duplicates", () => {
    const text = [
      "trojan://p@a.com:443#A",
      "trojan://p@a.com:443#A", // dup
      "vless://u@b.com:443?type=tcp#B",
      "garbage line",
    ].join("\n");
    const { servers, errors } = parseMany(text);
    expect(servers).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("unrecognised line");
  });

  it("decodes a base64 subscription body", () => {
    const inner = ["trojan://p@a.com:443#A", "vless://u@b.com:443?type=tcp#B"].join("\n");
    const sub = Buffer.from(inner).toString("base64");
    const { servers } = parseMany(sub);
    expect(servers).toHaveLength(2);
  });
});

describe("detectFormat", () => {
  it("classifies inputs", () => {
    expect(detectFormat("vless://u@h:443#x")).toBe("share-link");
    expect(detectFormat('{"outbounds":[]}')).toBe("json");
    expect(detectFormat("trojan://a@h:1#x\nvless://b@h:2#y")).toBe("link-list");
    expect(detectFormat(Buffer.from("trojan://a@h:1").toString("base64"))).toBe("base64-subscription");
    expect(detectFormat("")).toBe("unknown");
  });
});
