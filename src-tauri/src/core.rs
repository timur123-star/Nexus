//! Proxy-core process supervisor (sing-box / xray).
//!
//! The frontend hands us a complete config JSON; we write it to disk, locate
//! the requested core binary, spawn it, and stream its stdout/stderr back to
//! the UI as `core://log` events. Status transitions are emitted on
//! `core://status`.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CoreStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Default)]
pub struct CoreManager {
    child: Option<Child>,
    status: CoreStatus,
}

impl Default for CoreStatus {
    fn default() -> Self {
        CoreStatus::Stopped
    }
}

pub struct AppState {
    pub core: Mutex<CoreManager>,
    /// Previous (instant, totalUp, totalDown) reading for traffic-rate deltas.
    pub traffic_prev: Mutex<Option<(std::time::Instant, u64, u64)>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            core: Mutex::new(CoreManager::default()),
            traffic_prev: Mutex::new(None),
        }
    }
}

impl CoreManager {
    pub fn status(&self) -> CoreStatus {
        self.status
    }

    /// Write the config and (re)start the requested core ("sing-box" | "xray").
    pub fn start(&mut self, app: &AppHandle, config_json: &str, core_kind: &str) -> Result<(), String> {
        // Restart semantics: kill any existing instance first.
        self.stop_inner();

        let config_path = config_path(app)?;
        std::fs::write(&config_path, config_json)
            .map_err(|e| format!("write config: {e}"))?;

        let bin = locate_core(app, core_kind)?;

        self.set_status(app, CoreStatus::Starting);

        // Both sing-box and xray accept `run -c <file>`.
        let mut child = Command::new(&bin)
            .arg("run")
            .arg("-c")
            .arg(&config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", bin.display()))?;

        // Stream stdout + stderr to the UI on background threads.
        if let Some(out) = child.stdout.take() {
            pipe_lines(app.clone(), out);
        }
        if let Some(err) = child.stderr.take() {
            pipe_lines(app.clone(), err);
        }

        self.child = Some(child);
        self.set_status(app, CoreStatus::Running);
        log::info!("{core_kind} started ({})", bin.display());
        Ok(())
    }

    pub fn stop(&mut self, app: &AppHandle) {
        self.stop_inner();
        self.set_status(app, CoreStatus::Stopped);
    }

    fn stop_inner(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn set_status(&mut self, app: &AppHandle, s: CoreStatus) {
        self.status = s;
        let _ = app.emit("core://status", s);
    }
}

fn pipe_lines<R: std::io::Read + Send + 'static>(app: AppHandle, reader: R) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            let _ = app.emit("core://log", line);
        }
    });
}

/// Where the running config is written.
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    Ok(dir.join("running-config.json"))
}

/// Resolve a core executable by base name ("sing-box" | "xray"). Search order:
///   1. bundled resource  <resources>/binaries/<name>[.exe]
///   2. next to our own exe
///   3. PATH (bare name)
fn locate_core(app: &AppHandle, core_kind: &str) -> Result<PathBuf, String> {
    let base = match core_kind {
        "xray" => "xray",
        _ => "sing-box",
    };
    let exe_name = if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    };

    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("binaries").join(&exe_name);
        if p.exists() {
            return Ok(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("binaries").join(&exe_name);
            if p.exists() {
                return Ok(p);
            }
            let p2 = dir.join(&exe_name);
            if p2.exists() {
                return Ok(p2);
            }
        }
    }

    // Fall back to PATH lookup.
    Ok(PathBuf::from(exe_name))
}
