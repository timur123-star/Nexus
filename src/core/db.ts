/**
 * Durable persistence layer.
 *
 * zustand stores persist as JSON blobs. We back them with a real SQLite
 * database (via tauri-plugin-sql) so settings/servers survive cache clears and
 * are portable, while keeping a synchronous localStorage cache so hydration is
 * instant and there is no theme flash on startup.
 *
 * Outside Tauri (e.g. `vite dev` in a browser) we transparently fall back to
 * localStorage only.
 */
import type { StateStorage } from "zustand/middleware";
import { isTauri } from "./ipc";

type SqlDb = {
  execute: (query: string, bind?: unknown[]) => Promise<unknown>;
  select: <T>(query: string, bind?: unknown[]) => Promise<T>;
};

let dbPromise: Promise<SqlDb | null> | null = null;

async function getDb(): Promise<SqlDb | null> {
  if (!isTauri) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-sql");
        const Database = mod.default;
        const db = (await Database.load("sqlite:nexusshield.db")) as unknown as SqlDb;
        await db.execute(
          "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        );
        return db;
      } catch (e) {
        console.error("[db] SQLite init failed, using localStorage only:", e);
        return null;
      }
    })();
  }
  return dbPromise;
}

function lsGet(name: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(name) : null;
  } catch {
    return null;
  }
}
function lsSet(name: string, value: string): void {
  try {
    localStorage.setItem(name, value);
  } catch {
    /* ignore quota / unavailable */
  }
}
function lsRemove(name: string): void {
  try {
    localStorage.removeItem(name);
  } catch {
    /* ignore */
  }
}

/**
 * StateStorage that reads synchronously from a localStorage cache (fast,
 * flash-free hydration) and writes through to SQLite for durability. On a
 * fresh machine where the cache is empty, reads fall back to SQLite.
 */
export const persistentStorage: StateStorage = {
  getItem: (name) => {
    const cached = lsGet(name);
    if (cached !== null) return cached; // synchronous fast-path
    if (!isTauri) return null;
    return (async () => {
      const db = await getDb();
      if (!db) return null;
      try {
        const rows = await db.select<Array<{ value: string }>>(
          "SELECT value FROM kv WHERE key = $1",
          [name],
        );
        const val = rows[0]?.value ?? null;
        if (val !== null) lsSet(name, val);
        return val;
      } catch {
        return null;
      }
    })();
  },

  setItem: (name, value) => {
    lsSet(name, value);
    if (!isTauri) return;
    void (async () => {
      const db = await getDb();
      if (!db) return;
      try {
        await db.execute(
          "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [name, value],
        );
      } catch (e) {
        console.error("[db] setItem failed:", e);
      }
    })();
  },

  removeItem: (name) => {
    lsRemove(name);
    if (!isTauri) return;
    void (async () => {
      const db = await getDb();
      if (!db) return;
      try {
        await db.execute("DELETE FROM kv WHERE key = $1", [name]);
      } catch {
        /* ignore */
      }
    })();
  },
};
