import { describe, it, expect } from "vitest";
import { isDue, ERROR_BACKOFF_MS } from "./scheduler";
import type { Subscription } from "../types";

const HOUR = 3_600_000;

const base: Subscription = {
  id: "s1",
  name: "test",
  url: "https://example.com/sub",
  updateIntervalHours: 12,
  serverCount: 3,
  status: "ok",
  lastUpdatedAt: 1_700_000_000_000,
};

describe("isDue", () => {
  it("is due when never updated", () => {
    expect(isDue({ ...base, lastUpdatedAt: undefined, status: "never" }, Date.now())).toBe(true);
  });

  it("is not due before the interval elapses", () => {
    expect(isDue(base, base.lastUpdatedAt! + 6 * HOUR)).toBe(false);
  });

  it("is due after the interval elapses", () => {
    expect(isDue(base, base.lastUpdatedAt! + 13 * HOUR)).toBe(true);
  });

  it("never auto-updates when interval is 0", () => {
    expect(isDue({ ...base, updateIntervalHours: 0, lastUpdatedAt: undefined }, Date.now())).toBe(
      false,
    );
  });

  it("skips while a refresh is in flight", () => {
    expect(isDue({ ...base, status: "updating", lastUpdatedAt: undefined }, Date.now())).toBe(
      false,
    );
  });

  it("backs off after a failed attempt instead of hammering every tick", () => {
    const now = 1_700_000_000_000;
    const failed: Subscription = {
      ...base,
      status: "error",
      lastUpdatedAt: undefined, // never succeeded
      lastAttemptAt: now,
    };
    // Right after the failed attempt: not due (within backoff).
    expect(isDue(failed, now + 60_000)).toBe(false);
    expect(isDue(failed, now + ERROR_BACKOFF_MS - 1)).toBe(false);
    // After the backoff window: due again for a retry.
    expect(isDue(failed, now + ERROR_BACKOFF_MS + 1)).toBe(true);
  });

  it("still retries a never-attempted errored sub immediately (no lastAttemptAt)", () => {
    expect(isDue({ ...base, status: "error", lastUpdatedAt: undefined }, Date.now())).toBe(true);
  });
});
