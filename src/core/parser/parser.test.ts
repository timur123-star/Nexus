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

  it("normalizes UPPERCASE/mixed-case query keys (3x-ui / Hiddify exports)", () => {
    // Some panels emit capitalized query keys. Before key normalization these
    // missed every q.security / q.pbk lookup and the node silently degraded to
    // plain TLS (or none), breaking the REALITY handshake on import.
    const link =
      "vless://11112222-3333-4444-5555-666677778888@example.com:443" +
      "?Type=grpc&Security=reality&SNI=www.microsoft.com&FP=chrome" +
      "&PBK=ABCDEF&SID=00aa&Flow=xtls-rprx-vision&ServiceName=mygrpc#UP";
    const s = parseShareLink(link);
    expect(s.tls.security).toBe("reality");
    expect(s.tls.publicKey).toBe("ABCDEF");
    expect(s.tls.shortId).toBe("00aa");
    expect(s.tls.fingerprint).toBe("chrome");
    expect(s.flow).toBe("xtls-rprx-vision");
    expect(s.transport.type).toBe("grpc");
    expect(s.transport.serviceName).toBe("mygrpc");
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

  it("derives grpc serviceName from path when serviceName is absent", () => {
    const s = parseShareLink("vless://u@h.example.com:443?type=grpc&path=mygrpcsvc#G");
    expect(s.transport.type).toBe("grpc");
    expect(s.transport.serviceName).toBe("mygrpcsvc");
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

  it("throws when the vmess payload is missing an address", () => {
    const json = { ps: "NoAddr", id: "aaaa-bbbb", port: "443", net: "tcp" };
    const link = "vmess://" + Buffer.from(JSON.stringify(json)).toString("base64");
    expect(() => parseShareLink(link)).toThrow(/missing address/);
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

  it("parses an IPv6 SIP002 host", () => {
    const s = parseShareLink("ss://aes-256-gcm:pw@[2001:db8::1]:8388#v6");
    expect(s.address).toBe("2001:db8::1");
    expect(s.port).toBe(8388);
  });

  it("rejects a bracketed IPv6 host with no port instead of inventing one", () => {
    // The bracket path must only read a port when ':' actually follows the
    // closing bracket — a missing/garbled port has to fail host/port validation
    // rather than slice address digits into a bogus port.
    expect(() => parseShareLink("ss://aes-256-gcm:pw@[2001:db8::1]#v6")).toThrow(ParseError);
    expect(() => parseShareLink("ss://aes-256-gcm:pw@[2001:db8::1]junk#v6")).toThrow(ParseError);
  });

  it("extracts a plugin/obfs query", () => {
    const s = parseShareLink("ss://aes-256-gcm:pw@1.2.3.4:8388?plugin=obfs-local%3Bobfs%3Dhttp#Obfs");
    expect(s.extra?.obfs).toContain("obfs-local");
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

  it("parses tuic with uuid:password in userinfo", () => {
    const s = parseShareLink("tuic://uuid-1:pass-1@t.example.com:443?congestion_control=bbr&udp_relay_mode=native#TUIC");
    expect(s.protocol).toBe("tuic");
    expect(s.uuid).toBe("uuid-1");
    expect(s.password).toBe("pass-1");
    expect(s.extra?.congestionControl).toBe("bbr");
  });

  it("parses tuic credentials supplied via query params", () => {
    const s = parseShareLink("tuic://uuid-2@t.example.com:443?password=pw2&congestion_control=cubic#TUIC2");
    expect(s.uuid).toBe("uuid-2");
    expect(s.password).toBe("pw2");
    expect(s.extra?.congestionControl).toBe("cubic");
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

  it("de-duplicates the same endpoint even with different remarks", () => {
    const text = [
      "trojan://p@a.com:443#First",
      "trojan://p@a.com:443#SecondTagDiffers",
    ].join("\n");
    const { servers } = parseMany(text);
    expect(servers).toHaveLength(1);
  });

  it("decodes a base64 subscription body", () => {
    const inner = ["trojan://p@a.com:443#A", "vless://u@b.com:443?type=tcp#B"].join("\n");
    const sub = Buffer.from(inner).toString("base64");
    const { servers } = parseMany(sub);
    expect(servers).toHaveLength(2);
  });

  it("decodes a line-wrapped (MIME) base64 subscription body", () => {
    const inner = ["trojan://p@a.com:443#A", "vless://u@b.com:443?type=tcp#B"].join("\n");
    // Many providers (incl. 3x-ui) wrap the base64 body across multiple lines.
    const wrapped = Buffer.from(inner).toString("base64").replace(/(.{16})/g, "$1\n");
    expect(wrapped).toContain("\n");
    const { servers } = parseMany(wrapped);
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

  it("classifies a line-wrapped base64 body as a subscription", () => {
    const wrapped = Buffer.from("trojan://a@h:1#x\nvless://b@h:2#y")
      .toString("base64")
      .replace(/(.{16})/g, "$1\n");
    expect(detectFormat(wrapped)).toBe("base64-subscription");
  });
});

describe("parseShareLink — xhttp + post-quantum reality (3x-ui modern nodes)", () => {
  it("parses a VLESS Reality XHTTP link (was silently falling back to tcp)", () => {
    const link =
      "vless://uuid-xh@1.2.3.4:8444?encryption=none&security=reality" +
      "&type=xhttp&mode=auto&path=%2Fxh&host=www.nvidia.com" +
      "&extra=%7B%22xPaddingBytes%22%3A%22100-1000%22%7D" +
      "&pbk=PBK&sid=SID&sni=ya.ru&fp=chrome#XHTTP";
    const s = parseShareLink(link);
    expect(s.transport.type).toBe("xhttp");
    expect(s.transport.path).toBe("/xh");
    expect(s.transport.host).toBe("www.nvidia.com");
    expect(s.transport.mode).toBe("auto");
    expect(s.transport.xhttpExtra).toEqual({ xPaddingBytes: "100-1000" });
    expect(s.tls.security).toBe("reality");
  });

  it("accepts the legacy `splithttp` spelling", () => {
    const s = parseShareLink("vless://u@h:443?type=splithttp&security=tls#S");
    expect(s.transport.type).toBe("xhttp");
  });

  it("captures the post-quantum reality verify key (pqv)", () => {
    const s = parseShareLink(
      "vless://u@h:443?type=tcp&security=reality&pbk=PBK&sid=SID&pqv=PQVKEY123#PQ",
    );
    expect(s.tls.postQuantum).toBe("PQVKEY123");
  });

  it("falls back to discrete x_padding_bytes when extra JSON is absent", () => {
    const s = parseShareLink(
      "vless://u@h:8444?type=xhttp&x_padding_bytes=100-1000&security=tls#XP",
    );
    expect(s.transport.xhttpExtra).toEqual({ xPaddingBytes: "100-1000" });
  });
});

describe("parseShareLink — wireguard / socks / hysteria(v1) / anytls", () => {
  it("parses a WireGuard link with address, reserved and mtu", () => {
    const link =
      "wireguard://cPrivKeyBase64%3D@engage.cloudflareclient.com:2408" +
      "?publickey=PeerPubKey%3D&address=172.16.0.2/32,fd01:5ca1:ab1e:80fa::1/128" +
      "&reserved=1,2,3&mtu=1280#WARP";
    const s = parseShareLink(link);
    expect(s.protocol).toBe("wireguard");
    expect(s.address).toBe("engage.cloudflareclient.com");
    expect(s.port).toBe(2408);
    expect(s.wireguard?.privateKey).toBe("cPrivKeyBase64=");
    expect(s.wireguard?.peerPublicKey).toBe("PeerPubKey=");
    expect(s.wireguard?.localAddress).toEqual([
      "172.16.0.2/32",
      "fd01:5ca1:ab1e:80fa::1/128",
    ]);
    expect(s.wireguard?.reserved).toEqual([1, 2, 3]);
    expect(s.wireguard?.mtu).toBe(1280);
    expect(s.name).toBe("WARP");
  });

  it("accepts the wg:// alias and defaults a bare address to /32", () => {
    const s = parseShareLink("wg://priv@1.2.3.4:51820?publickey=pub&address=10.0.0.2#WG");
    expect(s.protocol).toBe("wireguard");
    expect(s.wireguard?.localAddress).toEqual(["10.0.0.2/32"]);
  });

  it("throws when WireGuard is missing the peer public key", () => {
    expect(() => parseShareLink("wireguard://priv@1.2.3.4:51820#x")).toThrow(/public key/);
  });

  it("parses a SOCKS5 link with base64 userinfo", () => {
    const userinfo = Buffer.from("alice:s3cret").toString("base64");
    const s = parseShareLink(`socks://${userinfo}@1.2.3.4:1080#Proxy`);
    expect(s.protocol).toBe("socks");
    expect(s.username).toBe("alice");
    expect(s.password).toBe("s3cret");
    expect(s.port).toBe(1080);
  });

  it("parses a socks5:// link without auth", () => {
    const s = parseShareLink("socks5://9.9.9.9:1080#NoAuth");
    expect(s.protocol).toBe("socks");
    expect(s.username).toBeUndefined();
    expect(s.address).toBe("9.9.9.9");
  });

  it("parses a Hysteria v1 link with auth + bandwidth", () => {
    const s = parseShareLink(
      "hysteria://h.example.com:443?auth=mytoken&peer=h.example.com&insecure=1&upmbps=50&downmbps=200&obfs=xplus#HY1",
    );
    expect(s.protocol).toBe("hysteria");
    expect(s.extra?.auth).toBe("mytoken");
    expect(s.tls.sni).toBe("h.example.com");
    expect(s.tls.allowInsecure).toBe(true);
    expect(s.extra?.upMbps).toBe(50);
    expect(s.extra?.downMbps).toBe(200);
    expect(s.extra?.obfs).toBe("xplus");
  });

  it("parses an AnyTLS link", () => {
    const s = parseShareLink("anytls://pw123@a.example.com:8443?sni=a.example.com&insecure=1#ANY");
    expect(s.protocol).toBe("anytls");
    expect(s.password).toBe("pw123");
    expect(s.tls.sni).toBe("a.example.com");
    expect(s.tls.allowInsecure).toBe(true);
  });
});
