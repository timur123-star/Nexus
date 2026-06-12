import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CoreKind, RoutingMode, RoutingRule } from "../core/types";
import { persistentStorage } from "../core/db";

export interface ProxySettings {
  /** Which proxy engine runs connections. */
  coreKind: CoreKind;
  mixedPort: number;
  allowLan: boolean;
  systemProxy: boolean;
  routingMode: RoutingMode;
  /** Reject the QUIC protocol so browsers fall back to TCP/TLS and stay routed. */
  blockQuic: boolean;
  /** User-defined rules, evaluated before the bundled geo rules. */
  customRules: RoutingRule[];
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
  clashApiPort: number;
  clashSecret: string;
}

export interface AppSettings {
  theme: "system" | "dark" | "light";
  language: "ru" | "en" | "fa" | "zh";
  autoStart: boolean;
  minimizeToTray: boolean;
  subscriptionUpdateHours: number;
}

interface SettingsState {
  proxy: ProxySettings;
  app: AppSettings;
  setProxy: (patch: Partial<ProxySettings>) => void;
  setApp: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const DEFAULT_PROXY: ProxySettings = {
  coreKind: "sing-box",
  mixedPort: 2080,
  allowLan: false,
  systemProxy: true,
  routingMode: "rule",
  blockQuic: false,
  customRules: [],
  tun: { enabled: false, stack: "system" },
  dns: { remote: "https://1.1.1.1/dns-query", direct: "https://223.5.5.5/dns-query" },
  fakeIp: true,
  mux: { enabled: false, protocol: "smux" },
  fragment: { enabled: false, packets: "tlshello", length: "10-20", interval: "10-20" },
  clashApiPort: 9090,
  // Not a secret in the cryptographic sense — local Clash API guard only.
  clashSecret: "nexusshield",
};

export const DEFAULT_APP: AppSettings = {
  theme: "system",
  language: "ru",
  autoStart: false,
  minimizeToTray: true,
  subscriptionUpdateHours: 12,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      proxy: DEFAULT_PROXY,
      app: DEFAULT_APP,
      setProxy: (patch) => set((s) => ({ proxy: { ...s.proxy, ...patch } })),
      setApp: (patch) => set((s) => ({ app: { ...s.app, ...patch } })),
      reset: () => set({ proxy: DEFAULT_PROXY, app: DEFAULT_APP }),
    }),
    {
      name: "nexusshield-settings",
      storage: createJSONStorage(() => persistentStorage),
      // Merge persisted state over defaults so new fields (e.g. coreKind) are
      // always present for users upgrading from an older version.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          proxy: { ...current.proxy, ...(p.proxy ?? {}) },
          app: { ...current.app, ...(p.app ?? {}) },
        };
      },
    },
  ),
);
