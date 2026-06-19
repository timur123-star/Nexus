/**
 * Auto-update bridge.
 *
 * Wraps the Tauri updater/process plugins so the rest of the app can check for
 * and install updates without caring whether it runs inside the native shell.
 * In a plain browser (`vite dev`) every call degrades to a harmless no-op so the
 * Settings UI stays developable.
 */
import { isTauri } from "./ipc";

/** A pending update the user can choose to download & install. */
export interface PendingUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
}

/** Progress callback phases emitted while an update downloads/installs. */
export type UpdateProgress =
  | { phase: "started"; contentLength?: number }
  | { phase: "downloading"; downloaded: number; contentLength?: number }
  | { phase: "finished" };

// The plugin modules are imported lazily so a plain-browser build never tries to
// touch `window.__TAURI_INTERNALS__` at module-eval time.
async function loadUpdater() {
  return import("@tauri-apps/plugin-updater");
}

/**
 * Ask the configured endpoint whether a newer signed build exists.
 * Returns `null` when up to date (or when running outside Tauri).
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isTauri) return null;
  const { check } = await loadUpdater();
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body || undefined,
    date: update.date || undefined,
  };
}

/**
 * Download and install the available update, reporting byte-level progress, then
 * relaunch the app. Throws if no update is available or verification fails.
 */
export async function downloadAndInstallUpdate(
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  if (!isTauri) throw new Error("[mock] update install called outside Tauri");
  const { check } = await loadUpdater();
  const update = await check();
  if (!update) throw new Error("no-update");

  let downloaded = 0;
  let contentLength: number | undefined;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength;
        onProgress?.({ phase: "started", contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: "downloading", downloaded, contentLength });
        break;
      case "Finished":
        onProgress?.({ phase: "finished" });
        break;
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
