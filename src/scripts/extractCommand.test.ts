import { describe, it, expect } from "vitest";
// Pure helper from the core-fetch build script. Importing is side-effect-free:
// the script only auto-runs its downloader when invoked as the main module.
import { extractCommand } from "../../scripts/fetch-cores.mjs";

describe("fetch-cores extractCommand", () => {
  // Regression: on Windows, Git's GNU tar shadows System32 bsdtar on PATH and
  // misreads an absolute archive path like `C:\…\x.zip` as a remote `host:path`
  // ("Cannot connect to C: resolve failed"), so zips must be extracted with
  // PowerShell's Expand-Archive, never a bare `tar`.
  it("uses PowerShell Expand-Archive for a Windows zip (never tar)", () => {
    const { cmd, args } = extractCommand(
      "C:\\Users\\me\\AppData\\Local\\Temp\\sing-box.zip",
      "C:\\Users\\me\\out",
      "win32",
    );
    expect(cmd).toBe("powershell");
    expect(cmd).not.toBe("tar");
    expect(args.join(" ")).toContain("Expand-Archive");
    expect(args.join(" ")).toContain("sing-box.zip");
  });

  it("uses unzip for a Linux zip", () => {
    const { cmd, args } = extractCommand("/tmp/Xray-linux-64.zip", "/tmp/out", "linux");
    expect(cmd).toBe("unzip");
    expect(args).toEqual(["-o", "/tmp/Xray-linux-64.zip", "-d", "/tmp/out"]);
  });

  it("uses tar for a tar.gz on every platform", () => {
    for (const plat of ["linux", "darwin", "win32"]) {
      const { cmd } = extractCommand("/tmp/sing-box.tar.gz", "/tmp/out", plat);
      expect(cmd).toBe("tar");
    }
  });

  it("uses bsdtar (tar) for a macOS zip — no colon-path hazard on unix", () => {
    const { cmd } = extractCommand("/tmp/Xray-macos-arm64.zip", "/tmp/out", "darwin");
    expect(cmd).toBe("tar");
  });
});
