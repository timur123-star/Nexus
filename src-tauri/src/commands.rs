//! Tauri command surface invoked from the React frontend.

use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::core::{AppState, CoreStatus};

#[derive(Serialize, Default)]
pub struct TrafficStats {
    up: u64,
    down: u64,
    #[serde(rename = "totalUp")]
    total_up: u64,
    #[serde(rename = "totalDown")]
    total_down: u64,
}

#[derive(Serialize)]
pub struct ConnectionEntry {
    id: String,
    host: String,
    network: String,
    outbound: String,
    upload: u64,
    download: u64,
    start: i64,
}

#[tauri::command]
pub fn core_start(
    app: AppHandle,
    state: State<AppState>,
    config: String,
    core: Option<String>,
) -> Result<(), String> {
    // Validate JSON shape before handing off to the core for a clearer error.
    serde_json::from_str::<Value>(&config).map_err(|e| format!("invalid config JSON: {e}"))?;
    let mut mgr = state.core.lock().map_err(|_| "core lock poisoned")?;
    mgr.start(&app, &config, core.as_deref().unwrap_or("sing-box"))
}

#[tauri::command]
pub fn core_stop(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut core = state.core.lock().map_err(|_| "core lock poisoned")?;
    core.stop(&app);
    Ok(())
}

#[tauri::command]
pub fn core_status(state: State<AppState>) -> CoreStatus {
    state
        .core
        .lock()
        .map(|c| c.status())
        .unwrap_or(CoreStatus::Error)
}

#[tauri::command]
pub async fn ping_server(address: String, port: u16) -> i64 {
    // Run the blocking probe off the async runtime.
    tokio::task::spawn_blocking(move || crate::ping::tcp_ping(&address, port, 2500))
        .await
        .unwrap_or(-1)
}

#[tauri::command]
pub async fn fetch_subscription(url: String, allow_insecure: Option<bool>) -> Result<String, String> {
    // Security: only allow http(s) schemes to prevent SSRF via file:// etc.
    let lower = url.to_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("only http:// and https:// URLs are allowed".into());
    }

    // TLS certificate validation is enabled by default. Users can opt into
    // skipping it for providers with self-signed certs via a per-subscription
    // toggle in the UI. This is safer than the old blanket disable.
    let skip_tls = allow_insecure.unwrap_or(false);
    let client = reqwest::Client::builder()
        .user_agent("NexusShield/0.1 (sing-box)")
        .timeout(std::time::Duration::from_secs(20))
        .danger_accept_invalid_certs(skip_tls)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_traffic(
    state: State<'_, AppState>,
    port: u16,
    secret: String,
) -> Result<TrafficStats, String> {
    let url = format!("http://127.0.0.1:{port}/connections");
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if !secret.is_empty() {
        req = req.bearer_auth(&secret);
    }
    let body: Value = match req.send().await {
        Ok(r) => r.json().await.map_err(|e| e.to_string())?,
        Err(_) => return Ok(TrafficStats::default()), // core not up yet
    };

    let total_up = body["uploadTotal"].as_u64().unwrap_or(0);
    let total_down = body["downloadTotal"].as_u64().unwrap_or(0);

    // Derive instantaneous rate from the delta since the previous poll.
    let mut stats = TrafficStats {
        total_up,
        total_down,
        ..Default::default()
    };
    if let Ok(mut prev) = state.traffic_prev.lock() {
        if let Some((t, pu, pd)) = *prev {
            let secs = t.elapsed().as_secs_f64().max(0.001);
            stats.up = (((total_up.saturating_sub(pu)) as f64) / secs) as u64;
            stats.down = (((total_down.saturating_sub(pd)) as f64) / secs) as u64;
        }
        *prev = Some((Instant::now(), total_up, total_down));
    }
    Ok(stats)
}

#[tauri::command]
pub async fn get_connections(port: u16, secret: String) -> Result<Vec<ConnectionEntry>, String> {
    let url = format!("http://127.0.0.1:{port}/connections");
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if !secret.is_empty() {
        req = req.bearer_auth(&secret);
    }
    let body: Value = match req.send().await {
        Ok(r) => r.json().await.map_err(|e| e.to_string())?,
        Err(_) => return Ok(vec![]),
    };

    let mut out = vec![];
    if let Some(conns) = body["connections"].as_array() {
        for c in conns {
            let meta = &c["metadata"];
            out.push(ConnectionEntry {
                id: c["id"].as_str().unwrap_or("").to_string(),
                host: format!(
                    "{}:{}",
                    meta["host"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| meta["destinationIP"].as_str().unwrap_or("?")),
                    meta["destinationPort"].as_str().unwrap_or("")
                ),
                network: meta["network"].as_str().unwrap_or("").to_string(),
                outbound: c["chains"]
                    .as_array()
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                upload: c["upload"].as_u64().unwrap_or(0),
                download: c["download"].as_u64().unwrap_or(0),
                start: 0,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn set_system_proxy(enable: bool, port: u16) -> Result<(), String> {
    crate::sysproxy::set_system_proxy(enable, port)
}

#[tauri::command]
pub fn is_elevated() -> bool {
    crate::privilege::is_elevated()
}

#[tauri::command]
pub fn relaunch_as_admin(app: AppHandle) -> Result<(), String> {
    crate::privilege::relaunch_as_admin(&app)
}

#[tauri::command]
pub fn validate_config(config: String) -> Value {
    match serde_json::from_str::<Value>(&config) {
        Ok(v) => {
            let has_outbounds = v.get("outbounds").and_then(|o| o.as_array()).is_some();
            if has_outbounds {
                serde_json::json!({ "ok": true })
            } else {
                serde_json::json!({ "ok": false, "error": "missing 'outbounds' array" })
            }
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn open_logs_dir(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).ok();
    open_path(&dir);
    Ok(())
}

#[cfg(windows)]
fn open_path(path: &std::path::Path) {
    let _ = std::process::Command::new("explorer").arg(path).spawn();
}

#[cfg(not(windows))]
fn open_path(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    let _ = std::process::Command::new(opener).arg(path).spawn();
}
