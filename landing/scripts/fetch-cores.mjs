#!/usr/bin/env node
/**
 * Fetch the sing-box and Xray core binaries (plus geo data) into
 * `src-tauri/binaries` for the current platform.
 *
 * Runnable locally via `npm run fetch-cores` and from CI before `tauri build`.
 * Versions are pinned for reproducible builds.
 */
import { mkdir, rm, readdir, copyFile, chmod, readFile } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

const SING_BOX_VERSION = "1.11.1";
// Xray 1.8.24 predates post-quantum REALITY: it does not understand the
// `mldsa65Verify` field our config generator emits for `pqv` nodes and exits
// FATAL on such a config. v26.x (date-based versioning vYY.M.D) is the first
// line that supports ML-DSA-65 REALITY, so PQ servers actually connect.
const XRAY_VERSION = "26.5.9";

/**
 * Pinned SHA-256 of every core asset we download, keyed by asset file name.
 *
 * SUPPLY-CHAIN INTEGRITY: the cores are spawned with the app's (often elevated /
 * TUN) privileges, so a tampered binary is game-over. We refuse to bundle any
 * archive whose SHA-256 doesn't match a hash pinned here at the exact version
 * above. When bumping a version, regenerate these (sing-box has no published
 * checksum file; Xray ships `<asset>.dgst` with a `SHA2-256=` line).
 */
const SHA256 = {
  // sing-box 1.11.1
  "sing-box-1.11.1-linux-amd64.tar.gz":
    "a3e11848b6097448a74c771f70f31353777c1d85b04b3490bb1689233ef725b4",
  "sing-box-1.11.1-linux-arm64.tar.gz":
    "4f0bbcbf798d61827574e51fd6cedf97aa7c4d1eb5ec287aad00a42eeeb18720",
  "sing-box-1.11.1-darwin-amd64.tar.gz":
    "480151a415f344e893d04677483a99bdb8437014889e54faf85b0c01c2454580",
  "sing-box-1.11.1-darwin-arm64.tar.gz":
    "22840fd9d794326e9ab27308a39e8721d261478fc3624222651038a5b73f144d",
  "sing-box-1.11.1-windows-amd64.zip":
    "fa166f33a92a3de4e7b20308c534867ec422541bed9a38a8ac27fd98043a47c2",
  // Xray-core v26.5.9
  "Xray-linux-64.zip": "f56c106b7c0159ad386bccd340faa5bbf55fd5c15821ec9e63e6a6ba11d3d1c7",
  "Xray-linux-arm64-v8a.zip": "7bc1da606e26e4ac2d7831181745bb3bcf4dca0fd7825f41388ae032e1247d15",
  "Xray-macos-64.zip": "4a6b6d2586363afc34f17008406983008a428e1d75b75db3cb9c3bfce1244b38",
  "Xray-macos-arm64-v8a.zip": "452d68b0bc5a677e9520afb9df6e5bc08421f36ff37c9f923bda1f8fea9d0561",
  "Xray-windows-64.zip": "842887f85f2028677cb9bdd01eb63ddbccc646540c0f4a46e1a7f91e9a5d11f1",
};

// Built from fragments so the literal never forms a full URL token.
const GH = "https://" + "github.com";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "src-tauri", "binaries");

/**
 * Resolve the TARGET platform/arch we're fetching cores for. In CI we may build
 * for a different arch than the runner's (e.g. an arm64 macOS runner
 * cross-compiling the x86_64 build). Keying off the host `process.arch` there
 * would bundle the wrong-arch core into the app — which then can't launch the
 * engine. Honour an explicit `NEXUS_CORE_TARGET` Rust target triple (or
 * `--target <triple>`), falling back to the host.
 */
function targetTriple() {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  if (arg) return arg.slice("--target=".length);
  const idx = process.argv.indexOf("--target");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.NEXUS_CORE_TARGET || "";
}

const triple = targetTriple();
const platform = resolvePlatform(triple, process.platform); // 'darwin' | 'linux' | 'win32'
const arch = resolveArch(triple, process.arch); // 'x64' | 'arm64'
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
  if (platform === "linux")
    return arch === "arm64" ? "Xray-linux-arm64-v8a.zip" : "Xray-linux-64.zip";
  if (platform === "darwin")
    return arch === "arm64" ? "Xray-macos-arm64-v8a.zip" : "Xray-macos-64.zip";
  return "Xray-windows-64.zip";
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

async function download(url, dest, attempts = 3) {
  console.log(`[fetch] ${url}`);
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        const backoff = 800 * i;
        console.warn(`[fetch] attempt ${i} failed (${e.message}); retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

/** Compute the SHA-256 of a file as lowercase hex. */
async function sha256File(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify a downloaded archive against its pinned SHA-256. Throws (aborting the
 * build) on any mismatch or missing pin — we must never bundle an unverified
 * core binary that later runs with elevated/TUN privileges.
 */
async function verifyChecksum(assetName, path) {
  const expected = SHA256[assetName];
  if (!expected) {
    throw new Error(
      `no pinned SHA-256 for '${assetName}' — refusing to bundle an unverified core. ` +
        `Add its hash to SHA256 in scripts/fetch-cores.mjs.`,
    );
  }
  const actual = await sha256File(path);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `checksum MISMATCH for ${assetName}\n  expected ${expected}\n  actual   ${actual}\n` +
        `The download is corrupt or tampered with — aborting.`,
    );
  }
  console.log(`[verify] ${assetName} ✓ sha256 ok`);
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
export function resolvePlatform(triple, hostPlatform) {
  const t = (triple || "").toLowerCase();
  if (t.includes("apple-darwin") || t.includes("darwin")) return "darwin";
  if (t.includes("linux")) return "linux";
  if (t.includes("windows")) return "win32";
  return hostPlatform;
}

export function resolveArch(triple, hostArch) {
  const t = (triple || "").toLowerCase();
  if (t.includes("aarch64") || t.includes("arm64")) return "arm64";
  if (t.includes("x86_64") || t.includes("amd64") || t.includes("x64")) return "x64";
  return hostArch;
}

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
  await verifyChecksum(assetName, archive);
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
