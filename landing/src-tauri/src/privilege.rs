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
        crate::proc::silent_command("net")
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

/// Build the `do shell script "…" with administrator privileges` AppleScript
/// that relaunches `exe_path` as root, escaping it for the two nested quoting
/// contexts it passes through (POSIX shell single-quotes, then an AppleScript
/// double-quoted string literal). Kept as a pure, cross-platform-testable
/// function so the escaping can be verified without a mac.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_elevate_script(exe_path: &str) -> String {
    let shell_token = format!("'{}'", exe_path.replace('\'', "'\\''"));
    let shell_cmd = format!("{shell_token} >/dev/null 2>&1 &");
    let as_literal = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
    format!("do shell script \"{as_literal}\" with administrator privileges")
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
        crate::proc::silent_command("powershell")
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
        // Graphical sudo prompt via AppleScript. The executable path is attacker-
        // influenced (a user could install under a directory containing a quote),
        // and it ends up inside BOTH a POSIX-shell single-quoted token AND an
        // AppleScript double-quoted string literal — each of which must be escaped
        // independently or the command runs as root with injected content.
        //   1. shell single-quote escaping:  '  ->  '\''
        //   2. AppleScript string escaping:   \  -> \\   and   "  -> \"
        let script = macos_elevate_script(&exe_str);
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

#[cfg(test)]
mod tests {
    use super::macos_elevate_script;

    #[test]
    fn plain_path_is_wrapped_in_quotes() {
        let s = macos_elevate_script("/Applications/NexusShield.app/Contents/MacOS/NexusShield");
        assert!(s.starts_with("do shell script \""));
        assert!(s.ends_with("\" with administrator privileges"));
        assert!(s.contains("'/Applications/NexusShield.app/Contents/MacOS/NexusShield'"));
    }

    #[test]
    fn single_quote_in_path_is_neutralised() {
        // A path containing a single quote must not be able to break out of the
        // shell single-quoted token (which would inject a command run as root).
        let s = macos_elevate_script("/Users/o'brien/App");
        // The dangerous raw sequence `'brien` (closing the quote then a bare word)
        // must NOT appear; it must be the escaped `'\''` form.
        assert!(s.contains("'/Users/o'\\\\''brien/App'"));
        assert!(!s.contains("; rm"));
    }

    #[test]
    fn double_quote_and_backslash_are_escaped_for_applescript() {
        let s = macos_elevate_script("/tmp/a\"b\\c");
        // Inside the AppleScript literal, a literal " becomes \" and \ becomes \\.
        assert!(s.contains("a\\\"b"));
        assert!(s.contains("b\\\\c"));
    }
}
