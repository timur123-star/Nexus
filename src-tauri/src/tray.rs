//! System tray icon + menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use crate::core::AppState;

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Показать NexusShield", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Подключить / Отключить", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &toggle, &sep, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("NexusShield")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "toggle" => {
                let _ = app.emit("tray://toggle", ());
            }
            "quit" => graceful_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Graceful quit: stop the proxy core, reset system proxy, then exit.
/// Prevents zombie core processes and dangling OS proxy settings.
fn graceful_quit(app: &AppHandle) {
    // Stop the core process if running.
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut core) = state.core.lock() {
            core.stop(app);
        }
    }
    // Best-effort reset of OS proxy settings (use common ports).
    let _ = crate::sysproxy::set_system_proxy(false, 0);
    app.exit(0);
}
