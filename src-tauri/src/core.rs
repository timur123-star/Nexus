//! Proxy-core process supervisor (sing-box / xray).
//!
//! Responsibilities:
//!   * write the frontend-generated config to disk
//!   * locate + spawn the requested core binary
//!   * stream stdout/stderr to the UI (`core://log`) AND to a rotating log file
//!   * translate raw core errors into friendly, actionable diagnostics
//!     (`core://notice`) so the UI never has to show a bare "error"
//!   * probe the Clash API until it actually answers before declaring `running`
//!   * watch the child process and, on an unexpected crash/hang, **auto-restart
//!     the core** a bounded number of times before giving up and reporting
//!     `error`
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

/// How many times the backend will silently respawn a crashed/hung core within
/// one logical session before surfacing a hard `error` to the user. The
/// frontend has its own (slower, failover-capable) reconnect on top of this;
/// this layer just smooths over transient core crashes without a UI blip.
const MAX_AUTO_RESTARTS: u32 = 3;
/// Once the core has stayed up at least this long, the restart budget is
/// replenished — a crash hours into a session shouldn't be counted against one
/// that happened at startup.
const RESTART_STABLE_AFTER: Duration = Duration::from_secs(45);
/// Small delay before respawning so we don't hot-loop on an instantly-dying core.
const RESTART_BACKOFF: Duration = Duration::from_millis(1200);

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

/// Everything needed to (re)spawn one core process. Cloned into the supervisor
/// thread so it can relaunch the core on its own after a crash.
#[derive(Clone)]
struct LaunchSpec {
    bin: PathBuf,
    config_path: PathBuf,
    /// (port, secret) of the Clash API, used for readiness probing. None when
    /// the config exposes no API.
    clash: Option<(u16, String)>,
    core_kind: String,
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
    /// Whether the OS-level kill-switch is currently armed.
    pub kill_switch: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            core: Mutex::new(CoreManager::default()),
            traffic_prev: Mutex::new(None),
            kill_switch: Mutex::new(false),
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

        let spec = LaunchSpec {
            bin,
            config_path,
            clash: parse_clash_endpoint(config_json),
            core_kind: core_kind.to_string(),
        };

        let child = spawn_process(app, &spec)?;

        // Claim a fresh generation and hand the child to the shared slot.
        let my_gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.child.lock().map_err(|_| "child lock poisoned")? = Some(child);
        self.status = CoreStatus::Starting;

        spawn_supervisor(app.clone(), self.child.clone(), self.generation.clone(), my_gen, spec);

        log::info!("{core_kind} starting");
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

/// Spawn the core process described by `spec` and wire its stdout/stderr to the
/// UI + the rotating log file. stderr additionally runs through the diagnostic
/// classifier so common failures surface as friendly notices.
fn spawn_process(app: &AppHandle, spec: &LaunchSpec) -> Result<Child, String> {
    let mut command = Command::new(&spec.bin);
    command
        .arg("run")
        .arg("-c")
        .arg(&spec.config_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On Windows, suppress the flashing console window that would otherwise pop
    // up every time we launch the (console-subsystem) core binary.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| {
        format!(
            "spawn {}: {e} — поместите бинарь ядра в папку 'binaries' рядом с приложением",
            spec.bin.display()
        )
    })?;

    // Shared, line-buffered log file (best effort — None if it can't be opened).
    let log_file = open_log_file(app);

    if let Some(out) = child.stdout.take() {
        pipe_lines(app.clone(), out, log_file.clone(), false);
    }
    if let Some(err) = child.stderr.take() {
        // stderr carries the failure detail — classify it for friendly notices.
        pipe_lines(app.clone(), err, log_file.clone(), true);
    }

    Ok(child)
}

/// Background supervisor for one logical core session: waits for readiness, then
/// watches for an unexpected exit and auto-restarts the core a bounded number of
/// times before giving up. Exits quietly once superseded by a newer generation.
fn spawn_supervisor(
    app: AppHandle,
    child: Arc<Mutex<Option<Child>>>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
    spec: LaunchSpec,
) {
    std::thread::spawn(move || {
        let still_current = || generation.load(Ordering::SeqCst) == my_gen;
        let mut restarts_left = MAX_AUTO_RESTARTS;

        loop {
            // 1) Readiness: wait until the core is actually serving.
            let started_at = Instant::now();
            if !wait_until_ready(&app, &child, &spec, &still_current) {
                // Either superseded, or readiness failed and was reported.
                return;
            }

            // 2) Liveness: block until the process exits or we're superseded.
            let exited = watch_until_exit(&child, &still_current);
            if !exited {
                return; // superseded — a newer start/stop owns things now.
            }
            if !still_current() {
                return;
            }

            // The core died on its own. Replenish the budget if it had been up
            // long enough to count as a healthy session.
            if started_at.elapsed() >= RESTART_STABLE_AFTER {
                restarts_left = MAX_AUTO_RESTARTS;
            }

            if restarts_left == 0 {
                emit_log(&app, "core crashed and auto-restart budget is exhausted");
                emit_notice(&app, "core_unrecoverable");
                emit_status(&app, CoreStatus::Error);
                return;
            }
            restarts_left -= 1;

            emit_log(
                &app,
                &format!(
                    "core exited unexpectedly — auto-restarting ({} attempt(s) left)",
                    restarts_left + 1
                ),
            );
            emit_notice(&app, "core_restarting");
            emit_status(&app, CoreStatus::Starting);
            std::thread::sleep(RESTART_BACKOFF);

            if !still_current() {
                return;
            }
            match spawn_process(&app, &spec) {
                Ok(new_child) => {
                    if let Ok(mut slot) = child.lock() {
                        *slot = Some(new_child);
                    }
                    // Loop back around to re-run readiness + liveness.
                }
                Err(e) => {
                    emit_log(&app, &format!("auto-restart failed: {e}"));
                    emit_status(&app, CoreStatus::Error);
                    return;
                }
            }
        }
    });
}

/// Wait until the (current) core is ready, emitting `Running` on success.
/// Returns false when readiness failed (already reported) or we were superseded.
fn wait_until_ready(
    app: &AppHandle,
    child: &Arc<Mutex<Option<Child>>>,
    spec: &LaunchSpec,
    still_current: &dyn Fn() -> bool,
) -> bool {
    if let Some((port, _secret)) = spec.clash {
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let deadline = Instant::now() + READINESS_TIMEOUT;
        loop {
            if !still_current() {
                return false;
            }
            if process_exited(child) {
                if still_current() {
                    emit_log(app, "core exited before becoming ready");
                    emit_notice(app, "core_failed_start");
                    emit_status(app, CoreStatus::Error);
                }
                return false;
            }
            if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
                if still_current() {
                    emit_status(app, CoreStatus::Running);
                }
                return true;
            }
            if Instant::now() >= deadline {
                if still_current() {
                    emit_log(app, "core did not open its API within timeout");
                    emit_notice(app, "core_timeout");
                    emit_status(app, CoreStatus::Error);
                    reap(child);
                }
                return false;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    // No Clash API to probe — short grace period to surface an immediate crash.
    std::thread::sleep(Duration::from_millis(600));
    if !still_current() {
        return false;
    }
    if process_exited(child) {
        emit_log(app, "core exited immediately after start");
        emit_notice(app, "core_failed_start");
        emit_status(app, CoreStatus::Error);
        return false;
    }
    emit_status(app, CoreStatus::Running);
    true
}

/// Block until the current child exits (returns true) or we're superseded
/// (returns false).
fn watch_until_exit(child: &Arc<Mutex<Option<Child>>>, still_current: &dyn Fn() -> bool) -> bool {
    loop {
        std::thread::sleep(WATCH_INTERVAL);
        if !still_current() {
            return false;
        }
        if process_exited(child) {
            return true;
        }
    }
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

/// Emit a stable diagnostic code the frontend localises into a friendly toast.
fn emit_notice(app: &AppHandle, code: &str) {
    let _ = app.emit("core://notice", code);
}

fn pipe_lines<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    reader: R,
    log_file: Option<Arc<Mutex<File>>>,
    classify: bool,
) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            if let Some(ref lf) = log_file {
                if let Ok(mut f) = lf.lock() {
                    let _ = writeln!(f, "{line}");
                }
            }
            // Translate known failure lines into a friendly notice + explanation.
            if classify {
                if let Some(code) = classify_core_error(&line) {
                    emit_notice(&app, code);
                    emit_log(&app, friendly_explanation(code));
                }
            }
            let _ = app.emit("core://log", line);
        }
    });
}

/// Map a raw core log line to a stable diagnostic code, or None if it isn't a
/// recognised failure. Matching is case-insensitive and deliberately broad so
/// it works across sing-box and xray wording.
fn classify_core_error(line: &str) -> Option<&'static str> {
    let l = line.to_lowercase();
    // Only inspect lines that look like a problem to avoid false positives.
    let looks_bad = l.contains("error")
        || l.contains("failed")
        || l.contains("fatal")
        || l.contains("panic")
        || l.contains("refused")
        || l.contains("timeout");
    if !looks_bad {
        return None;
    }

    if l.contains("address already in use") || (l.contains("bind") && l.contains("in use")) {
        Some("port_in_use")
    } else if l.contains("authentication")
        || l.contains("auth failed")
        || l.contains("unauthorized")
        || l.contains("invalid user")
        || l.contains("password")
    {
        Some("auth_failed")
    } else if l.contains("certificate")
        || l.contains("tls")
        || l.contains("handshake")
        || l.contains("x509")
    {
        Some("tls_error")
    } else if l.contains("no such host")
        || l.contains("lookup")
        || l.contains("dns")
        || l.contains("resolve")
    {
        Some("dns_error")
    } else if l.contains("connection refused")
        || l.contains("refused")
        || l.contains("unreachable")
        || l.contains("i/o timeout")
        || l.contains("timeout")
        || l.contains("reset by peer")
    {
        Some("server_unreachable")
    } else if l.contains("parse")
        || l.contains("decode")
        || l.contains("unmarshal")
        || l.contains("invalid config")
    {
        Some("config_invalid")
    } else if l.contains("permission denied") || l.contains("operation not permitted") {
        Some("need_admin")
    } else {
        None
    }
}

/// A short, human-readable English explanation for a diagnostic code, appended
/// to the log stream alongside the localized toast the frontend shows.
fn friendly_explanation(code: &str) -> &'static str {
    match code {
        "port_in_use" => "the local proxy port is already in use — change it in Settings",
        "auth_failed" => "the server rejected the credentials — re-import the config",
        "tls_error" => "TLS handshake failed — check SNI/host or the server certificate",
        "dns_error" => "could not resolve the server address — check the hostname/DNS",
        "server_unreachable" => "the server is unreachable — try another server",
        "config_invalid" => "the generated config was rejected — the profile may be malformed",
        "need_admin" => "missing privileges — TUN/kill-switch need administrator rights",
        "core_restarting" => "recovering the connection…",
        "core_failed_start" => "the core failed to start",
        "core_timeout" => "the core did not become ready in time",
        "core_unrecoverable" => "the core keeps crashing — pick another server",
        _ => "core reported a problem",
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clash_endpoint_with_secret() {
        let cfg = r#"{
            "experimental": { "clash_api": {
                "external_controller": "127.0.0.1:9090",
                "secret": "s3cr3t"
            }}
        }"#;
        assert_eq!(parse_clash_endpoint(cfg), Some((9090, "s3cr3t".to_string())));
    }

    #[test]
    fn parses_clash_endpoint_without_secret() {
        let cfg = r#"{"experimental":{"clash_api":{"external_controller":"0.0.0.0:7070"}}}"#;
        assert_eq!(parse_clash_endpoint(cfg), Some((7070, String::new())));
    }

    #[test]
    fn missing_clash_api_is_none() {
        assert_eq!(parse_clash_endpoint(r#"{"outbounds":[]}"#), None);
        assert_eq!(parse_clash_endpoint("not json"), None);
    }

    #[test]
    fn classifies_common_failures() {
        assert_eq!(
            classify_core_error("FATAL: bind: address already in use"),
            Some("port_in_use")
        );
        assert_eq!(
            classify_core_error("error: tls: handshake failure"),
            Some("tls_error")
        );
        assert_eq!(
            classify_core_error("failed: authentication rejected"),
            Some("auth_failed")
        );
        assert_eq!(
            classify_core_error("error: lookup example.com: no such host"),
            Some("dns_error")
        );
        assert_eq!(
            classify_core_error("dial tcp 1.2.3.4:443: connection refused"),
            Some("server_unreachable")
        );
        assert_eq!(
            classify_core_error("error: failed to parse config"),
            Some("config_invalid")
        );
    }

    #[test]
    fn ignores_benign_lines() {
        assert_eq!(classify_core_error("inbound/mixed: started at 127.0.0.1:2080"), None);
        assert_eq!(classify_core_error("router: loaded 12 rules"), None);
        assert_eq!(classify_core_error(""), None);
    }

    #[test]
    fn every_notice_code_has_an_explanation() {
        for code in [
            "port_in_use",
            "auth_failed",
            "tls_error",
            "dns_error",
            "server_unreachable",
            "config_invalid",
            "need_admin",
            "core_restarting",
            "core_failed_start",
            "core_timeout",
            "core_unrecoverable",
        ] {
            assert_ne!(friendly_explanation(code), "core reported a problem", "missing: {code}");
        }
    }
}
