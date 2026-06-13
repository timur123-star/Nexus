import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { persistentStorage } from "../core/db";

/** One completed (or app-closed) connection session. */
export interface SessionRecord {
  id: string;
  /** Display name of the server that was connected. */
  serverName: string;
  /** Core that actually ran the session ("sing-box" | "xray"), or null. */
  core: string | null;
  /** Epoch ms when the session became connected. */
  startedAt: number;
  /** Epoch ms when the session ended. */
  endedAt: number;
  durationMs: number;
  /** Cumulative bytes uploaded during the session. */
  bytesUp: number;
  /** Cumulative bytes downloaded during the session. */
  bytesDown: number;
}

const MAX_HISTORY = 200;

interface HistoryState {
  sessions: SessionRecord[];
  /** Append a finished session (newest first). */
  record: (s: Omit<SessionRecord, "id">) => void;
  removeOne: (id: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      sessions: [],
      record: (s) =>
        set((state) => {
          // Ignore sub-second blips that moved no data \u2014 these are almost
          // always failed dials, not real sessions worth logging.
          if (s.durationMs < 1000 && s.bytesUp + s.bytesDown === 0) return {};
          const rec: SessionRecord = {
            ...s,
            id: `sess-${s.startedAt}-${Math.random().toString(36).slice(2, 7)}`,
          };
          return { sessions: [rec, ...state.sessions].slice(0, MAX_HISTORY) };
        }),
      removeOne: (id) =>
        set((state) => ({ sessions: state.sessions.filter((x) => x.id !== id) })),
      clear: () => set({ sessions: [] }),
    }),
    {
      name: "nexusshield-history",
      storage: createJSONStorage(() => persistentStorage),
    },
  ),
);
