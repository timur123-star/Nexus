//! NexusShield native backend (Tauri v2).

mod commands;
mod core;
mod killswitch;
mod ping;
mod privilege;
mod proc;
mod sysproxy;
mod tray;

use core::AppState;
use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            // Safety net: reset OS proxy on startup in case a previous session
            // crashed while system proxy was active, leaving the user stranded.
            let _ = sysproxy::set_system_proxy(false, 0);

            tray::build_tray(app.handle())?;

            // Deep links: register the `nexusshield://` scheme at runtime on the
            // desktop platforms that need it, then forward any opened URL to the
            // frontend, which parses it and imports the carried servers.
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let _ = handle.emit("deep-link://new", url.to_string());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide to tray instead of quitting when the user closes the window.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::core_start,
            commands::core_stop,
            commands::core_status,
            commands::ping_server,
            commands::fetch_subscription,
            commands::get_traffic,
            commands::get_connections,
            commands::set_system_proxy,
            commands::enable_kill_switch,
            commands::disable_kill_switch,
            commands::kill_switch_status,
            commands::is_elevated,
            commands::relaunch_as_admin,
            commands::validate_config,
            commands::open_logs_dir,
            commands::speed_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NexusShield");
}
