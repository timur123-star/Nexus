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
 * Shown when the OS system proxy couldn't be applied after the core came up —
 * the tunnel is running but no app traffic is actually being proxied, so the
 * user must be told instead of seeing a misleading "connected".
 */
const SYSPROXY_FAIL_MESSAGE: Record<"ru" | "en" | "fa" | "zh", string> = {
  ru: "Соединение поднято, но не удалось включить системный прокси — трафик приложений не проксируется",
  en: "Connected, but the system proxy couldn't be set — app traffic isn't being proxied",
  fa: "متصل شد، اما پروکسی سیستم تنظیم نشد — ترافیک برنامه‌ها پروکسی نمی‌شود",
  zh: "已连接，但无法设置系统代理 — 应用流量未被代理",
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
 * Surfaced when the user is in TUN (VPN) mode but the selected server can only
 * run on Xray-core (post-quantum REALITY / XHTTP), which has no TUN inbound. We
 * refuse instead of starting Xray with a dead tunnel, and point the user at the
 * mode that *does* work for this server (system proxy).
 */
const TUN_XRAY_CONFLICT_MESSAGE: Record<"ru" | "en" | "fa" | "zh", string> = {
  ru: "Этот сервер (post-quantum REALITY / XHTTP) работает только на ядре Xray, а Xray не поддерживает режим VPN (TUN). Переключитесь на режим «Системный прокси» для этого сервера или выберите обычный сервер для VPN.",
  en: "This server (post-quantum REALITY / XHTTP) runs only on Xray-core, which has no VPN (TUN) mode. Switch to “System proxy” mode for this server, or pick a regular server for VPN.",
  fa: "این سرور (REALITY پساکوانتومی / XHTTP) فقط روی هسته Xray کار می‌کند که حالت VPN (TUN) ندارد. برای این سرور به حالت «پروکسی سیستم» بروید یا یک سرور معمولی برای VPN انتخاب کنید.",
  zh: "此服务器（后量子 REALITY / XHTTP）仅能在 Xray 内核上运行，而 Xray 没有 VPN (TUN) 模式。请为此服务器切换到“系统代理”模式，或选择常规服务器用于 VPN。",
};

/**
 * Arm the OS-level kill-switch for the given server. Returns true once the
 * firewall is actually armed, false on failure (e.g. not elevated). Called on
 * every (re)connect so a failover transparently updates the firewall allow-list
 * to the new server. The caller AWAITS this and refuses to bring the tunnel up
 * if it fails — a kill-switch the user asked for that silently didn't arm would
 * leave traffic leaking, the exact opposite of its purpose.
 */
async function armKillSwitch(host: string): Promise<boolean> {
  try {
    await enableKillSwitch([host]);
    return true;
  } catch {
    const lang = useSettingsStore.getState().app.language;
    toast.warning(KILLSWITCH_FAIL_MESSAGE[lang]);
    return false;
  }
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
 * Monotonic connection-attempt generation. Bumped at the START of every
 * connect() and on every disconnect(), so a slow connect whose `await coreStart`
 * resolves AFTER the user disconnected (or fired a newer connect) can detect it
 * was superseded and bail out instead of clobbering the newer state. Guards the
 * reentrancy race from double-firing connect (command palette + hotkey, etc.).
 */
let connectSeq = 0;

/**
 * Hard cap on how many times a single logical session may fail over to another
 * server before giving up. Without it, resetting the per-server reconnect budget
 * on each failover lets a flapping network loop A→B→A→… forever.
 */
const MAX_FAILOVER_HOPS = 5;
let failoverHops = 0;

/**
 * Pick a core that can actually run this server. The user's chosen core is
 * preferred, but a protocol it cannot run (hysteria2 / tuic on Xray) -- or a
 * Shadowsocks server with an obfs plugin, which only sing-box can apply
 * without an external plugin binary -- transparently falls back to a capable
 * core. sing-box supports every protocol we parse, so it is always a valid
 * landing spot.
 */
/**
 * Protocols/features that ONLY Xray-core can run: the XHTTP transport and
 * post-quantum (ML-DSA-65) REALITY. sing-box cannot run these at all.
 */
function requiresXray(server: ServerProfile): boolean {
  return (
    server.transport.type === "xhttp" ||
    (server.tls.security === "reality" && !!server.tls.postQuantum)
  );
}

function selectCore(server: ServerProfile, preferredKind: string, tunEnabled = false) {
  const preferred = getCore(preferredKind as never);
  const xrayCantObfs =
    preferred.kind === "xray" && server.protocol === "shadowsocks" && !!server.extra?.obfs;
  // XHTTP transport and post-quantum (ML-DSA-65) REALITY are Xray-only: sing-box
  // cannot run them at all. Force Xray for those regardless of the user's
  // preferred core so the node actually connects instead of silently failing.
  const needsXray = requiresXray(server);

  // TUN (VPN) mode needs a virtual network interface, which ONLY sing-box can
  // create — Xray-core has no TUN inbound. So in TUN mode we must land on
  // sing-box whenever it can run the server, even if the user's preferred core
  // is Xray; otherwise "VPN mode" would start Xray and silently tunnel nothing
  // (the exact symptom users hit with a default Xray preference). Servers that
  // *require* Xray (PQ-REALITY / XHTTP) can't use TUN at all — the caller
  // detects that and surfaces a clear message instead of a dead tunnel.
  if (tunEnabled && !needsXray) {
    const singbox = ALL_CORES.find((c) => c.kind === "sing-box");
    if (singbox && singbox.supports(server.protocol)) return singbox;
  }

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
        error:
          "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f \u2014 \u043f\u0440\u0435\u0432\u044b\u0448\u0435\u043d\u043e \u0447\u0438\u0441\u043b\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a",
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
        if (attempt >= FAILOVER_AFTER_ATTEMPTS && failoverHops < MAX_FAILOVER_HOPS) {
          const better = await pickFailoverTarget(cur.activeServer.id);
          if (better && better.id !== cur.activeServer.id) {
            target = better;
            failoverHops += 1;
            const lang = useSettingsStore.getState().app.language;
            toast.warning(FAILOVER_MESSAGE[lang](better.name));
            // Fresh per-server attempt budget for the new server — bounded by the
            // global MAX_FAILOVER_HOPS cap so a flapping network can't loop
            // A→B→A forever.
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
      const mySeq = ++connectSeq;
      clearReconnectTimer();
      set({
        status: "connecting",
        error: null,
        activeServerId: server.id,
        activeServer: server,
        autoReconnect: true,
        healthFailures: 0,
      });
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

        const core = selectCore(server, proxy.coreKind, !!proxy.tun?.enabled);
        if (!core) {
          throw new Error(
            `\u041d\u0438 \u043e\u0434\u043d\u043e \u044f\u0434\u0440\u043e \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b ${server.protocol.toUpperCase()}`,
          );
        }
        // TUN (VPN) mode with a server that can ONLY run on Xray (PQ-REALITY /
        // XHTTP) is impossible on a single core: Xray has no TUN inbound and
        // sing-box can't speak the protocol. Refuse with a clear, actionable
        // message instead of triggering a UAC prompt and then tunnelling
        // nothing.
        if (proxy.tun?.enabled && core.kind === "xray") {
          toast.error(TUN_XRAY_CONFLICT_MESSAGE[lang]);
          clearReconnectTimer();
          set({
            status: "error",
            autoReconnect: false,
            activeCore: null,
            error: TUN_XRAY_CONFLICT_MESSAGE[lang],
          });
          return;
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
        // Arm the kill-switch *after* the pre-flight checks pass but *before* the
        // tunnel comes up, so the connection attempt itself can't leak — yet a
        // server we reject up-front (invalid config, TUN/xray conflict, missing
        // elevation) never needlessly points the firewall at a node that will
        // never connect. Re-arming on each (re)connect keeps the allow-list
        // pointed at the current server after a failover. Fail SAFE: if the user
        // enabled the kill-switch and it can't arm, abort the connection rather
        // than tunnelling with no leak protection.
        if (proxy.killSwitch) {
          const armed = await armKillSwitch(server.address);
          if (!armed) {
            clearReconnectTimer();
            set({
              status: "error",
              autoReconnect: false,
              activeCore: null,
              error: KILLSWITCH_FAIL_MESSAGE[lang],
            });
            return;
          }
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
        // If a newer connect()/disconnect() superseded us while coreStart was in
        // flight, that newer call owns the state now — don't touch it.
        if (mySeq !== connectSeq) return;
        // The connected/error transition now arrives via core://status events
        // (handled in applyCoreStatus), so we don't optimistically flip here.
      } catch (e) {
        if (mySeq !== connectSeq) return; // superseded — newer attempt owns state
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
      // Supersede any in-flight connect() and stale core events.
      connectSeq++;
      failoverHops = 0;
      clearReconnectTimer();
      set({ autoReconnect: false, reconnectAttempts: 0, healthFailures: 0 });
      // Tear down each piece INDEPENDENTLY and await it: a failure in one step
      // (e.g. the kill-switch firewall restore) must not skip the others (the
      // core would keep running). Each is awaited so the user actually regains
      // networking before the UI says "disconnected"; failures are collected and
      // surfaced rather than swallowed (a silent kill-switch restore failure
      // would leave the machine in default-deny = no internet).
      const teardownErrors: string[] = [];
      const step = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (e) {
          teardownErrors.push(e instanceof Error ? e.message : String(e));
        }
      };
      try {
        if (proxy.killSwitch) await step(() => disableKillSwitch());
        if (proxy.systemProxy) await step(() => setSystemProxy(false, proxy.mixedPort));
        await step(() => coreStop());
        if (teardownErrors.length) toast.warning(teardownErrors.join("; "));
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
          // Guard against a delayed `running` from a PREVIOUS core lifecycle
          // arriving after the user disconnected (which clears activeServer): it
          // must not resurrect the connection and show "connected" with no core.
          if (!state.activeServer) break;
          clearReconnectTimer();
          failoverHops = 0; // a healthy connection resets the failover budget
          set({
            status: "connected",
            connectedAt: state.connectedAt ?? Date.now(),
            error: null,
            reconnectAttempts: 0,
            healthFailures: 0,
          });
          // Apply the system proxy and surface a warning if it fails — otherwise
          // the UI says "connected" while no app traffic is actually proxied.
          if (proxy.systemProxy) {
            void setSystemProxy(true, proxy.mixedPort).catch(() => {
              const lang = useSettingsStore.getState().app.language;
              toast.warning(SYSPROXY_FAIL_MESSAGE[lang]);
            });
          }
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
