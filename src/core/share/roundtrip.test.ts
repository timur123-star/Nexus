import { describe, expect, it } from "vitest";
import { parseShareLink } from "../parser";
import { serverToShareLink } from "./serialize";
import type { ServerProfile } from "../types";

/**
 * The single most important invariant for a proxy client: import → export →
 * import must be STABLE. If a user imports a link, shares it, and re-imports it,
 * they must land on the same server. This locks that down per protocol so a
 * future refactor of either the parser or the serializer can never silently
 * corrupt a connection.
 */

interface Case {
  proto: string;
  link: string;
  /** Identity fields that must survive a parse→serialize→parse cycle. */
  check: (s: ServerProfile) => unknown;
}

const cases: Case[] = [
  {
    proto: "vless+reality",
    link:
      "vless://11112222-3333-4444-5555-666677778888@example.com:443?type=tcp&security=reality&pbk=PBK123&sid=SID9&flow=xtls-rprx-vision#R",
    check: (s) => [s.address, s.port, s.uuid, s.tls.security, s.tls.publicKey, s.flow],
  },
  {
    proto: "vless+ws+tls",
    link: "vless://uuid-x@cf.example.com:2053?type=ws&security=tls&path=%2Fws&host=h.com#W",
    check: (s) => [s.address, s.port, s.uuid, s.transport.type, s.transport.path],
  },
  {
    proto: "trojan",
    link: "trojan://secretpass@host.com:443?sni=host.com#T",
    check: (s) => [s.address, s.port, s.password, s.tls.sni],
  },
  {
    proto: "vmess",
    link:
      "vmess://eyJ2IjoiMiIsInBzIjoidm0iLCJhZGQiOiIxLjIuMy40IiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTIyMjItMzMzMy00NDQ0LTU1NTUtNjY2Njc3Nzc4ODg4IiwiYWlkIjoiMCIsIm5ldCI6IndzIiwidGxzIjoidGxzIn0=",
    check: (s) => [s.address, s.port, s.uuid, s.transport.type],
  },
  {
    proto: "shadowsocks",
    link: "ss://aes-256-gcm:pw123@1.2.3.4:8388#SS",
    check: (s) => [s.address, s.port, s.method, s.password],
  },
  {
    proto: "hysteria2",
    link: "hysteria2://pw@h2.example.com:443?sni=h2.example.com&alpn=h3#H2",
    check: (s) => [s.address, s.port, s.password, s.tls.sni, s.tls.alpn],
  },
  {
    proto: "hysteria",
    link: "hysteria://h.example.com:443?auth=tok&peer=h.example.com&alpn=h3,h2#HY1",
    check: (s) => [s.address, s.port, s.tls.sni, s.tls.alpn],
  },
  {
    proto: "vless+reality+pq",
    link:
      "vless://uuid-pq@pq.example.com:443?type=tcp&security=reality&pbk=PBK&sid=SID&pqv=1#PQ",
    check: (s) => [s.address, s.port, s.uuid, s.tls.security, s.tls.publicKey, s.tls.postQuantum],
  },
  {
    proto: "socks-special-creds",
    link: "socks://us%3Aer:p%40ss%3Aword@1.2.3.4:1080#SK",
    check: (s) => [s.address, s.port, s.username, s.password],
  },
  {
    proto: "http-special-creds",
    link: "http://user:p%40ss%2Fword@hp.example.com:8080#HP",
    check: (s) => [s.address, s.port, s.username, s.password],
  },
  {
    proto: "tuic",
    link: "tuic://uuid-1:pass-1@t.example.com:443?congestion_control=bbr#TUIC",
    check: (s) => [s.address, s.port, s.uuid, s.password],
  },
  {
    proto: "anytls",
    link: "anytls://pw123@a.example.com:8443?sni=a.example.com#ANY",
    check: (s) => [s.address, s.port, s.password, s.tls.sni],
  },
  {
    proto: "shadowtls",
    link:
      "shadowtls://2022-blake3-aes-128-gcm:sspass@1.2.3.4:443?password=hs&version=3&sni=www.microsoft.com#st",
    check: (s) => [s.address, s.port, s.shadowtls?.password, s.shadowtls?.version],
  },
  {
    proto: "wireguard",
    link:
      "wireguard://cPrivKeyBase64%3D@engage.cloudflareclient.com:2408?publickey=PUBKEY&mtu=1280#WG",
    check: (s) => [s.address, s.port, s.wireguard?.privateKey, s.wireguard?.peerPublicKey],
  },
  {
    proto: "juicity",
    link:
      "juicity://11112222-3333-4444-5555-666677778888:secretpw@jc.example.com:443?sni=jc.example.com&congestion_control=bbr#JC",
    check: (s) => [s.address, s.port, s.uuid, s.password, s.tls.sni, s.extra?.congestionControl],
  },
  {
    proto: "naive",
    link: "naive+https://user1:pass1@nv.example.com:443#NV",
    check: (s) => [s.address, s.port, s.username, s.password, s.tls.sni],
  },
  {
    proto: "ipv6-literal",
    link: "ss://aes-256-gcm:pw@[2001:db8::1]:8388#v6",
    check: (s) => [s.address, s.port],
  },
];

describe("share-link round-trip stability (import → export → import)", () => {
  for (const c of cases) {
    it(`${c.proto} survives a full cycle unchanged`, () => {
      const first = parseShareLink(c.link);
      const reLink = serverToShareLink(first);
      const second = parseShareLink(reLink);

      expect(second.protocol).toBe(first.protocol);
      expect(c.check(second)).toEqual(c.check(first));
      // A second export must be byte-identical to the first (fixed point).
      expect(serverToShareLink(second)).toBe(reLink);
    });
  }

  it("every parsed protocol can be serialized back without throwing", () => {
    for (const c of cases) {
      const s = parseShareLink(c.link);
      expect(() => serverToShareLink(s)).not.toThrow();
    }
  });
});
