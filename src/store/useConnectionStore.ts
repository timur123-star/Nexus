import { create } from "zustand";
import type { ConnectionStatus, ServerProfile, TrafficSample } from "../core/types";
import { getCore } from "../core/proxy";
import { coreStart, coreStop, setSystemProxy, type CoreStatus, type TrafficStats } from "../core/ipc";
import { useSettingsStore } from "./useSettingsStore";

const MAX_SAMPLES = 60; // 60s rolling window for the live graph
const MAX_RECONNECT_ATTEMPTS = 8;

interface ConnectionState {
  status: ConnectionStatus;
  activeServerId: string | null;
  activeServer: ServerProfile | null;
  connectedAt: number | null;
  error: string | null;
  /** True while the user wants to stay connected; drives auto-reconnect. */
  autoReconnect: boolean;
  reconnectAttempts: number;

  traffic: TrafficStats;
  samples: TrafficSample[];

  connect: (server: ServerProfile) => Promise<void>;
  disconnect: () => Promise<void>;
  toggle: (server: ServerProfile) => Promise<void>;
  /** Apply an authoritative status transition coming from the Rust core. */
  applyCoreStatus: (s: CoreStatus) => void;
  setStatus: (s: ConnectionStatus, error?: string) => void;
  pushTraffic: (t: TrafficStats) => void;
}

const ZERO: TrafficStats = { up: 0, down: 0, totalUp: 0, totalDown: 0 };

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export const useConnectionStore = create<ConnectionState>((set, get) => {
  /** Schedule an auto-reconnect with exponential backoff, capped. */
  const scheduleReconnect = (): void => {
    const state = get();
    if (!state.activeServer || !state.autoReconnect) {
      set({ status: "error" });
      return;
    }
    const attempt = state.reconnectAttempts + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      clearReconnectTimer();
      set({
        status: "error",
        autoReconnect: false,
        error: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f \u2014 \u043f\u0440\u0435\u0432\u044b\u0448\u0435\u043d\u043e \u0447\u0438\u0441\u043b\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a",
      });
      return;
    }
    const delay = Math.min(30_000, Math.round(1000 * Math.pow(1.6, attempt - 1)));
    set({ status: "reconnecting", reconnectAttempts: attempt });
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      const cur = get();
      if (!cur.autoReconnect || !cur.activeServer) return;
      void cur.connect(cur.activeServer);
    }, delay);
  };

  return {
    status: "disconnected",
    activeServerId: null,
    activeServer: null,
    connectedAt: null,
    error: null,
    autoReconnect: false,
    reconnectAttempts: 0,
    traffic: ZERO,
    samples: [],

    connect: async (server) => {
      const { proxy } = useSettingsStore.getState();
      clearReconnectTimer();
      set({
        status: "connecting",
        error: null,
        activeServerId: server.id,
        activeServer: server,
        autoReconnect: true,
      });
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
          customRules: proxy.customRules,
          blockQuic: proxy.blockQuic,
          mux: proxy.mux,
          fragment: proxy.fragment,
        });
        await coreStart(config, core.kind);
        // The connected/error transition now arrives via core://status events
        // (handled in applyCoreStatus), so we don't optimistically flip here.
      } catch (e) {
        // A hard failure to even launch the core is not auto-retried.
        clearReconnectTimer();
        set({
          status: "error",
          autoReconnect: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    disconnect: async () => {
      const { proxy } = useSettingsStore.getState();
      clearReconnectTimer();
      set({ autoReconnect: false, reconnectAttempts: 0 });
      try {
        if (proxy.systemProxy) await setSystemProxy(false, proxy.mixedPort);
        await coreStop();
      } finally {
        set({
          status: "disconnected",
          activeServerId: null,
          activeServer: null,
          connectedAt: null,
          traffic: ZERO,
          samples: [],
        });
      }
    },

    toggle: async (server) => {
      const { status, activeServerId, connect, disconnect } = get();
      if ((status === "connected" || status === "reconnecting") && activeServerId === server.id) {
        await disconnect();
      } else {
        if (status === "connected") await disconnect();
        await connect(server);
      }
    },

    applyCoreStatus: (s) => {
      const state = get();
      const { proxy } = useSettingsStore.getState();
      switch (s) {
        case "starting":
          if (state.status !== "reconnecting") set({ status: "connecting" });
          break;
        case "running":
          clearReconnectTimer();
          set({
            status: "connected",
            connectedAt: state.connectedAt ?? Date.now(),
            error: null,
            reconnectAttempts: 0,
          });
          if (proxy.systemProxy) void setSystemProxy(true, proxy.mixedPort).catch(() => {});
          break;
        case "stopped":
          if (state.autoReconnect) {
            scheduleReconnect();
          } else {
            set({ status: "disconnected", connectedAt: null });
          }
          break;
        case "error":
          // Restore networking immediately; a dead local proxy must not strand the user.
          if (proxy.systemProxy) void setSystemProxy(false, proxy.mixedPort).catch(() => {});
          if (state.autoReconnect) {
            scheduleReconnect();
          } else {
            set({ status: "error" });
          }
          break;
      }
    },

    setStatus: (s, error) => set({ status: s, error: error ?? null }),

    pushTraffic: (t) =>
      set((state) => {
        const sample: TrafficSample = { t: Date.now(), up: t.up, down: t.down };
        const samples = [...state.samples, sample].slice(-MAX_SAMPLES);
        return { traffic: t, samples };
      }),
  };
});
