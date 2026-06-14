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
pub async fn fetch_subscription(
    url: String,
    allow_insecure: Option<bool>,
    user_agent: Option<String>,
) -> Result<String, String> {
    // Security: only allow http(s) schemes to prevent SSRF via file:// etc.
    let lower = url.to_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("only http:// and https:// URLs are allowed".into());
    }

    // Many subscription panels (Hiddify, Marzban, etc.) return different content
    // — or a 404 — depending on the client User-Agent. Default to a widely
    // accepted client string; let the UI override it per-subscription.
    let ua = user_agent
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Hiddify/4.1.1".to_string());

    // TLS certificate validation is enabled by default. Users can opt into
    // skipping it for providers with self-signed certs via a per-subscription
    // toggle in the UI. This is safer than the old blanket disable.
    let skip_tls = allow_insecure.unwrap_or(false);
    let client = reqwest::Client::builder()
        .user_agent(ua)
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

/// Body + provider metadata for a subscription fetch. `userinfo` is the raw
/// `Subscription-Userinfo` header value (e.g. `upload=…; download=…; total=…;
/// expire=…`) when the provider advertises one, parsed on the frontend.
#[derive(Serialize, Default)]
pub struct SubscriptionPayload {
    body: String,
    #[serde(rename = "userinfo")]
    userinfo: String,
    #[serde(rename = "profileTitle")]
    profile_title: String,
}

/// Like `fetch_subscription`, but also returns the `Subscription-Userinfo` and
/// `Profile-Title` headers so the UI can show traffic usage / expiry without a
/// second request. Falls back to an empty `userinfo` when absent.
#[tauri::command]
pub async fn fetch_subscription_info(
    url: String,
    allow_insecure: Option<bool>,
    user_agent: Option<String>,
) -> Result<SubscriptionPayload, String> {
    let lower = url.to_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("only http:// and https:// URLs are allowed".into());
    }
    let ua = user_agent
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Hiddify/4.1.1".to_string());
    let skip_tls = allow_insecure.unwrap_or(false);
    let client = reqwest::Client::builder()
        .user_agent(ua)
        .timeout(std::time::Duration::from_secs(20))
        .danger_accept_invalid_certs(skip_tls)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let userinfo = resp
        .headers()
        .get("subscription-userinfo")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // Some panels base64-encode the profile title (`Profile-Title: base64:…`).
    let profile_title = resp
        .headers()
        .get("profile-title")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(SubscriptionPayload {
        body,
        userinfo,
        profile_title,
    })
}

/// Enroll a freshly-generated WireGuard public key with Cloudflare's public
/// WARP client API and return the raw JSON registration response. The X25519
/// key pair itself is generated on the frontend (Web-crypto-grade), and the
/// frontend turns the response into a `wireguard://` link — this command only
/// performs the cross-origin HTTPS POST the webview cannot make directly.
///
/// No external binary is required: WARP is just a managed WireGuard config.
#[tauri::command]
pub async fn warp_register(public_key: String) -> Result<String, String> {
    if public_key.trim().is_empty() {
        return Err("missing WARP public key".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({
        "key": public_key.trim(),
        "install_id": "",
        "fcm_token": "",
        "tos": "2024-01-01T00:00:00.000Z",
        "model": "PC",
        "type": "Android",
        "locale": "en_US",
    });
    let resp = client
        .post("https://api.cloudflareclient.com/v0a2158/reg")
        .header("User-Agent", "okhttp/3.12.1")
        .header("CF-Client-Version", "a-6.10-2158")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("WARP registration request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("WARP registration HTTP {}", resp.status()));
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

/// Arm the OS-level kill-switch. `serverHosts` are the active server's
/// hostname(s)/IP(s) that must stay reachable so the core can keep/restore the
/// tunnel; everything else outbound is dropped. Requires elevated privileges.
#[tauri::command]
pub fn enable_kill_switch(
    state: State<AppState>,
    server_hosts: Vec<String>,
) -> Result<(), String> {
    if !crate::privilege::is_elevated() {
        return Err("kill-switch requires administrator privileges".into());
    }
    crate::killswitch::enable(&server_hosts)?;
    if let Ok(mut ks) = state.kill_switch.lock() {
        *ks = true;
    }
    Ok(())
}

/// Disarm the kill-switch and restore normal networking. Safe to call even if
/// it was never armed.
#[tauri::command]
pub fn disable_kill_switch(state: State<AppState>) -> Result<(), String> {
    let res = crate::killswitch::disable();
    if let Ok(mut ks) = state.kill_switch.lock() {
        *ks = false;
    }
    res
}

#[tauri::command]
pub fn kill_switch_status(state: State<AppState>) -> bool {
    state.kill_switch.lock().map(|k| *k).unwrap_or(false)
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
    let _ = crate::proc::silent_command("explorer").arg(path).spawn();
}

#[cfg(not(windows))]
fn open_path(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    let _ = std::process::Command::new(opener).arg(path).spawn();
}

/// Result of a real download/upload/latency speed test run through the active
/// local proxy. All values are 0 on a failed run.
#[derive(Serialize, Default)]
pub struct SpeedTestResult {
    #[serde(rename = "downMbps")]
    down_mbps: f64,
    #[serde(rename = "upMbps")]
    up_mbps: f64,
    #[serde(rename = "latencyMs")]
    latency_ms: f64,
    #[serde(rename = "jitterMs")]
    jitter_ms: f64,
}

/// Build a reqwest client that tunnels through the local mixed proxy so the
/// measurement reflects the *tunneled* throughput, not the bare connection.
/// When `proxy_port` is 0 we measure the direct connection instead.
fn speedtest_client(proxy_port: u16) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("NexusShield/0.1 (speedtest)")
        .timeout(std::time::Duration::from_secs(30));
    if proxy_port != 0 {
        let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{proxy_port}"))
            .map_err(|e| e.to_string())?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| e.to_string())
}

/// Measure download throughput, upload throughput, latency and jitter through
/// the active proxy. Uses Cloudflare's open speed endpoints (no API key). The
/// frontend passes the live `mixedPort` so the test reflects the real tunnel.
#[tauri::command]
pub async fn speed_test(proxy_port: u16) -> Result<SpeedTestResult, String> {
    let client = speedtest_client(proxy_port)?;

    // ── Latency + jitter: several tiny requests, measure round-trip spread. ──
    let mut latencies: Vec<f64> = Vec::new();
    for _ in 0..5 {
        let t = Instant::now();
        let r = client
            .get("https://speed.cloudflare.com/__down?bytes=0")
            .send()
            .await;
        if let Ok(resp) = r {
            let _ = resp.bytes().await;
            latencies.push(t.elapsed().as_secs_f64() * 1000.0);
        }
    }
    let latency_ms = if latencies.is_empty() {
        0.0
    } else {
        latencies.iter().sum::<f64>() / latencies.len() as f64
    };
    // Jitter = mean absolute deviation of consecutive samples.
    let jitter_ms = if latencies.len() < 2 {
        0.0
    } else {
        let mut diffs = 0.0;
        for w in latencies.windows(2) {
            diffs += (w[1] - w[0]).abs();
        }
        diffs / (latencies.len() - 1) as f64
    };

    // ── Download: pull a fixed payload, measure wall-clock throughput. ──
    let down_bytes: u64 = 25_000_000; // 25 MB
    let mut down_mbps = 0.0;
    let t = Instant::now();
    if let Ok(resp) = client
        .get(format!("https://speed.cloudflare.com/__down?bytes={down_bytes}"))
        .send()
        .await
    {
        if let Ok(body) = resp.bytes().await {
            let secs = t.elapsed().as_secs_f64();
            if secs > 0.0 {
                down_mbps = (body.len() as f64 * 8.0) / (secs * 1_000_000.0);
            }
        }
    }

    // ── Upload: POST a payload and measure how fast it drains. ──
    let up_bytes: usize = 10_000_000; // 10 MB
    let mut up_mbps = 0.0;
    let payload = vec![0u8; up_bytes];
    let t = Instant::now();
    if let Ok(resp) = client
        .post("https://speed.cloudflare.com/__up")
        .body(payload)
        .send()
        .await
    {
        let _ = resp.bytes().await;
        let secs = t.elapsed().as_secs_f64();
        if secs > 0.0 {
            up_mbps = (up_bytes as f64 * 8.0) / (secs * 1_000_000.0);
        }
    }

    Ok(SpeedTestResult {
        down_mbps,
        up_mbps,
        latency_ms,
        jitter_ms,
    })
}
