//! Proxy-core process supervisor (sing-box / xray).
//!
//! Responsibilities:
//!   * write the frontend-generated config to disk
//!   * locate + spawn the requested core binary
//!   * stream stdout/stderr to the UI (`core://log`) AND to a rotating log file
//!   * probe the Clash API until it actually answers before declaring `running`
//!   * watch the child process and report unexpected exits as `error`
//!
//! Status transitions are emitted on `core://status`. The frontend treats these
//! events as the source of truth for the live connection state.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// How long to wait for the Clash API to come up before declaring failure.
const READINESS_TIMEOUT: Duration = Duration::from_secs(10);
/// Liveness poll interval once the core is running.
const WATCH_INTERVAL: Duration = Duration::from_millis(700);
/// Rotate the core log once it grows past this size.
const LOG_ROTATE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CoreStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

impl Default for CoreStatus {
    fn default() -> Self {
        CoreStatus::Stopped
    }
}

pub struct CoreManager {
    /// Shared with the watcher thread so either side can reap the child.
    child: Arc<Mutex<Option<Child>>>,
    /// Bumped on every start/stop; lets a stale watcher detect that it no longer
    /// owns the active process and exit quietly without misreporting a crash.
    generation: Arc<AtomicU64>,
    status: CoreStatus,
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            status: CoreStatus::Stopped,
        }
    }
}

pub struct AppState {
    pub core: Mutex<CoreManager>,
    /// Previous (instant, totalUp, totalDown) reading for traffic-rate deltas.
    pub traffic_prev: Mutex<Option<(Instant, u64, u64)>>,
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
        // Tear down any existing instance and invalidate its watcher.
        self.stop_inner();

        let config_path = config_path(app)?;
        std::fs::write(&config_path, config_json).map_err(|e| format!("write config: {e}"))?;

        let bin = locate_core(app, core_kind)?;

        self.set_status(app, CoreStatus::Starting);

        let mut command = Command::new(&bin);
        command
            .arg("run")
            .arg("-c")
            .arg(&config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // On Windows, suppress the flashing console window that would otherwise
        // pop up every time we launch the (console-subsystem) core binary.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| {
                format!(
                    "spawn {}: {e} — поместите бинарь ядра в папку 'binaries' рядом с приложением",
                    bin.display()
                )
            })?;

        // Shared, line-buffered log file (best effort — None if it can't be opened).
        let log_file = open_log_file(app);

        if let Some(out) = child.stdout.take() {
            pipe_lines(app.clone(), out, log_file.clone());
        }
        if let Some(err) = child.stderr.take() {
            pipe_lines(app.clone(), err, log_file.clone());
        }

        // Claim a fresh generation and hand the child to the shared slot.
        let my_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.child.lock().map_err(|_| "child lock poisoned")? = Some(child);
        self.status = CoreStatus::Starting;

        let clash = parse_clash_endpoint(config_json);
        spawn_watcher(app.clone(), self.child.clone(), self.generation.clone(), my_gen, clash);

        log::info!("{core_kind} starting ({})", bin.display());
        Ok(())
    }

    pub fn stop(&mut self, app: &AppHandle) {
        self.stop_inner();
        self.set_status(app, CoreStatus::Stopped);
    }

    fn stop_inner(&mut self) {
        // Invalidate any running watcher first so the kill isn't reported as a crash.
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.status = CoreStatus::Stopped;
    }

    fn set_status(&mut self, app: &AppHandle, s: CoreStatus) {
        self.status = s;
        let _ = app.emit("core://status", s);
    }
}

/// Background supervisor for one spawned core instance: waits for readiness,
/// then watches for an unexpected exit. Exits quietly once superseded.
fn spawn_watcher(
    app: AppHandle,
    child: Arc<Mutex<Option<Child>>>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
    clash: Option<(u16, String)>,
) {
    std::thread::spawn(move || {
        let still_current = || generation.load(Ordering::SeqCst) == my_gen;

        // 1) Readiness: wait until the Clash API port accepts a connection.
        if let Some((port, _secret)) = clash {
            let addr: SocketAddr = ([127, 0, 0, 1], port).into();
            let deadline = Instant::now() + READINESS_TIMEOUT;
            loop {
                if !still_current() {
                    return;
                }
                if process_exited(&child) {
                    if still_current() {
                        emit_log(&app, "core exited before becoming ready");
                        emit_status(&app, CoreStatus::Error);
                    }
                    return;
                }
                if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
                    if still_current() {
                        emit_status(&app, CoreStatus::Running);
                    }
                    break;
                }
                if Instant::now() >= deadline {
                    if still_current() {
                        emit_log(&app, "core did not open its API within timeout");
                        emit_status(&app, CoreStatus::Error);
                        reap(&child);
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        } else {
            // No Clash API to probe — grace period to surface an immediate crash.
            std::thread::sleep(Duration::from_millis(600));
            if !still_current() {
                return;
            }
            if process_exited(&child) {
                emit_log(&app, "core exited immediately after start");
                emit_status(&app, CoreStatus::Error);
                return;
            }
            emit_status(&app, CoreStatus::Running);
        }

        // 2) Liveness: watch for an unexpected exit.
        loop {
            std::thread::sleep(WATCH_INTERVAL);
            if !still_current() {
                return;
            }
            if process_exited(&child) {
                if still_current() {
                    emit_log(&app, "core process exited unexpectedly");
                    emit_status(&app, CoreStatus::Error);
                }
                return;
            }
        }
    });
}

/// Non-blocking check whether the shared child has terminated (or is gone).
fn process_exited(child: &Arc<Mutex<Option<Child>>>) -> bool {
    let mut slot = match child.lock() {
        Ok(s) => s,
        Err(_) => return true,
    };
    match slot.as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(Some(_)) | Err(_)),
        None => true,
    }
}

fn reap(child: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut slot) = child.lock() {
        if let Some(mut c) = slot.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn emit_status(app: &AppHandle, s: CoreStatus) {
    let _ = app.emit("core://status", s);
}

fn emit_log(app: &AppHandle, line: &str) {
    let _ = app.emit("core://log", format!("[nexus] {line}"));
}

fn pipe_lines<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    reader: R,
    log_file: Option<Arc<Mutex<File>>>,
) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            if let Some(ref lf) = log_file {
                if let Ok(mut f) = lf.lock() {
                    let _ = writeln!(f, "{line}");
                }
            }
            let _ = app.emit("core://log", line);
        }
    });
}

/// Open (and rotate if oversized) the core log file. Best effort.
fn open_log_file(app: &AppHandle) -> Option<Arc<Mutex<File>>> {
    let dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("core.log");

    // Size-based rotation: keep a single .1 backup.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_ROTATE_BYTES {
            let backup = dir.join("core.log.1");
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(&path, &backup);
        }
    }

    let file = OpenOptions::new().create(true).append(true).open(&path).ok()?;
    Some(Arc::new(Mutex::new(file)))
}

/// Pull the Clash API port + secret out of a sing-box config so we can probe
/// readiness. Returns None if the config has no clash_api block.
fn parse_clash_endpoint(config_json: &str) -> Option<(u16, String)> {
    let v: Value = serde_json::from_str(config_json).ok()?;
    let api = v.get("experimental")?.get("clash_api")?;
    let ctrl = api.get("external_controller")?.as_str()?;
    let port = ctrl.rsplit(':').next()?.parse::<u16>().ok()?;
    let secret = api
        .get("secret")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    Some((port, secret))
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
