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
  | "tuic";

/** Proxy core that actually runs the connection. */
export type CoreKind = "sing-box" | "xray";

/** Transport / network layer carried over the protocol. */
export type Transport = "tcp" | "ws" | "grpc" | "http" | "h2" | "quic";

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
}

export interface TransportSettings {
  type: Transport;
  /** ws/http path */
  path?: string;
  /** ws/http Host header, h2 host */
  host?: string;
  /** grpc service name */
  serviceName?: string;
  /** http method / mode hints */
  headers?: Record<string, string>;
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
  password?: string; // trojan / ss / tuic / hysteria2
  method?: string; // shadowsocks cipher
  alterId?: number; // vmess (legacy)
  flow?: string; // vless xtls flow, e.g. "xtls-rprx-vision"

  transport: TransportSettings;
  tls: TlsSettings;

  /** Hysteria2 / tuic congestion + obfuscation knobs. */
  extra?: {
    obfs?: string;
    obfsPassword?: string;
    upMbps?: number;
    downMbps?: number;
    congestionControl?: string; // tuic: "bbr" | "cubic" | "new_reno"
    udpRelayMode?: string; // tuic
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
  lastUpdatedAt?: number;
  serverCount: number;
  status: "ok" | "error" | "updating" | "never";
  lastError?: string;
}

export type RoutingMode = "global" | "rule" | "direct";

/** How a custom routing rule matches traffic. */
export type RoutingRuleMatch =
  | "domain"
  | "domain_suffix"
  | "domain_keyword"
  | "ip_cidr"
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
