import { create } from "zustand";
import type { ConnectionStatus, CoreKind, ServerProfile, TrafficSample } from "../core/types";
import { getCore, ALL_CORES } from "../core/proxy";
import { validateServerForLaunch } from "../core/validate";
import {
  coreStart,
  coreStop,
  setSystemProxy,
  enableKillSwitch,
  disableKillSwitch,
  isElevated,
  relaunchAsAdmin,
  type CoreStatus,
  type TrafficStats,
} from "../core/ipc";
import { useSettingsStore } from "./useSettingsStore";
import { useServerStore } from "./useServerStore";
import { toast } from "./useToastStore";

const MAX_SAMPLES = 60; // 60s rolling window for the live graph
const MAX_RECONNECT_ATTEMPTS = 8;
/**
 * After this many failed reconnects on the *same* server, stop hammering a dead
 * endpoint and fail over to the best reachable alternative instead.
 */
const FAILOVER_AFTER_ATTEMPTS = 2;
/**
 * Consecutive failed health probes (active server unreachable) tolerated while
 * "connected" before we treat the tunnel as silently dead and recover. With the
 * 6s probe interval this is ~18s of sustained failure — long enough to ride out
 * a transient blip, short enough that the user isn't left on a dead tunnel.
 */
const HEALTH_FAIL_THRESHOLD = 3;

/**
 * Screen-local (not in the global i18n dictionary, so it never affects the
 * key-parity test) message shown when the watchdog fails over to a better
 * server.
 */
const FAILOVER_MESSAGE: Record<"ru" | "en" | "fa" | "zh", (name: string) => string> = {
  ru: (n) => `Соединение нестабильно — переключаюсь на лучший сервер: ${n}`,
  en: (n) => `Connection unstable — switching to the best server: ${n}`,
  fa: (n) => `اتصال ناپایدار است — در حال تغییر به بهترین سرور: ${n}`,
  zh: (n) => `连接不稳定 — 正在切换到最佳服务器：${n}`,
};

/**
 * Screen-local warning shown when the kill-switch couldn't be armed (usually
 * because the app isn't running elevated). Kept out of the global dictionary so
 * it never affects the i18n key-parity test.
 */
const KILLSWITCH_FAIL_MESSAGE: Record<"ru" | "en" | "fa" | "zh", string> = {
  ru: "Не удалось включить kill-switch — запустите приложение от администратора",
  en: "Couldn't enable the kill-switch — run the app as administrator",
  fa: "فعال‌سازی kill-switch ناموفق بود — برنامه را با دسترسی مدیر اجرا کنید",
  zh: "无法启用断网保护 — 请以管理员身份运行应用",
};

/**
 * TUN (VPN) mode needs OS-level privileges to create the virtual interface.
 * When the app isn't elevated we surface a clear, localized error instead of
 * letting the core fail silently, and auto-relaunch as administrator so the
 * user lands back in an elevated session that can actually bring up the tunnel.
 */
const TUN_NEEDS_ADMIN_MESSAGE: Record<"ru" | "en" | "fa" | "zh", string> = {
  ru: "Режим VPN (TUN) требует прав администратора — перезапускаю с повышением прав…",
  en: "VPN (TUN) mode requires administrator rights — relaunching elevated…",
  fa: "حالت VPN (TUN) به دسترسی مدیر نیاز دارد — در حال راه‌اندازی مجدد با دسترسی مدیر…",
  zh: "VPN (TUN) 模式需要管理员权限 — 正在以管理员身份重启…",
};

/**
 * Arm the OS-level kill-switch for the given server, tolerating failure with a
 * user-visible warning. Called on every (re)connect so a failover transparently
 * updates the firewall allow-list to the new server.
 */
function armKillSwitch(host: string): void {
  void enableKillSwitch([host]).catch(() => {
    const lang = useSettingsStore.getState().app.language;
    toast.warning(KILLSWITCH_FAIL_MESSAGE[lang]);
  });
}

/**
 * Find the best (lowest-latency) reachable server that is NOT the one that just
 * failed, re-probing candidates fresh so a stale latency reading can't send us
 * to another dead endpoint. Returns null when no healthy alternative exists.
 */
async function pickFailoverTarget(currentId: string): Promise<ServerProfile | null> {
  const { servers, pingMany } = useServerStore.getState();
  const candidateIds = servers.filter((s) => s.id !== currentId).map((s) => s.id);
  if (candidateIds.length === 0) return null;
  await pingMany(candidateIds);
  const reachable = useServerStore
    .getState()
    .servers.filter((s) => s.id !== currentId && (s.latencyMs ?? -1) >= 0);
  if (reachable.length === 0) return null;
  return reachable.reduce((best, s) =>
    (s.latencyMs ?? Infinity) < (best.latencyMs ?? Infinity) ? s : best,
  );
}

interface ConnectionState {
  status: ConnectionStatus;
  activeServerId: string | null;
  activeServer: ServerProfile | null;
  /** The core actually running the active connection (may differ from the
   * user's preferred core after an auto-fallback). Null when disconnected. */
  activeCore: CoreKind | null;
  connectedAt: number | null;
  error: string | null;
  /** True while the user wants to stay connected; drives auto-reconnect. */
  autoReconnect: boolean;
  reconnectAttempts: number;
  /** Consecutive failed health probes against the active server. */
  healthFailures: number;

  traffic: TrafficStats;
  samples: TrafficSample[];

  connect: (server: ServerProfile) => Promise<void>;
  disconnect: () => Promise<void>;
  toggle: (server: ServerProfile) => Promise<void>;
  /** Apply an authoritative status transition coming from the Rust core. */
  applyCoreStatus: (s: CoreStatus) => void;
  setStatus: (s: ConnectionStatus, error?: string) => void;
  pushTraffic: (t: TrafficStats) => void;
  /**
   * Report the result of a periodic tunnel health probe (active server
   * reachable?). Drives recovery from a silently-dead tunnel where the core
   * process is still alive but no traffic can flow.
   */
  reportHealthProbe: (ok: boolean) => void;
}

const ZERO: TrafficStats = { up: 0, down: 0, totalUp: 0, totalDown: 0 };

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Pick a core that can actually run this server. The user's chosen core is
 * preferred, but a protocol it cannot run (hysteria2 / tuic on Xray) -- or a
 * Shadowsocks server with an obfs plugin, which only sing-box can apply
 * without an external plugin binary -- transparently falls back to a capable
 * core. sing-box supports every protocol we parse, so it is always a valid
 * landing spot.
 */
function selectCore(server: ServerProfile, preferredKind: string) {
  const preferred = getCore(preferredKind as never);
  const xrayCantObfs =
    preferred.kind === "xray" &&
    server.protocol === "shadowsocks" &&
    !!server.extra?.obfs;
  // XHTTP transport and post-quantum (ML-DSA-65) REALITY are Xray-only: sing-box
  // cannot run them at all. Force Xray for those regardless of the user's
  // preferred core so the node actually connects instead of silently failing.
  const needsXray =
    server.transport.type === "xhttp" ||
    (server.tls.security === "reality" && !!server.tls.postQuantum);
  if (needsXray) {
    const xray = ALL_CORES.find((c) => c.kind === "xray");
    if (xray && xray.supports(server.protocol)) return xray;
  }
  if (preferred.supports(server.protocol) && !xrayCantObfs && !needsXray) return preferred;
  return (
    ALL_CORES.find(
      (c) =>
        c.supports(server.protocol) &&
        !(c.kind === "xray" && xrayCantObfs) &&
        !(needsXray && c.kind !== "xray"),
    ) ?? null
  );
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
    set({ status: "reconnecting", reconnectAttempts: attempt, healthFailures: 0 });
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void (async () => {
        const cur = get();
        if (!cur.autoReconnect || !cur.activeServer) return;

        // After a couple of failed attempts on the same endpoint, fail over to
        // the best reachable alternative instead of retrying a dead server.
        let target = cur.activeServer;
        if (attempt >= FAILOVER_AFTER_ATTEMPTS) {
          const better = await pickFailoverTarget(cur.activeServer.id);
          if (better && better.id !== cur.activeServer.id) {
            target = better;
            const lang = useSettingsStore.getState().app.language;
            toast.warning(FAILOVER_MESSAGE[lang](better.name));
            // Fresh attempt budget for the new server.
            set({ reconnectAttempts: 0 });
          }
        }

        // The user may have disconnected during the async probe above.
        const latest = get();
        if (!latest.autoReconnect) return;
        void latest.connect(target);
      })();
    }, delay);
  };

  return {
    status: "disconnected",
    activeServerId: null,
    activeServer: null,
    activeCore: null,
    connectedAt: null,
    error: null,
    autoReconnect: false,
    reconnectAttempts: 0,
    healthFailures: 0,
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
        healthFailures: 0,
      });
      // Arm the kill-switch *before* the tunnel comes up so the connection
      // attempt itself can't leak. Re-arming on each (re)connect keeps the
      // firewall allow-list pointed at the current server after a failover.
      if (proxy.killSwitch) armKillSwitch(server.address);
      try {
        // Pre-flight: reject configs the core can't possibly launch (e.g. a
        // REALITY node missing its publicKey) with one clear message instead of
        // letting the core crash-loop on a cryptic low-level error.
        const lang = useSettingsStore.getState().app.language;
        const invalid = validateServerForLaunch(server, lang);
        if (invalid) {
          toast.error(invalid.message);
          clearReconnectTimer();
          set({
            status: "error",
            autoReconnect: false,
            activeCore: null,
            error: invalid.message,
          });
          return;
        }

        const core = selectCore(server, proxy.coreKind);
        if (!core) {
          throw new Error(
            `\u041d\u0438 \u043e\u0434\u043d\u043e \u044f\u0434\u0440\u043e \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b ${server.protocol.toUpperCase()}`,
          );
        }
        // TUN (VPN) mode can't create the virtual interface without elevation.
        // Catch it up-front with a clear message + auto-elevate, instead of the
        // core starting and silently routing nothing.
        if (proxy.tun?.enabled && !(await isElevated())) {
          toast.error(TUN_NEEDS_ADMIN_MESSAGE[lang]);
          clearReconnectTimer();
          set({
            status: "error",
            autoReconnect: false,
            activeCore: null,
            error: TUN_NEEDS_ADMIN_MESSAGE[lang],
          });
          void relaunchAsAdmin().catch(() => {});
          return;
        }
        set({ activeCore: core.kind });
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
          activeCore: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    disconnect: async () => {
      const { proxy } = useSettingsStore.getState();
      clearReconnectTimer();
      set({ autoReconnect: false, reconnectAttempts: 0, healthFailures: 0 });
      try {
        // Tear down the kill-switch first so the user always regains networking
        // on an explicit disconnect, even if stopping the core hiccups.
        if (proxy.killSwitch) void disableKillSwitch().catch(() => {});
        if (proxy.systemProxy) await setSystemProxy(false, proxy.mixedPort);
        await coreStop();
      } finally {
        set({
          status: "disconnected",
          activeServerId: null,
          activeServer: null,
          activeCore: null,
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
            healthFailures: 0,
          });
          if (proxy.systemProxy) void setSystemProxy(true, proxy.mixedPort).catch(() => {});
          break;
        case "stopped":
          if (state.autoReconnect) {
            scheduleReconnect();
          } else {
            set({ status: "disconnected", connectedAt: null, activeCore: null });
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

    reportHealthProbe: (ok) => {
      const state = get();
      // Only meaningful while we believe we're connected.
      if (state.status !== "connected") {
        if (state.healthFailures !== 0) set({ healthFailures: 0 });
        return;
      }
      if (ok) {
        if (state.healthFailures !== 0) set({ healthFailures: 0 });
        return;
      }
      const failures = state.healthFailures + 1;
      if (failures >= HEALTH_FAIL_THRESHOLD && state.autoReconnect) {
        // The core process may still be alive, but the endpoint is unreachable —
        // kick off a reconnect (which fails over to the best server) rather than
        // waiting for a hard crash that may never arrive.
        set({ healthFailures: 0 });
        scheduleReconnect();
      } else {
        set({ healthFailures: failures });
      }
    },

    pushTraffic: (t) =>
      set((state) => {
        const sample: TrafficSample = { t: Date.now(), up: t.up, down: t.down };
        const samples = [...state.samples, sample].slice(-MAX_SAMPLES);
        return { traffic: t, samples };
      }),
  };
});
