import { describe, expect, it, vi } from "vitest";

// Force the "running in a plain browser / not Tauri" branch.
vi.mock("./ipc", () => ({ isTauri: false }));

import { checkForUpdate, downloadAndInstallUpdate } from "./updater";

describe("updater outside the Tauri shell", () => {
  it("checkForUpdate resolves to null (never throws) so Settings stays usable", async () => {
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("downloadAndInstallUpdate refuses to run with a clear error", async () => {
    await expect(downloadAndInstallUpdate()).rejects.toThrow(/Tauri/i);
  });
});
