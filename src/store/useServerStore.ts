import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ServerProfile, Subscription } from "../core/types";
import { parseMany, parseShareLink } from "../core/parser";
import { fetchSubscriptionInfo, pingServer } from "../core/ipc";
import type { SubscriptionUsage } from "../core/types";

/**
 * Parse a `Subscription-Userinfo` header
 * (`upload=…; download=…; total=…; expire=…`) into structured usage. Returns
 * undefined when the header is absent or carries no numeric fields.
 */
function parseUserinfo(header: string): SubscriptionUsage | undefined {
  if (!header.trim()) return undefined;
  const fields: Record<string, number> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined) continue;
    const n = Number(v.trim());
    if (Number.isFinite(n)) fields[k.trim().toLowerCase()] = n;
  }
  if (!("upload" in fields) && !("download" in fields) && !("total" in fields) && !("expire" in fields))
    return undefined;
  return {
    upload: fields.upload ?? 0,
    download: fields.download ?? 0,
    total: fields.total ?? 0,
    expire: fields.expire ?? 0,
  };
}
import { persistentStorage } from "../core/db";
import { useSettingsStore } from "./useSettingsStore";

interface ServerState {
  servers: ServerProfile[];
  subscriptions: Subscription[];

  // mutations
  addFromLink: (link: string) => ServerProfile;
  addFromBlob: (text: string) => { added: number; errors: number };
  removeServer: (id: string) => void;
  /** Remove multiple servers at once (batch delete). */
  removeMany: (ids: string[]) => void;
  duplicateServer: (id: string) => void;
  updateServer: (id: string, patch: Partial<ServerProfile>) => void;
  toggleFavorite: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
  /** Sort servers by measured latency (lowest first, unreachable last). */
  sortByPing: () => void;

  // ping
  pingOne: (id: string) => Promise<void>;
  /** Ping a specific set of servers with limited concurrency. */
  pingMany: (ids: string[]) => Promise<void>;
  pingAll: () => Promise<void>;
  /** Ping every server, then return the reachable one with the lowest latency. */
  pingAllAndBest: () => Promise<ServerProfile | null>;

  // subscriptions
  addSubscription: (
    name: string,
    url: string,
    intervalHours: number,
    userAgent?: string,
  ) => Promise<Subscription>;
  refreshSubscription: (id: string) => Promise<Subscription | undefined>;
  removeSubscription: (id: string, removeServers: boolean) => void;
}

function now(): number {
  // Date.now is fine in app runtime (only the parser must avoid it for tests).
  return Date.now();
}

function makeSubId(): string {
  return `sub_${now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Number of concurrent latency probes; keeps us from opening hundreds of sockets. */
const PING_WORKERS = 8;

export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      subscriptions: [],

      addFromLink: (link) => {
        const server = { ...parseShareLink(link), createdAt: now() };
        set((s) => (s.servers.some((x) => x.id === server.id) ? s : { servers: [...s.servers, server] }));
        return server;
      },

      addFromBlob: (text) => {
        const { servers, errors } = parseMany(text);
        const stamped = servers.map((s) => ({ ...s, createdAt: now() }));
        set((s) => {
          const existing = new Set(s.servers.map((x) => x.id));
          const fresh = stamped.filter((x) => !existing.has(x.id));
          return { servers: [...s.servers, ...fresh] };
        });
        return { added: stamped.length, errors: errors.length };
      },

      removeServer: (id) => set((s) => ({ servers: s.servers.filter((x) => x.id !== id) })),

      removeMany: (ids) => {
        const remove = new Set(ids);
        set((s) => ({ servers: s.servers.filter((x) => !remove.has(x.id)) }));
      },

      duplicateServer: (id) =>
        set((s) => {
          const orig = s.servers.find((x) => x.id === id);
          if (!orig) return s;
          const copy: ServerProfile = {
            ...orig,
            id: `${orig.id}_copy_${Math.floor(Math.random() * 1e4).toString(36)}`,
            name: `${orig.name} (copy)`,
            createdAt: now(),
          };
          return { servers: [...s.servers, copy] };
        }),

      updateServer: (id, patch) =>
        set((s) => ({ servers: s.servers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      toggleFavorite: (id) =>
        set((s) => ({
          servers: s.servers.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)),
        })),

      reorder: (fromId, toId) =>
        set((s) => {
          const arr = [...s.servers];
          const from = arr.findIndex((x) => x.id === fromId);
          const to = arr.findIndex((x) => x.id === toId);
          if (from < 0 || to < 0 || from === to) return s;
          const [moved] = arr.splice(from, 1);
          arr.splice(to, 0, moved);
          return { servers: arr };
        }),

      sortByPing: () =>
        set((s) => ({
          servers: [...s.servers].sort((a, b) => {
            const la = a.latencyMs ?? Infinity;
            const lb = b.latencyMs ?? Infinity;
            // Unreachable (-1) → last
            const va = la < 0 ? Infinity : la;
            const vb = lb < 0 ? Infinity : lb;
            return va - vb;
          }),
        })),

      pingOne: async (id) => {
        const srv = get().servers.find((x) => x.id === id);
        if (!srv) return;
        const ms = await pingServer(srv.address, srv.port);
        get().updateServer(id, { latencyMs: ms });
      },

      pingMany: async (ids) => {
        const wanted = new Set(ids);
        // Probe with limited concurrency so we don't open hundreds of sockets.
        const queue = get().servers.filter((s) => wanted.has(s.id));
        const worker = async () => {
          while (queue.length) {
            const srv = queue.shift()!;
            const ms = await pingServer(srv.address, srv.port);
            get().updateServer(srv.id, { latencyMs: ms });
          }
        };
        await Promise.all(Array.from({ length: PING_WORKERS }, worker));

        // Auto-sort by latency if the user enabled it.
        if (useSettingsStore.getState().app.autoSortByPing) {
          get().sortByPing();
        }
      },

      pingAll: async () => {
        await get().pingMany(get().servers.map((s) => s.id));
      },

      pingAllAndBest: async () => {
        await get().pingAll();
        // pingServer returns -1 for unreachable hosts; only consider live ones.
        const reachable = get().servers.filter((s) => (s.latencyMs ?? -1) >= 0);
        if (reachable.length === 0) return null;
        return reachable.reduce((best, s) =>
          (s.latencyMs ?? Infinity) < (best.latencyMs ?? Infinity) ? s : best,
        );
      },

      addSubscription: async (name, url, intervalHours, userAgent) => {
        const trimmedUrl = url.trim();
        // Dedup by URL: re-pasting / re-adding the same subscription should just
        // refresh the existing one instead of piling up duplicate (and often
        // broken) entries that show up as "странные инбаунды".
        const existing = get().subscriptions.find((x) => x.url === trimmedUrl);
        if (existing) {
          return (await get().refreshSubscription(existing.id)) ?? existing;
        }
        const sub: Subscription = {
          id: makeSubId(),
          name,
          url: trimmedUrl,
          updateIntervalHours: intervalHours,
          userAgent: userAgent?.trim() ? userAgent.trim() : undefined,
          serverCount: 0,
          status: "never",
        };
        set((s) => ({ subscriptions: [...s.subscriptions, sub] }));
        return (await get().refreshSubscription(sub.id)) ?? sub;
      },

      refreshSubscription: async (id) => {
        const sub = get().subscriptions.find((x) => x.id === id);
        if (!sub) return undefined;
        set((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, status: "updating" } : x,
          ),
        }));
        try {
          const settings = useSettingsStore.getState();
          const allowInsecure = settings.proxy.allowInsecureSubs;
          // Per-subscription UA wins; otherwise fall back to the global default.
          const userAgent = sub.userAgent?.trim()
            ? sub.userAgent.trim()
            : settings.app.subscriptionUserAgent;
          const payload = await fetchSubscriptionInfo(sub.url, allowInsecure, userAgent);
          const body = payload.body;
          const usage = parseUserinfo(payload.userinfo);
          const { servers } = parseMany(body);
          set((s) => {
            // Server ids are deterministic, so the same endpoint keeps the same
            // id across refreshes. Preserve the user-owned state (favorite,
            // measured latency, usage) while adopting fresh config fields from
            // the subscription body. Servers dropped upstream simply disappear.
            const prev = new Map(
              s.servers.filter((x) => x.subscriptionId === id).map((x) => [x.id, x]),
            );
            const tagged = servers.map((srv) => {
              const fullId = `${id}_${srv.id}`;
              const old = prev.get(fullId);
              return {
                ...srv,
                id: fullId,
                subscriptionId: id,
                favorite: old?.favorite ?? srv.favorite,
                latencyMs: old ? old.latencyMs ?? null : srv.latencyMs ?? null,
                lastUsedAt: old?.lastUsedAt,
                tags: old?.tags ?? srv.tags,
                createdAt: old?.createdAt ?? now(),
              };
            });
            const others = s.servers.filter((x) => x.subscriptionId !== id);
            return {
              servers: [...others, ...tagged],
              subscriptions: s.subscriptions.map((x) =>
                x.id === id
                  ? { ...x, status: "ok", serverCount: tagged.length, lastUpdatedAt: now(), lastError: undefined, usage: usage ?? x.usage }
                  : x,
              ),
            };
          });
        } catch (e) {
          set((s) => ({
            subscriptions: s.subscriptions.map((x) =>
              x.id === id
                ? { ...x, status: "error", lastError: e instanceof Error ? e.message : String(e) }
                : x,
            ),
          }));
        }
        return get().subscriptions.find((x) => x.id === id);
      },

      removeSubscription: (id, removeServers) =>
        set((s) => ({
          subscriptions: s.subscriptions.filter((x) => x.id !== id),
          servers: removeServers ? s.servers.filter((x) => x.subscriptionId !== id) : s.servers,
        })),
    }),
    { name: "nexusshield-servers", storage: createJSONStorage(() => persistentStorage) },
  ),
);
