import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerProfile, Subscription } from "../core/types";
import { parseMany, parseShareLink } from "../core/parser";
import { fetchSubscription, pingServer } from "../core/ipc";

interface ServerState {
  servers: ServerProfile[];
  subscriptions: Subscription[];

  // mutations
  addFromLink: (link: string) => ServerProfile;
  addFromBlob: (text: string) => { added: number; errors: number };
  removeServer: (id: string) => void;
  duplicateServer: (id: string) => void;
  updateServer: (id: string, patch: Partial<ServerProfile>) => void;
  toggleFavorite: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;

  // ping
  pingOne: (id: string) => Promise<void>;
  pingAll: () => Promise<void>;

  // subscriptions
  addSubscription: (name: string, url: string, intervalHours: number) => Promise<void>;
  refreshSubscription: (id: string) => Promise<void>;
  removeSubscription: (id: string, removeServers: boolean) => void;
}

function now(): number {
  // Date.now is fine in app runtime (only the parser must avoid it for tests).
  return Date.now();
}

function makeSubId(): string {
  return `sub_${now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

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

      pingOne: async (id) => {
        const srv = get().servers.find((x) => x.id === id);
        if (!srv) return;
        const ms = await pingServer(srv.address, srv.port);
        get().updateServer(id, { latencyMs: ms });
      },

      pingAll: async () => {
        const all = get().servers;
        // Probe with limited concurrency so we don't open hundreds of sockets.
        const queue = [...all];
        const worker = async () => {
          while (queue.length) {
            const srv = queue.shift()!;
            const ms = await pingServer(srv.address, srv.port);
            get().updateServer(srv.id, { latencyMs: ms });
          }
        };
        await Promise.all(Array.from({ length: 8 }, worker));
      },

      addSubscription: async (name, url, intervalHours) => {
        const sub: Subscription = {
          id: makeSubId(),
          name,
          url,
          updateIntervalHours: intervalHours,
          serverCount: 0,
          status: "never",
        };
        set((s) => ({ subscriptions: [...s.subscriptions, sub] }));
        await get().refreshSubscription(sub.id);
      },

      refreshSubscription: async (id) => {
        const sub = get().subscriptions.find((x) => x.id === id);
        if (!sub) return;
        set((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, status: "updating" } : x,
          ),
        }));
        try {
          const body = await fetchSubscription(sub.url);
          const { servers } = parseMany(body);
          const tagged = servers.map((srv) => ({
            ...srv,
            id: `${id}_${srv.id}`,
            subscriptionId: id,
            createdAt: now(),
          }));
          set((s) => {
            // Replace this subscription's servers wholesale.
            const others = s.servers.filter((x) => x.subscriptionId !== id);
            return {
              servers: [...others, ...tagged],
              subscriptions: s.subscriptions.map((x) =>
                x.id === id
                  ? { ...x, status: "ok", serverCount: tagged.length, lastUpdatedAt: now(), lastError: undefined }
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
      },

      removeSubscription: (id, removeServers) =>
        set((s) => ({
          subscriptions: s.subscriptions.filter((x) => x.id !== id),
          servers: removeServers ? s.servers.filter((x) => x.subscriptionId !== id) : s.servers,
        })),
    }),
    { name: "nexusshield-servers" },
  ),
);
