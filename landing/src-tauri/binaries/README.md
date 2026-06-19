# Core binaries

NexusShield ships the proxy engines (**sing-box** and **xray-core**) as bundled
resources. Tauri copies everything matching `binaries/*` into the packaged app
(see `resources` in `src-tauri/tauri.conf.json`), and the Rust backend
(`src-tauri/src/core.rs`) launches the selected engine from this directory.

These binaries are **not committed to git** (they are large, platform-specific,
and have their own licenses). This `README.md` exists so the `binaries/*` glob
always matches at least one file — otherwise `tauri-build` fails with:

```
glob pattern binaries/* path not found or didn't match any files.
```

## What to put here

Download the cores for your target OS and drop the executables in this folder
before running `npm run tauri dev` or `npm run tauri build`:

| OS      | sing-box        | xray-core   |
| ------- | --------------- | ----------- |
| Windows | `sing-box.exe`  | `xray.exe`  |
| macOS   | `sing-box`      | `xray`      |
| Linux   | `sing-box`      | `xray`      |

Recommended versions (matching the configs this app generates):

- **sing-box** `1.11.1` — https://github.com/SagerNet/sing-box/releases
- **xray-core** `26.5.9` — https://github.com/XTLS/Xray-core/releases
  (v26.x is required for post-quantum REALITY / `mldsa65Verify`; 1.8.24 crashes on such configs)

> On macOS/Linux make the files executable: `chmod +x sing-box xray`

## CI note

The GitHub Actions workflow only runs `cargo check` / `npm test`, so it does not
need the real engines — this placeholder is enough to satisfy the resource glob.
The actual installer build (`npm run tauri build`) does require the real
binaries to be present in this directory.
