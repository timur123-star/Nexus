/**
 * Core domain types shared across the parser, stores and UI.
 *
 * A `ServerProfile` is the protocol-agnostic representation of one outbound.
 * The parser turns share-links / subscription entries into these, and the
 * config generators turn these into a runnable sing-box / xray config.
 */

export type Protocol =
  | "vless"
  | "vmess"
  | "trojan"
  | "shadowsocks"
  | "hysteria2"
  | "hysteria"
  | "tuic"
  | "wireguard"
  | "socks"
  | "http"
  | "anytls"
  | "shadowtls"
  | "ssh"
  | "tor";

/** Proxy core that actually runs the connection. */
export type CoreKind = "sing-box" | "xray";

/** Transport / network layer carried over the protocol. */
export type Transport = "tcp" | "ws" | "grpc" | "http" | "h2" | "quic" | "xhttp";

/** TLS-layer security. "reality" is treated as a first-class flavour. */
export type Security = "none" | "tls" | "reality";

export interface TlsSettings {
  enabled: boolean;
  security: Security;
  /** SNI / server name. */
  sni?: string;
  alpn?: string[];
  fingerprint?: string; // uTLS fingerprint, e.g. "chrome"
  allowInsecure?: boolean;
  /** Reality-only */
  publicKey?: string;
  shortId?: string;
  spiderX?: string;
  /** Reality post-quantum verify key (`pqv` → Xray mldsa65Verify). Xray-only. */
  postQuantum?: string;
}

export interface TransportSettings {
  type: Transport;
  /** ws/http/xhttp path */
  path?: string;
  /** ws/http Host header, h2/xhttp host */
  host?: string;
  /** grpc service name */
  serviceName?: string;
  /** http method / mode hints */
  headers?: Record<string, string>;
  /** xhttp mode: "auto" | "packet-up" | "stream-up" | "stream-one" */
  mode?: string;
  /** xhttp `extra` JSON (e.g. { xPaddingBytes, noGRPCHeader, ... }) — Xray-only. */
  xhttpExtra?: Record<string, unknown>;
}

export interface ServerProfile {
  /** Stable local id (uuid-ish), generated on import. */
  id: string;
  /** User-visible name (from link remark / ps field). */
  name: string;
  protocol: Protocol;
  address: string;
  port: number;

  /** Credentials — meaning depends on protocol. */
  uuid?: string; // vless / vmess / tuic
  password?: string; // trojan / ss / tuic / hysteria(2) / anytls
  method?: string; // shadowsocks cipher
  alterId?: number; // vmess (legacy)
  flow?: string; // vless xtls flow, e.g. "xtls-rprx-vision"
  /** SOCKS / HTTP proxy auth username (password reuses the `password` field). */
  username?: string;

  transport: TransportSettings;
  tls: TlsSettings;

  /** WireGuard tunnel parameters (protocol === "wireguard"). */
  wireguard?: {
    /** Client private key (base64). */
    privateKey: string;
    /** Peer (server) public key (base64). */
    peerPublicKey: string;
    /** Optional pre-shared key (base64). */
    preSharedKey?: string;
    /** Tunnel-local addresses, e.g. ["172.16.0.2/32", "fd01::2/128"]. */
    localAddress: string[];
    /** 3-byte reserved field (Cloudflare WARP). */
    reserved?: number[];
    /** Tunnel MTU. */
    mtu?: number;
  };

  /** ShadowTLS v2/v3 parameters (protocol === "shadowtls").
   *  ShadowTLS is a TLS-camouflage layer that carries an inner Shadowsocks
   *  connection, so we keep both the handshake password and the inner SS
   *  credentials here. */
  shadowtls?: {
    /** ShadowTLS protocol version: 1, 2 or 3 (3 recommended). */
    version: number;
    /** Handshake password (v2/v3). */
    password: string;
    /** Inner Shadowsocks cipher, e.g. "2022-blake3-aes-128-gcm". */
    method: string;
    /** Inner Shadowsocks password. */
    ssPassword: string;
  };

  /** SSH outbound parameters (protocol === "ssh"). */
  ssh?: {
    user: string;
    password?: string;
    /** PEM-encoded private key (alternative to password auth). */
    privateKey?: string;
    /** Passphrase protecting `privateKey`, if any. */
    privateKeyPassphrase?: string;
  };

  /** Hysteria / hysteria2 / tuic congestion + obfuscation knobs. */
  extra?: {
    obfs?: string;
    obfsPassword?: string;
    upMbps?: number;
    downMbps?: number;
    congestionControl?: string; // tuic: "bbr" | "cubic" | "new_reno"
    udpRelayMode?: string; // tuic
    /** Hysteria v1 auth string + obfs (legacy single-port). */
    auth?: string;
  };

  /** Organisational metadata. */
  tags: string[];
  favorite: boolean;
  /** Id of the subscription this came from, if any. */
  subscriptionId?: string;

  /** Last measured TCP latency in ms; null = untested, -1 = failed. */
  latencyMs?: number | null;
  lastUsedAt?: number;
  createdAt: number;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  updateIntervalHours: number;
  /** Optional per-subscription User-Agent override for the fetch request. */
  userAgent?: string;
  lastUpdatedAt?: number;
  /** Timestamp of the last refresh ATTEMPT (success or failure). Drives the
   *  error-backoff so a permanently-dead URL isn't re-fetched on every tick. */
  lastAttemptAt?: number;
  serverCount: number;
  status: "ok" | "error" | "updating" | "never";
  lastError?: string;
  /**
   * True when the body was fetched only after accepting an invalid/self-signed
   * TLS certificate (common for RU anti-censorship panels fronted behind
   * domains like vk.ru). Surfaced so the UI can show a "trusted on first use"
   * style hint.
   */
  insecureCertAccepted?: boolean;
  /** Subscription usage reported via the `Subscription-Userinfo` header. */
  usage?: SubscriptionUsage;
}

/**
 * Traffic + expiry metadata advertised by a subscription provider through the
 * `Subscription-Userinfo` response header
 * (`upload=…; download=…; total=…; expire=…`). All byte counts are absolute.
 */
export interface SubscriptionUsage {
  /** Bytes uploaded so far. */
  upload: number;
  /** Bytes downloaded so far. */
  download: number;
  /** Total quota in bytes (0 = unlimited / unknown). */
  total: number;
  /** Plan expiry as a unix epoch in seconds (0 = no expiry advertised). */
  expire: number;
}

export type RoutingMode = "global" | "rule" | "direct";

/** How a custom routing rule matches traffic. */
export type RoutingRuleMatch =
  | "domain"
  | "domain_suffix"
  | "domain_keyword"
  | "domain_regex"
  | "ip_cidr"
  | "geoip"
  | "geosite"
  | "port"
  | "process_name";

/** Where a matched rule sends traffic. */
export type RoutingTarget = "proxy" | "direct" | "block";

/** A single user-defined routing rule, evaluated before the bundled geo rules. */
export interface RoutingRule {
  match: RoutingRuleMatch;
  value: string;
  target: RoutingTarget;
}

/**
 * A saved bundle of routing settings the user can switch between in one click.
 * Built-in profiles are seeded by the store and cannot be renamed or deleted.
 */
export interface RoutingProfile {
  id: string;
  /** User-defined profile name (custom profiles). */
  name?: string;
  /** Lookup key for the localised name of a built-in profile. */
  nameKey?: string;
  /** Built-in profiles cannot be renamed or deleted. */
  builtin?: boolean;
  routingMode: RoutingMode;
  customRules: RoutingRule[];
  blockQuic: boolean;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface TrafficSample {
  /** epoch ms */
  t: number;
  up: number; // bytes/s
  down: number; // bytes/s
}
