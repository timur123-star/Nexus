import { create } from "zustand";
import type { ConnectionStatus, ServerProfile, TrafficSample } from "../core/types";
import { getCore } from "../core/proxy";
import { coreStart, coreStop, setSystemProxy, type TrafficStats } from "../core/ipc";
import { useSettingsStore } from "./useSettingsStore";

const MAX_SAMPLES = 60; // 60s rolling window for the live graph

interface ConnectionState {
  status: ConnectionStatus;
  activeServerId: string | null;
  connectedAt: number | null;
  error: string | null;

  traffic: TrafficStats;
  samples: TrafficSample[];

  connect: (server: ServerProfile) => Promise<void>;
  disconnect: () => Promise<void>;
  toggle: (server: ServerProfile) => Promise<void>;
  setStatus: (s: ConnectionStatus, error?: string) => void;
  pushTraffic: (t: TrafficStats) => void;
}

const ZERO: TrafficStats = { up: 0, down: 0, totalUp: 0, totalDown: 0 };

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: "disconnected",
  activeServerId: null,
  connectedAt: null,
  error: null,
  traffic: ZERO,
  samples: [],

  connect: async (server) => {
    const { proxy } = useSettingsStore.getState();
    set({ status: "connecting", error: null, activeServerId: server.id });
    try {
      const core = getCore(proxy.coreKind);
      if (!core.supports(server.protocol)) {
        throw new Error(
          `${core.label} \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b ${server.protocol.toUpperCase()}`,
        );
      }
      const config = core.generateConfig(server, {
        mixedPort: proxy.mixedPort,
        clashApiPort: proxy.clashApiPort,
        clashSecret: proxy.clashSecret,
        routingMode: proxy.routingMode,
        tun: proxy.tun,
        allowLan: proxy.allowLan,
        fakeIp: proxy.fakeIp,
        dns: proxy.dns,
      });
      await coreStart(config, core.kind);
      if (proxy.systemProxy) await setSystemProxy(true, proxy.mixedPort);
      set({ status: "connected", connectedAt: Date.now() });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  disconnect: async () => {
    const { proxy } = useSettingsStore.getState();
    try {
      if (proxy.systemProxy) await setSystemProxy(false, proxy.mixedPort);
      await coreStop();
    } finally {
      set({ status: "disconnected", connectedAt: null, traffic: ZERO, samples: [] });
    }
  },

  toggle: async (server) => {
    const { status, activeServerId, connect, disconnect } = get();
    if (status === "connected" && activeServerId === server.id) {
      await disconnect();
    } else {
      if (status === "connected") await disconnect();
      await connect(server);
    }
  },

  setStatus: (s, error) => set({ status: s, error: error ?? null }),

  pushTraffic: (t) =>
    set((state) => {
      const sample: TrafficSample = { t: Date.now(), up: t.up, down: t.down };
      const samples = [...state.samples, sample].slice(-MAX_SAMPLES);
      return { traffic: t, samples };
    }),
}));
