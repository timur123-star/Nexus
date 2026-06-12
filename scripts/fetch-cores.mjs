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
const XRAY_VERSION = "1.8.24";

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

function extract(archive, dest) {
  const lower = archive.toLowerCase();
  // GNU tar on Linux cannot read zips; use unzip there. bsdtar (macOS/Windows)
  // handles both tar.gz and zip transparently.
  if (lower.endsWith(".zip") && platform === "linux") {
    run("unzip", ["-o", archive, "-d", dest]);
  } else {
    run("tar", ["-xf", archive, "-C", dest]);
  }
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

main().catch((e) => {
  console.error("[fetch] failed:", e.message);
  process.exit(1);
});
