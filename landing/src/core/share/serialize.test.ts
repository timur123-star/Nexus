import { describe, it, expect } from "vitest";
import { parseShareLink } from "../parser";
import { serverToShareLink } from "./serialize";
import type { ServerProfile } from "../types";

/**
 * The serializer is the inverse of the parser. We assert that parsing a link,
 * serializing the resulting profile, and parsing it again preserves every field
 * the parser reads — i.e. import → share → import is lossless.
 */
const SAMPLE_LINKS = [
  "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&sni=cdn.example.com&fp=chrome&path=%2Fws&host=cdn.example.com&flow=xtls-rprx-vision#My%20VLESS",
  "vless://aaaa@reality.example.com:443?type=grpc&security=reality&pbk=PUBKEY&sid=ab12&serviceName=grpcsvc&fp=chrome#Reality",
  "trojan://secretpass@trojan.example.com:443?type=tcp&security=tls&sni=trojan.example.com#Trojan%20EU",
  "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@ss.example.com:8388#SS%20Node",
  "hysteria2://hypass@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=op#Hysteria",
  "tuic://11111111-2222-3333-4444-555555555555:tpass@tuic.example.com:443?congestion_control=bbr&udp_relay_mode=native&sni=tuic.example.com#TUIC",
];

/** Fields the parser is responsible for and the serializer must preserve. */
function fingerprint(s: ServerProfile) {
  return {
    protocol: s.protocol,
    address: s.address,
    port: s.port,
    uuid: s.uuid,
    password: s.password,
    method: s.method,
    flow: s.flow,
    transport: s.transport,
    tls: s.tls,
    extra: s.extra,
    name: s.name,
  };
}

describe("serverToShareLink round-trip", () => {
  for (const link of SAMPLE_LINKS) {
    it(`preserves fields for ${link.slice(0, 14)}…`, () => {
      const original = parseShareLink(link);
      const reparsed = parseShareLink(serverToShareLink(original));
      expect(fingerprint(reparsed)).toEqual(fingerprint(original));
    });
  }

  it("round-trips a vmess profile through base64 JSON", () => {
    const vmessLink =
      "vmess://" +
      btoa(
        JSON.stringify({
          v: "2",
          ps: "VMess Node",
          add: "vmess.example.com",
          port: 443,
          id: "11111111-2222-3333-4444-555555555555",
          aid: 0,
          scy: "auto",
          net: "ws",
          host: "cdn.example.com",
          path: "/vm",
          tls: "tls",
          sni: "cdn.example.com",
        }),
      );
    const original = parseShareLink(vmessLink);
    const reparsed = parseShareLink(serverToShareLink(original));
    expect(fingerprint(reparsed)).toEqual(fingerprint(original));
  });
});
