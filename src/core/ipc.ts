/**
 * Typed bridge to the Rust backend.
 *
 * Every call goes through `safeInvoke`, which degrades gracefully when the app
 * runs outside a Tauri shell (e.g. `vite dev` in a plain browser) so the UI is
 * still developable without the native side.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CoreKind } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isTauri) {
    if (fallback !== undefined) return fallback;
    throw new Error(`[mock] ${cmd} called outside Tauri`);
  }
  return invoke<T>(cmd, args);
}

export type CoreStatus = "stopped" | "starting" | "running" | "error";

export interface TrafficStats {
  up: number; // bytes/s
  down: number; // bytes/s
  totalUp: number; // bytes
  totalDown: number; // bytes
}

export interface ConnectionEntry {
  id: string;
  host: string;
  network: string;
  outbound: string;
  upload: number;
  download: number;
  start: number;
}

/** Start the selected core with a fully-formed config object. */
export const coreStart = (config: object, core: CoreKind = "sing-box") =>
  safeInvoke<void>("core_start", { config: JSON.stringify(config), core }, undefined);

export const coreStop = () => safeInvoke<void>("core_stop", undefined, undefined);

export const coreStatus = () => safeInvoke<CoreStatus>("core_status", undefined, "stopped");

/** TCP latency probe. Returns ms, or -1 on failure. */
export const pingServer = (address: string, port: number) =>
  safeInvoke<number>("ping_server", { address, port }, mockPing());

/** Download a subscription body (raw text, possibly base64). */
export const fetchSubscription = (url: string) =>
  safeInvoke<string>("fetch_subscription", { url }, "");

/** Poll the Clash API for live traffic + totals. */
export const getTraffic = (port: number, secret: string) =>
  safeInvoke<TrafficStats>("get_traffic", { port, secret }, mockTraffic());

export const getConnections = (port: number, secret: string) =>
  safeInvoke<ConnectionEntry[]>("get_connections", { port, secret }, []);

export const setSystemProxy = (enable: boolean, port: number) =>
  safeInvoke<void>("set_system_proxy", { enable, port }, undefined);

/** Whether the app currently has the privileges required for TUN mode. */
export const isElevated = () => safeInvoke<boolean>("is_elevated", undefined, false);

/** Relaunch the app with elevated privileges (UAC / osascript / pkexec). */
export const relaunchAsAdmin = () => safeInvoke<void>("relaunch_as_admin", undefined, undefined);

export const openLogsDir = () => safeInvoke<void>("open_logs_dir", undefined, undefined);

export const validateConfig = (config: string) =>
  safeInvoke<{ ok: boolean; error?: string }>("validate_config", { config }, { ok: true });

/** Subscribe to core log lines streamed from Rust. */
export async function onCoreLog(handler: (line: string) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<string>("core://log", (e) => handler(e.payload));
}

/** Subscribe to core status transitions. */
export async function onCoreStatus(handler: (s: CoreStatus) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<CoreStatus>("core://status", (e) => handler(e.payload));
}

// \u2500\u2500 Mock helpers for browser-only development \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function mockPing(): number {
  return 40 + Math.floor(Math.random() * 220);
}
function mockTraffic(): TrafficStats {
  return {
    up: Math.random() * 2_000_000,
    down: Math.random() * 12_000_000,
    totalUp: 1024 * 1024 * 128,
    totalDown: 1024 * 1024 * 1024,
  };
}
