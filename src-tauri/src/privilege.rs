//! Privilege detection + elevation relaunch.
//!
//! TUN mode requires elevated privileges (admin on Windows, root on
//! macOS/Linux). We detect the current level and, on request, relaunch the app
//! elevated and exit the unprivileged instance.

use tauri::AppHandle;

/// Whether the current process already has the privileges needed for TUN.
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        // `net session` succeeds only with administrative rights.
        std::process::Command::new("net")
            .arg("session")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim() == "0")
            .unwrap_or(false)
    }
}

/// Relaunch the application with elevated privileges, then exit this instance.
pub fn relaunch_as_admin(app: &AppHandle) -> Result<(), String> {
    if is_elevated() {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let exe_str = exe.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        // UAC prompt via PowerShell Start-Process -Verb RunAs.
        let escaped = exe_str.replace('\'', "''");
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{escaped}' -Verb RunAs"),
            ])
            .spawn()
            .map_err(|e| format!("elevate via powershell: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        // Graphical sudo prompt via AppleScript.
        let script = format!(
            "do shell script \"'{exe_str}' >/dev/null 2>&1 &\" with administrator privileges"
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("elevate via osascript: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // PolicyKit graphical prompt.
        std::process::Command::new("pkexec")
            .arg(&exe_str)
            .spawn()
            .map_err(|e| format!("elevate via pkexec: {e}"))?;
    }

    // Give the elevated instance a moment to come up, then quit this one.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        handle.exit(0);
    });
    Ok(())
}
