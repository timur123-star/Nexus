/**
 * Serialize a {@link ServerProfile} back into a standard share-link.
 *
 * This is the inverse of the parsers in `../parser/protocols.ts` and powers the
 * "Share" action (copy link / show QR). It is intentionally kept lossless for
 * the fields our parser reads back, so import → export → import round-trips.
 */
import type { ServerProfile, TlsSettings, TransportSettings } from "../types";

/** Standard base64 (no url-safe substitution) for vmess payloads. */
function encodeBase64(input: string): string {
  if (typeof btoa === "function") {
    // Encode UTF-8 safely before btoa (which is latin1-only).
    const utf8 = encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    return btoa(utf8);
  }
  return Buffer.from(input, "utf-8").toString("base64");
}

/** Map our Transport union back to the spelling used in share links. */
function transportParam(t: TransportSettings): string {
  // "h2" stays "h2" (parser normalises both "h2"/"http" → "h2").
  return t.type;
}

/** Append the query params a parser reads from `transport`. */
function addTransportParams(p: URLSearchParams, t: TransportSettings): void {
  if (t.path) p.set("path", t.path);
  if (t.host) p.set("host", t.host);
  if (t.serviceName) p.set("serviceName", t.serviceName);
}

/** Append the query params a parser reads from `tls`. */
function addTlsParams(p: URLSearchParams, tls: TlsSettings): void {
  p.set("security", tls.security);
  if (tls.sni) p.set("sni", tls.sni);
  if (tls.fingerprint) p.set("fp", tls.fingerprint);
  if (tls.alpn?.length) p.set("alpn", tls.alpn.join(","));
  if (tls.allowInsecure) p.set("allowInsecure", "1");
  if (tls.security === "reality") {
    if (tls.publicKey) p.set("pbk", tls.publicKey);
    if (tls.shortId) p.set("sid", tls.shortId);
    if (tls.spiderX) p.set("spx", tls.spiderX);
    // Post-quantum (ML-DSA-65) REALITY: the parser reads `pqv` back into
    // `tls.postQuantum`. Dropping it here makes a PQ node silently re-import as
    // a plain-REALITY node, which then fails the handshake against the server.
    if (tls.postQuantum) p.set("pqv", tls.postQuantum);
  }
}

function frag(name: string): string {
  return name ? `#${encodeURIComponent(name)}` : "";
}

function hostPort(s: ServerProfile): string {
  const host = s.address.includes(":") ? `[${s.address}]` : s.address;
  return `${host}:${s.port}`;
}

export class SerializeError extends Error {}

/**
 * Turn one ServerProfile into its canonical share link.
 * Throws {@link SerializeError} for a profile missing required credentials.
 */
export function serverToShareLink(s: ServerProfile): string {
  switch (s.protocol) {
    case "vless": {
      const p = new URLSearchParams();
      p.set("type", transportParam(s.transport));
      addTlsParams(p, s.tls);
      addTransportParams(p, s.transport);
      if (s.flow) p.set("flow", s.flow);
      return `vless://${encodeURIComponent(s.uuid ?? "")}@${hostPort(s)}?${p.toString()}${frag(s.name)}`;
    }
    case "trojan": {
      const p = new URLSearchParams();
      p.set("type", transportParam(s.transport));
      addTlsParams(p, s.tls);
      addTransportParams(p, s.transport);
      return `trojan://${encodeURIComponent(s.password ?? "")}@${hostPort(s)}?${p.toString()}${frag(s.name)}`;
    }
    case "vmess": {
      const json: Record<string, string | number> = {
        v: "2",
        ps: s.name,
        add: s.address,
        port: s.port,
        id: s.uuid ?? "",
        aid: s.alterId ?? 0,
        scy: s.method || "auto",
        net: transportParam(s.transport),
        type: "none",
        host: s.transport.host || "",
        path: s.transport.path || "",
        tls: s.tls.security === "none" ? "" : s.tls.security,
        sni: s.tls.sni || "",
        alpn: s.tls.alpn?.join(",") || "",
        fp: s.tls.fingerprint || "",
      };
      return `vmess://${encodeBase64(JSON.stringify(json))}`;
    }
    case "shadowsocks": {
      const userinfo = encodeBase64(`${s.method ?? ""}:${s.password ?? ""}`);
      const plugin = s.extra?.obfs ? `?plugin=${encodeURIComponent(s.extra.obfs)}` : "";
      return `ss://${userinfo}@${hostPort(s)}${plugin}${frag(s.name)}`;
    }
    case "hysteria2": {
      const p = new URLSearchParams();
      if (s.tls.sni) p.set("sni", s.tls.sni);
      if (s.tls.alpn?.length) p.set("alpn", s.tls.alpn.join(","));
      if (s.tls.allowInsecure) p.set("insecure", "1");
      if (s.extra?.obfs) p.set("obfs", s.extra.obfs);
      if (s.extra?.obfsPassword) p.set("obfs-password", s.extra.obfsPassword);
      const qs = p.toString();
      return `hysteria2://${encodeURIComponent(s.password ?? "")}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "tuic": {
      const p = new URLSearchParams();
      if (s.tls.sni) p.set("sni", s.tls.sni);
      if (s.tls.alpn?.length) p.set("alpn", s.tls.alpn.join(","));
      if (s.tls.allowInsecure) p.set("allow_insecure", "1");
      if (s.extra?.congestionControl) p.set("congestion_control", s.extra.congestionControl);
      if (s.extra?.udpRelayMode) p.set("udp_relay_mode", s.extra.udpRelayMode);
      const qs = p.toString();
      return `tuic://${encodeURIComponent(s.uuid ?? "")}:${encodeURIComponent(s.password ?? "")}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "hysteria": {
      const p = new URLSearchParams();
      if (s.extra?.auth) p.set("auth", s.extra.auth);
      if (s.tls.sni) p.set("peer", s.tls.sni);
      if (s.tls.alpn?.length) p.set("alpn", s.tls.alpn.join(","));
      if (s.tls.allowInsecure) p.set("insecure", "1");
      if (s.extra?.obfs) p.set("obfs", s.extra.obfs);
      if (s.extra?.upMbps) p.set("upmbps", String(s.extra.upMbps));
      if (s.extra?.downMbps) p.set("downmbps", String(s.extra.downMbps));
      const qs = p.toString();
      return `hysteria://${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "anytls": {
      const p = new URLSearchParams();
      if (s.tls.sni) p.set("sni", s.tls.sni);
      if (s.tls.allowInsecure) p.set("insecure", "1");
      const qs = p.toString();
      return `anytls://${encodeURIComponent(s.password ?? "")}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "socks": {
      const auth = s.username
        ? `${encodeURIComponent(s.username)}:${encodeURIComponent(s.password ?? "")}@`
        : "";
      return `socks://${auth}${hostPort(s)}${frag(s.name)}`;
    }
    case "http": {
      const auth = s.username
        ? `${encodeURIComponent(s.username)}:${encodeURIComponent(s.password ?? "")}@`
        : "";
      const scheme = s.tls.enabled ? "https" : "http";
      return `${scheme}://${auth}${hostPort(s)}${frag(s.name)}`;
    }
    case "shadowtls": {
      const st = s.shadowtls;
      const p = new URLSearchParams();
      p.set("version", String(st?.version ?? 3));
      if (st?.password) p.set("password", st.password);
      if (s.tls.sni) p.set("sni", s.tls.sni);
      if (s.tls.allowInsecure) p.set("insecure", "1");
      const userinfo = `${encodeURIComponent(st?.method ?? "")}:${encodeURIComponent(st?.ssPassword ?? "")}`;
      return `shadowtls://${userinfo}@${hostPort(s)}?${p.toString()}${frag(s.name)}`;
    }
    case "ssh": {
      const ssh = s.ssh;
      const auth = ssh?.password
        ? `${encodeURIComponent(ssh.user)}:${encodeURIComponent(ssh.password)}`
        : encodeURIComponent(ssh?.user ?? "root");
      const p = new URLSearchParams();
      if (ssh?.privateKey) p.set("privateKey", encodeBase64(ssh.privateKey));
      if (ssh?.privateKeyPassphrase) p.set("passphrase", ssh.privateKeyPassphrase);
      const qs = p.toString();
      return `ssh://${auth}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "tor": {
      return `tor://${hostPort(s)}${frag(s.name)}`;
    }
    case "juicity": {
      const p = new URLSearchParams();
      if (s.tls.sni) p.set("sni", s.tls.sni);
      if (s.extra?.congestionControl) p.set("congestion_control", s.extra.congestionControl);
      if (s.tls.allowInsecure) p.set("allow_insecure", "1");
      const userinfo = `${encodeURIComponent(s.uuid ?? "")}:${encodeURIComponent(s.password ?? "")}`;
      const qs = p.toString();
      return `juicity://${userinfo}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    case "naive": {
      const auth = s.username
        ? `${encodeURIComponent(s.username)}:${encodeURIComponent(s.password ?? "")}@`
        : "";
      return `naive+https://${auth}${hostPort(s)}${frag(s.name)}`;
    }
    case "wireguard": {
      const wg = s.wireguard;
      const p = new URLSearchParams();
      if (wg?.peerPublicKey) p.set("publickey", wg.peerPublicKey);
      if (wg?.preSharedKey) p.set("presharedkey", wg.preSharedKey);
      if (wg?.localAddress?.length) p.set("address", wg.localAddress.join(","));
      if (wg?.reserved?.length) p.set("reserved", wg.reserved.join(","));
      if (wg?.mtu) p.set("mtu", String(wg.mtu));
      const qs = p.toString();
      return `wireguard://${encodeURIComponent(wg?.privateKey ?? "")}@${hostPort(s)}${qs ? `?${qs}` : ""}${frag(s.name)}`;
    }
    default: {
      // Exhaustiveness guard — a new Protocol must add a case above.
      const _never: never = s.protocol;
      throw new SerializeError(`unsupported protocol: ${String(_never)}`);
    }
  }
}
