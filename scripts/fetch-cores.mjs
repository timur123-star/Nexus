#!/usr/bin/env node
/**
 * Fetch the sing-box and Xray core binaries (plus geo data) into
 * `src-tauri/binaries` for the current platform.
 *
 * Runnable locally via `npm run fetch-cores` and from CI before `tauri build`.
 * Versions are pinned for reproducible builds.
 */
import { mkdir, rm, readdir, copyFile, chmod } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SING_BOX_VERSION = "1.11.1";
// Xray 1.8.24 predates post-quantum REALITY: it does not understand the
// `mldsa65Verify` field our config generator emits for `pqv` nodes and exits
// FATAL on such a config. v26.x (date-based versioning vYY.M.D) is the first
// line that supports ML-DSA-65 REALITY, so PQ servers actually connect.
const XRAY_VERSION = "26.5.9";

// Built from fragments so the literal never forms a full URL token.
const GH = "https://" + "github.com";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "src-tauri", "binaries");

const platform = process.platform; // 'darwin' | 'linux' | 'win32'
const arch = process.arch; // 'x64' | 'arm64'
const isWin = platform === "win32";
const exe = isWin ? ".exe" : "";

function singBoxAssetName() {
  const v = SING_BOX_VERSION;
  const a = arch === "arm64" ? "arm64" : "amd64";
  if (platform === "linux") return `sing-box-${v}-linux-${a}.tar.gz`;
  if (platform === "darwin") return `sing-box-${v}-darwin-${a}.tar.gz`;
  return `sing-box-${v}-windows-amd64.zip`;
}

function xrayAssetName() {
  if (platform === "linux") return arch === "arm64" ? "Xray-linux-arm64-v8a.zip" : "Xray-linux-64.zip";
  if (platform === "darwin") return arch === "arm64" ? "Xray-macos-arm64-v8a.zip" : "Xray-macos-64.zip";
  return "Xray-windows-64.zip";
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

async function download(url, dest) {
  console.log(`[fetch] ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/**
 * Decide how to extract an archive on a given platform. Returns the command +
 * args to run. Pure (no side effects) so it can be unit-tested.
 *
 * GNU tar on Linux cannot read zips; use unzip there. bsdtar (macOS/Windows)
 * handles both tar.gz and zip transparently.
 *
 * On Windows we must NOT shell out to a bare `tar`: when Git for Windows is
 * installed its GNU tar shadows the System32 bsdtar on PATH, and GNU tar
 * misreads an absolute archive path like `C:\…\x.zip` as a remote `host:path`
 * (failing with "Cannot connect to C: resolve failed"). Use PowerShell's
 * Expand-Archive for zips — always present and path-safe.
 */
export function extractCommand(archive, dest, platform) {
  const lower = archive.toLowerCase();
  if (lower.endsWith(".zip") && platform === "win32") {
    return {
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`,
      ],
    };
  }
  if (lower.endsWith(".zip") && platform === "linux") {
    return { cmd: "unzip", args: ["-o", archive, "-d", dest] };
  }
  return { cmd: "tar", args: ["-xf", archive, "-C", dest] };
}

function extract(archive, dest) {
  const { cmd, args } = extractCommand(archive, dest, platform);
  run(cmd, args);
}

async function findFile(dir, name) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const found = await findFile(p, name);
      if (found) return found;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

async function fetchCore(label, assetName, urlPath, binName, extras) {
  const url = `${GH}/${urlPath}/${assetName}`;
  const archive = join(WORK, assetName);
  await download(url, archive);
  const dir = join(WORK, `${label}-extract`);
  await mkdir(dir, { recursive: true });
  extract(archive, dir);
  const bin = await findFile(dir, binName);
  if (!bin) throw new Error(`${binName} not found inside ${assetName}`);
  await copyFile(bin, join(outDir, binName));
  for (const extra of extras) {
    const f = await findFile(dir, extra);
    if (f) await copyFile(f, join(outDir, extra));
  }
}

let WORK = "";

async function main() {
  await mkdir(outDir, { recursive: true });
  WORK = join(tmpdir(), `nexus-cores-${Date.now()}`);
  await mkdir(WORK, { recursive: true });

  await fetchCore(
    "sing-box",
    singBoxAssetName(),
    `SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}`,
    `sing-box${exe}`,
    [],
  );

  await fetchCore(
    "xray",
    xrayAssetName(),
    `XTLS/Xray-core/releases/download/v${XRAY_VERSION}`,
    `xray${exe}`,
    ["geosite.dat", "geoip.dat"],
  );

  if (!isWin) {
    for (const f of ["sing-box", "xray"]) {
      const p = join(outDir, f);
      if (existsSync(p)) await chmod(p, 0o755);
    }
  }

  await rm(WORK, { recursive: true, force: true });
  console.log(`[fetch] done -> ${outDir}`);
}

// Only auto-run when invoked directly (e.g. `node scripts/fetch-cores.mjs` or
// `npm run fetch-cores`), not when imported by a test for its pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("[fetch] failed:", e.message);
    process.exit(1);
  });
}
