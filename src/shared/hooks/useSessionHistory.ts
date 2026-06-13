import { useEffect } from "react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useHistoryStore } from "../../store/useHistoryStore";
import type { TrafficStats } from "../../core/ipc";

const ZERO: TrafficStats = { up: 0, down: 0, totalUp: 0, totalDown: 0 };

/**
 * Records connection sessions into {@link useHistoryStore}.
 *
 * The connection store clears `activeServer`, `connectedAt` and `traffic` the
 * moment it disconnects, so we cannot read them after the fact. Instead we
 * subscribe to every transition and keep the last good traffic totals while a
 * session is live (connected or mid-reconnect), then finalise a record when the
 * status reaches a terminal state. Keeping the logic here means the connection
 * store stays untouched.
 */
export function useSessionHistory(): void {
  useEffect(() => {
    let live: { startedAt: number; serverName: string; core: string | null } | null = null;
    let lastTraffic: TrafficStats = ZERO;

    const finalize = (endedAt: number): void => {
      if (!live) return;
      useHistoryStore.getState().record({
        serverName: live.serverName,
        core: live.core,
        startedAt: live.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - live.startedAt),
        bytesUp: lastTraffic.totalUp,
        bytesDown: lastTraffic.totalDown,
      });
      live = null;
      lastTraffic = ZERO;
    };

    const unsub = useConnectionStore.subscribe((state, prev) => {
      const liveStatus = state.status === "connected" || state.status === "reconnecting";
      // Only sample traffic while still online; the disconnect transition zeroes
      // it in the same update, and we must not capture that zero.
      if (live && liveStatus) lastTraffic = state.traffic;

      // Open a session on the first connected transition (a successful reconnect
      // keeps the existing one because `live` is still set).
      if (state.status === "connected" && prev.status !== "connected" && !live) {
        live = {
          startedAt: state.connectedAt ?? Date.now(),
          serverName: state.activeServer?.name ?? "\u2014",
          core: state.activeCore,
        };
        lastTraffic = state.traffic;
      }

      const wasLive =
        prev.status === "connected" ||
        prev.status === "reconnecting" ||
        prev.status === "connecting";
      if ((state.status === "disconnected" || state.status === "error") && wasLive) {
        finalize(Date.now());
      }
    });

    return () => {
      // App is closing mid-session: still log what we have.
      finalize(Date.now());
      unsub();
    };
  }, []);
}
