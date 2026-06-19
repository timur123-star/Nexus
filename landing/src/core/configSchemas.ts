import * as monaco from "monaco-editor";

/**
 * JSON schemas for the proxy core config formats.
 *
 * Design goals:
 *  - Give Monaco enough structure for autocompletion + hover docs of the keys
 *    NexusShield actually emits.
 *  - NEVER produce a false error on a valid auto-generated config. To guarantee
 *    that, every object uses `additionalProperties: true` and we declare no
 *    top-level `required` fields. Enums are only used for genuinely closed,
 *    stable value sets (log levels, domain strategies) so user/custom configs
 *    are not flagged incorrectly.
 */

const leniencyObject = { type: "object", additionalProperties: true } as const;

const singboxSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "sing-box configuration",
  description: "Universal proxy platform configuration (sing-box).",
  type: "object",
  additionalProperties: true,
  properties: {
    log: {
      type: "object",
      description: "Logging options.",
      additionalProperties: true,
      properties: {
        disabled: { type: "boolean", description: "Disable logging." },
        level: {
          type: "string",
          description: "Log level.",
          enum: ["trace", "debug", "info", "warn", "error", "fatal", "panic"],
        },
        output: { type: "string", description: "Output file path. Empty for stdout." },
        timestamp: { type: "boolean", description: "Add timestamps to log lines." },
      },
    },
    dns: {
      type: "object",
      description: "DNS resolver configuration.",
      additionalProperties: true,
      properties: {
        servers: { type: "array", description: "DNS server list.", items: leniencyObject },
        rules: { type: "array", description: "DNS routing rules.", items: leniencyObject },
        final: { type: "string", description: "Tag of the default DNS server." },
        strategy: {
          type: "string",
          description: "Default domain resolve strategy.",
          enum: ["prefer_ipv4", "prefer_ipv6", "ipv4_only", "ipv6_only"],
        },
        independent_cache: {
          type: "boolean",
          description: "Use an independent DNS cache per server.",
        },
        fakeip: {
          type: "object",
          description: "FakeIP options.",
          additionalProperties: true,
          properties: {
            enabled: { type: "boolean" },
            inet4_range: {
              type: "string",
              description: "IPv4 fake address range, e.g. 198.18.0.0/15.",
            },
            inet6_range: { type: "string", description: "IPv6 fake address range." },
          },
        },
      },
    },
    inbounds: {
      type: "array",
      description: "Inbound connections (local listeners, TUN, mixed proxy).",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string", description: "Inbound type, e.g. mixed, tun, socks, http." },
          tag: { type: "string", description: "Unique inbound tag." },
          listen: { type: "string", description: "Listen address." },
          listen_port: { type: "integer", description: "Listen port." },
          sniff: { type: "boolean", description: "Enable protocol sniffing." },
          interface_name: { type: "string", description: "TUN interface name." },
          stack: { type: "string", description: "TUN stack: system, gvisor or mixed." },
          auto_route: {
            type: "boolean",
            description: "Automatically configure system routes (TUN).",
          },
        },
      },
    },
    outbounds: {
      type: "array",
      description: "Outbound connections (proxy servers and built-ins).",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: {
            type: "string",
            description:
              "Outbound type, e.g. vless, vmess, trojan, shadowsocks, hysteria2, direct, block.",
          },
          tag: { type: "string", description: "Unique outbound tag." },
          server: { type: "string", description: "Server address." },
          server_port: { type: "integer", description: "Server port." },
        },
      },
    },
    route: {
      type: "object",
      description: "Routing configuration.",
      additionalProperties: true,
      properties: {
        rules: {
          type: "array",
          description: "Routing rules, evaluated top to bottom.",
          items: leniencyObject,
        },
        rule_set: {
          type: "array",
          description: "External rule-sets (geoip/geosite).",
          items: leniencyObject,
        },
        final: { type: "string", description: "Tag of the default outbound." },
        auto_detect_interface: {
          type: "boolean",
          description: "Auto-detect the default network interface.",
        },
        default_domain_resolver: {
          type: "string",
          description: "Default DNS server tag for routing.",
        },
      },
    },
    experimental: {
      type: "object",
      description: "Experimental features.",
      additionalProperties: true,
      properties: {
        cache_file: {
          type: "object",
          additionalProperties: true,
          description: "Persistent cache file options.",
          properties: {
            enabled: { type: "boolean" },
            path: { type: "string" },
          },
        },
        clash_api: {
          type: "object",
          additionalProperties: true,
          description: "Clash-compatible API for live traffic statistics.",
          properties: {
            external_controller: {
              type: "string",
              description: "Controller listen address, e.g. 127.0.0.1:9090.",
            },
            secret: { type: "string", description: "API access secret." },
          },
        },
      },
    },
  },
} as const;

const xraySchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Xray configuration",
  description: "Xray-core configuration.",
  type: "object",
  additionalProperties: true,
  properties: {
    log: {
      type: "object",
      description: "Logging options.",
      additionalProperties: true,
      properties: {
        loglevel: {
          type: "string",
          description: "Log level.",
          enum: ["debug", "info", "warning", "error", "none"],
        },
        access: { type: "string", description: "Access log file path." },
        error: { type: "string", description: "Error log file path." },
      },
    },
    api: {
      type: "object",
      description: "gRPC API for statistics and runtime control.",
      additionalProperties: true,
      properties: {
        tag: { type: "string" },
        services: {
          type: "array",
          items: { type: "string" },
          description: "Enabled API services.",
        },
      },
    },
    dns: { type: "object", description: "DNS configuration.", additionalProperties: true },
    policy: {
      type: "object",
      description: "Connection and system policies.",
      additionalProperties: true,
    },
    stats: {
      type: "object",
      description: "Statistics collection (requires the StatsService).",
      additionalProperties: true,
    },
    inbounds: {
      type: "array",
      description: "Inbound connections (local listeners).",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          tag: { type: "string", description: "Unique inbound tag." },
          listen: { type: "string", description: "Listen address." },
          port: { type: ["integer", "string"], description: "Listen port or port range." },
          protocol: {
            type: "string",
            description: "Inbound protocol, e.g. socks, http, dokodemo-door.",
          },
          settings: leniencyObject,
          sniffing: leniencyObject,
          streamSettings: leniencyObject,
        },
      },
    },
    outbounds: {
      type: "array",
      description: "Outbound connections (proxy servers and built-ins).",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          tag: { type: "string", description: "Unique outbound tag." },
          protocol: {
            type: "string",
            description:
              "Outbound protocol, e.g. vless, vmess, trojan, shadowsocks, freedom, blackhole.",
          },
          settings: leniencyObject,
          streamSettings: leniencyObject,
          mux: leniencyObject,
        },
      },
    },
    routing: {
      type: "object",
      description: "Routing configuration.",
      additionalProperties: true,
      properties: {
        domainStrategy: {
          type: "string",
          description: "Domain resolution strategy.",
          enum: ["AsIs", "IPIfNonMatch", "IPOnDemand"],
        },
        rules: {
          type: "array",
          description: "Routing rules, evaluated top to bottom.",
          items: leniencyObject,
        },
        balancers: { type: "array", description: "Load balancers.", items: leniencyObject },
      },
    },
    transport: {
      type: "object",
      description: "Global transport options.",
      additionalProperties: true,
    },
  },
} as const;

export const SINGBOX_SCHEMA_PATH = "nexus-config-singbox.json";
export const XRAY_SCHEMA_PATH = "nexus-config-xray.json";

let registered = false;

/**
 * Register the core config schemas with Monaco's JSON language service.
 * Idempotent — safe to call on every editor mount.
 */
export function configureJsonSchemas() {
  if (registered) return;
  registered = true;
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemaValidation: "error",
    schemas: [
      {
        uri: "https://nexusshield.app/schema/singbox.json",
        fileMatch: [`*${SINGBOX_SCHEMA_PATH}`],
        schema: singboxSchema,
      },
      {
        uri: "https://nexusshield.app/schema/xray.json",
        fileMatch: [`*${XRAY_SCHEMA_PATH}`],
        schema: xraySchema,
      },
    ],
  });
}
