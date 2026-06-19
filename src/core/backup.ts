/**
 * Backup & restore: serialise the entire app state (settings + servers +
 * subscriptions) into a single JSON file and load it back. Kept dependency-free
 * so it works inside the Tauri webview without any extra plugins.
 */
import type { ServerProfile, Subscription } from "./types";
import type { AppSettings, ProxySettings } from "../store/useSettingsStore";
import { useSettingsStore, DEFAULT_APP, DEFAULT_PROXY } from "../store/useSettingsStore";
import { useServerStore } from "../store/useServerStore";

/** Marker so we can reject unrelated JSON files on import. */
export const BACKUP_MAGIC = "nexusshield";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  settings: { app: AppSettings; proxy: ProxySettings };
  servers: ServerProfile[];
  subscriptions: Subscription[];
}

export interface BackupApplyResult {
  servers: number;
  subscriptions: number;
}

/** Snapshot the current live state into a backup object. */
export function buildBackup(): BackupFile {
  const { app, proxy } = useSettingsStore.getState();
  const { servers, subscriptions } = useServerStore.getState();
  return {
    app: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { app, proxy },
    servers,
    subscriptions,
  };
}

export function serializeBackup(backup: BackupFile = buildBackup()): string {
  return JSON.stringify(backup, null, 2);
}

/** Trigger a download of the current state as a timestamped JSON file. */
export function downloadBackup(): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([serializeBackup()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexusshield-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse + validate a backup file's text. Throws a human-readable error. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("not a valid JSON file");
  }
  if (!data || typeof data !== "object") throw new Error("empty or invalid file");
  const obj = data as Record<string, unknown>;
  if (obj.app !== BACKUP_MAGIC) throw new Error("not a NexusShield backup file");
  if (!obj.settings || typeof obj.settings !== "object") throw new Error("backup has no settings");
  if (!Array.isArray(obj.servers)) throw new Error("backup has no server list");
  // `subscriptions` may be absent (v0 / forward-compat) — that's fine and loads
  // as none. But a *present* non-array value means a corrupt/truncated file:
  // reject it loudly instead of letting applyBackup silently drop every
  // subscription the user expected to restore.
  if (obj.subscriptions !== undefined && !Array.isArray(obj.subscriptions)) {
    throw new Error("backup has a corrupt subscription list");
  }
  return data as BackupFile;
}

/**
 * Apply a parsed backup onto the live stores. Unknown/missing fields fall back
 * to defaults so a backup from an older version still loads cleanly. zustand's
 * setState shallow-merges, so the store action methods are preserved.
 */
export function applyBackup(backup: BackupFile): BackupApplyResult {
  const app: AppSettings = { ...DEFAULT_APP, ...(backup.settings?.app ?? {}) };
  const proxy: ProxySettings = { ...DEFAULT_PROXY, ...(backup.settings?.proxy ?? {}) };
  const servers = Array.isArray(backup.servers) ? backup.servers : [];
  const subscriptions = Array.isArray(backup.subscriptions) ? backup.subscriptions : [];

  useSettingsStore.setState({ app, proxy });
  useServerStore.setState({ servers, subscriptions });

  return { servers: servers.length, subscriptions: subscriptions.length };
}
