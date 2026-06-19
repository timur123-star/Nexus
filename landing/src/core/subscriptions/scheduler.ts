/**
 * Subscription auto-update scheduler.
 *
 * A lightweight tick refreshes any subscription whose configured update
 * interval has elapsed. The pure `isDue` predicate is unit-tested; the
 * scheduler wires it to the server store and a timer.
 */
import { useServerStore } from "../../store/useServerStore";
import type { Subscription } from "../types";

const HOUR_MS = 3_600_000;
/**
 * After a FAILED refresh, wait at least this long before retrying — regardless
 * of the (short) check interval. Without it, a subscription whose URL is dead or
 * never succeeded keeps `lastUpdatedAt` unset and would be "due" on every single
 * tick, hammering the dead endpoint every 60s forever.
 */
export const ERROR_BACKOFF_MS = 5 * 60_000;

/** Whether a subscription should be refreshed at `nowMs`. */
export function isDue(sub: Subscription, nowMs: number): boolean {
  if (sub.status === "updating") return false; // a refresh is already in flight
  if (sub.updateIntervalHours <= 0) return false; // 0 = manual only
  // Back off after a failure: don't retry a failing URL until the backoff window
  // since the last ATTEMPT has elapsed.
  if (sub.status === "error" && sub.lastAttemptAt && nowMs - sub.lastAttemptAt < ERROR_BACKOFF_MS) {
    return false;
  }
  if (!sub.lastUpdatedAt) return true; // never successfully fetched → try
  return nowMs - sub.lastUpdatedAt >= sub.updateIntervalHours * HOUR_MS;
}

/**
 * Clear any subscription stuck in "updating" from a previous session.
 *
 * `status` is persisted, so a refresh interrupted by an app close/crash leaves
 * the subscription marked "updating" forever — which makes isDue() skip it on
 * every future tick. Reset such entries so auto-update can resume.
 */
function clearStaleUpdating(): void {
  const { subscriptions } = useServerStore.getState();
  if (!subscriptions.some((s) => s.status === "updating")) return;
  useServerStore.setState((s) => ({
    subscriptions: s.subscriptions.map((sub) =>
      sub.status === "updating"
        ? { ...sub, status: (sub.lastUpdatedAt ? "ok" : "never") as Subscription["status"] }
        : sub,
    ),
  }));
}

/**
 * Start the scheduler. Runs immediately, then every `checkEveryMs`.
 * Returns a stop function that clears the timer. Safe to call once on mount.
 */
export function startSubscriptionScheduler(checkEveryMs = 60_000): () => void {
  clearStaleUpdating(); // recover from an interrupted refresh before ticking

  const tick = () => {
    const { subscriptions, refreshSubscription } = useServerStore.getState();
    const now = Date.now();
    for (const sub of subscriptions) {
      if (isDue(sub, now)) void refreshSubscription(sub.id);
    }
  };
  tick(); // catch up immediately on startup
  const handle = setInterval(tick, checkEveryMs) as unknown as number;
  return () => clearInterval(handle);
}
