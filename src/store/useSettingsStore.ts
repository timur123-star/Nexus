import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CoreKind, RoutingMode, RoutingProfile, RoutingRule } from "../core/types";
import { persistentStorage } from "../core/db";
import { DEFAULT_ACCENT } from "../shared/lib/accents";

export interface ProxySettings {
  /** Which proxy engine runs connections. */
  coreKind: CoreKind;
  mixedPort: number;
  allowLan: boolean;
  systemProxy: boolean;
  /**
   * How traffic is captured on the host, surfaced as the home-screen mode pill
   * (Hiddify-style). The single source of truth — `systemProxy` and
   * `tun.enabled` are derived from it so the engine wiring stays unchanged:
   *   "proxy"  → local SOCKS/HTTP only (configure your app manually)
   *   "system" → set the OS system proxy to our mixed port
   *   "tun"    → full VPN tunnel (TUN device, needs elevated privileges)
   */
  connectionMode: "proxy" | "system" | "tun";
  routingMode: RoutingMode;
  /** Reject the QUIC protocol so browsers fall back to TCP/TLS and stay routed. */
  blockQuic: boolean;
  /** User-defined rules, evaluated before the bundled geo rules. */
  customRules: RoutingRule[];
  /** Saved routing presets the user can switch between in one click. */
  routingProfiles: RoutingProfile[];
  tun: {
    enabled: boolean;
    stack: "system" | "gvisor" | "mixed";
  };
  dns: {
    remote: string;
    direct: string;
  };
  fakeIp: boolean;
  mux: {
    enabled: boolean;
    protocol: "smux" | "yamux" | "h2mux";
  };
  fragment: {
    enabled: boolean;
    packets: string; // e.g. "tlshello"
    length: string; // e.g. "10-20"
    interval: string; // e.g. "10-20"
  };
  /** Block all traffic when VPN disconnects unexpectedly (kill switch). */
  killSwitch: boolean;
  /** Accept self-signed TLS certificates when fetching subscriptions. */
  allowInsecureSubs: boolean;
  clashApiPort: number;
  clashSecret: string;
}

export interface AppSettings {
  theme: "system" | "dark" | "light" | "oled";
  /** Accent preset id (see src/shared/lib/accents.ts). */
  accent: string;
  language: "ru" | "en" | "fa" | "zh";
  autoStart: boolean;
  minimizeToTray: boolean;
  subscriptionUpdateHours: number;
  /** Sort server list automatically after ping. */
  autoSortByPing: boolean;
}

interface SettingsState {
  proxy: ProxySettings;
  app: AppSettings;
  setProxy: (patch: Partial<ProxySettings>) => void;
  setApp: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

/**
 * Clamp a TCP/UDP port to the valid range. NaN (e.g. an emptied input) keeps
 * the previous good value so the field never becomes silently broken; anything
 * else is floored and bounded to 0-65535 so config generation can never emit a
 * nonsensical port.
 */
function sanitizePort(value: number, previous: number): number {
  if (!Number.isFinite(value)) return previous;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > 65535) return 65535;
  return n;
}

/**
 * Seed profiles available on first run. Names are localised in the UI via the
 * `nameKey` lookup so the stored data stays language-agnostic.
 */
export const BUILTIN_ROUTING_PROFILES: RoutingProfile[] = [
  {
    id: "builtin-smart",
    builtin: true,
    nameKey: "smart",
    routingMode: "rule",
    customRules: [],
    blockQuic: false,
  },
  {
    id: "builtin-global",
    builtin: true,
    nameKey: "global",
    routingMode: "global",
    customRules: [],
    blockQuic: true,
  },
  {
    id: "builtin-direct",
    builtin: true,
    nameKey: "direct",
    routingMode: "direct",
    customRules: [],
    blockQuic: false,
  },
];

/** Generate a random secret for the local Clash API to prevent LAN access. */
function randomClashSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const rng = crypto.getRandomValues(new Uint8Array(24));
  for (const b of rng) s += chars[b % chars.length];
  return s;
}

export const DEFAULT_PROXY: ProxySettings = {
  coreKind: "sing-box",
  mixedPort: 2080,
  allowLan: false,
  systemProxy: true,
  connectionMode: "system",
  routingMode: "rule",
  blockQuic: false,
  customRules: [],
  routingProfiles: BUILTIN_ROUTING_PROFILES,
  tun: { enabled: false, stack: "system" },
  dns: { remote: "https://1.1.1.1/dns-query", direct: "https://223.5.5.5/dns-query" },
  fakeIp: true,
  mux: { enabled: false, protocol: "smux" },
  fragment: { enabled: false, packets: "tlshello", length: "10-20", interval: "10-20" },
  killSwitch: false,
  allowInsecureSubs: false,
  clashApiPort: 9090,
  clashSecret: randomClashSecret(),
};

export const DEFAULT_APP: AppSettings = {
  theme: "system",
  accent: DEFAULT_ACCENT,
  language: "ru",
  autoStart: false,
  minimizeToTray: true,
  subscriptionUpdateHours: 12,
  autoSortByPing: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      proxy: DEFAULT_PROXY,
      app: DEFAULT_APP,
      setProxy: (patch) =>
        set((s) => {
          const proxy = { ...s.proxy, ...patch };
          if (patch.mixedPort !== undefined)
            proxy.mixedPort = sanitizePort(patch.mixedPort, s.proxy.mixedPort);
          if (patch.clashApiPort !== undefined)
            proxy.clashApiPort = sanitizePort(patch.clashApiPort, s.proxy.clashApiPort);
          // The mode pill is the single source of truth: derive the engine
          // toggles from it so switching mode actually changes capture method.
          if (patch.connectionMode !== undefined) {
            proxy.systemProxy = patch.connectionMode === "system";
            proxy.tun = { ...proxy.tun, enabled: patch.connectionMode === "tun" };
          } else if (patch.systemProxy !== undefined || patch.tun !== undefined) {
            // Keep the home-screen mode pill coherent when the legacy Settings
            // toggles flip systemProxy / TUN directly.
            proxy.connectionMode = proxy.tun.enabled
              ? "tun"
              : proxy.systemProxy
                ? "system"
                : "proxy";
          }
          return { proxy };
        }),
      setApp: (patch) => set((s) => ({ app: { ...s.app, ...patch } })),
      reset: () => set({ proxy: DEFAULT_PROXY, app: DEFAULT_APP }),
    }),
    {
      name: "nexusshield-settings",
      storage: createJSONStorage(() => persistentStorage),
      // Merge persisted state over defaults so new fields (e.g. coreKind,
      // routingProfiles, accent) are always present for users upgrading from an
      // older version.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const persistedProxy = (p.proxy ?? {}) as Partial<ProxySettings>;
        return {
          ...current,
          proxy: {
            ...current.proxy,
            ...persistedProxy,
            // Always keep the built-in presets available even if an older
            // persisted state had none.
            routingProfiles:
              persistedProxy.routingProfiles && persistedProxy.routingProfiles.length > 0
                ? persistedProxy.routingProfiles
                : current.proxy.routingProfiles,
            // Back-fill the mode pill from the legacy booleans for users who
            // upgrade from a build that had no `connectionMode`.
            connectionMode:
              persistedProxy.connectionMode ??
              (persistedProxy.tun?.enabled
                ? "tun"
                : persistedProxy.systemProxy === false
                  ? "proxy"
                  : "system"),
          },
          app: { ...current.app, ...(p.app ?? {}) },
        };
      },
    },
  ),
);
