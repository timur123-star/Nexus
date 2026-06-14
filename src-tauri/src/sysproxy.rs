//! System proxy toggling.
//!
//! - Windows: native via the registry (HKCU Internet Settings) + WinINet notify.
//! - macOS: `networksetup` across every network service.
//! - Linux (GNOME/GTK): `gsettings` org.gnome.system.proxy.
//!
//! TUN mode is the most robust cross-platform path; system proxy is offered as
//! a lighter alternative for apps that honor it.

#[cfg(windows)]
pub fn set_system_proxy(enable: bool, port: u16) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    let (key, _) = hkcu
        .create_subkey(path)
        .map_err(|e| format!("open Internet Settings: {e}"))?;

    if enable {
        let server = format!("127.0.0.1:{port}");
        key.set_value("ProxyEnable", &1u32)
            .map_err(|e| format!("set ProxyEnable: {e}"))?;
        key.set_value("ProxyServer", &server)
            .map_err(|e| format!("set ProxyServer: {e}"))?;
        // Bypass local + intranet addresses.
        key.set_value(
            "ProxyOverride",
            &"localhost;127.*;10.*;172.16.*;192.168.*;<local>",
        )
        .map_err(|e| format!("set ProxyOverride: {e}"))?;
    } else {
        key.set_value("ProxyEnable", &0u32)
            .map_err(|e| format!("clear ProxyEnable: {e}"))?;
    }

    notify_wininet();
    Ok(())
}

/// Tell WinINet that the proxy settings changed so running apps pick it up
/// without a reboot.
#[cfg(windows)]
fn notify_wininet() {
    // Best-effort; ignore failures. Uses raw FFI to avoid a heavy windows crate.
    #[link(name = "wininet")]
    extern "system" {
        fn InternetSetOptionW(
            h: *mut std::ffi::c_void,
            opt: u32,
            buf: *mut std::ffi::c_void,
            len: u32,
        ) -> i32;
    }
    const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;
    const INTERNET_OPTION_REFRESH: u32 = 37;
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }
}

// \u2500\u2500 macOS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
#[cfg(target_os = "macos")]
pub fn set_system_proxy(enable: bool, port: u16) -> Result<(), String> {
    let services = macos_network_services()?;
    let host = "127.0.0.1";
    let port_s = port.to_string();
    for svc in &services {
        let svc = svc.as_str();
        if enable {
            run(
                "networksetup",
                &["-setwebproxy", svc, host, port_s.as_str()],
            )?;
            run(
                "networksetup",
                &["-setsecurewebproxy", svc, host, port_s.as_str()],
            )?;
            run(
                "networksetup",
                &["-setsocksfirewallproxy", svc, host, port_s.as_str()],
            )?;
            run("networksetup", &["-setwebproxystate", svc, "on"])?;
            run("networksetup", &["-setsecurewebproxystate", svc, "on"])?;
            run("networksetup", &["-setsocksfirewallproxystate", svc, "on"])?;
        } else {
            run("networksetup", &["-setwebproxystate", svc, "off"]).ok();
            run("networksetup", &["-setsecurewebproxystate", svc, "off"]).ok();
            run("networksetup", &["-setsocksfirewallproxystate", svc, "off"]).ok();
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_network_services() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .map_err(|e| format!("networksetup: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .skip(1) // first line is an informational header
        .filter(|l| !l.is_empty())
        .map(|l| l.trim_start_matches('*').trim().to_string())
        .collect())
}

// \u2500\u2500 Linux (GNOME/GTK) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
#[cfg(all(unix, not(target_os = "macos")))]
pub fn set_system_proxy(enable: bool, port: u16) -> Result<(), String> {
    let schema = "org.gnome.system.proxy";
    if enable {
        let p = port.to_string();
        gsettings(&[schema, "mode", "manual"])?;
        for proto in ["http", "https", "socks"] {
            let key = format!("{schema}.{proto}");
            gsettings(&[key.as_str(), "host", "127.0.0.1"])?;
            gsettings(&[key.as_str(), "port", p.as_str()])?;
        }
        gsettings(&[
            schema,
            "ignore-hosts",
            "['localhost', '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1']",
        ])?;
    } else {
        gsettings(&[schema, "mode", "none"])?;
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn gsettings(args: &[&str]) -> Result<(), String> {
    let mut full: Vec<&str> = vec!["set"];
    full.extend_from_slice(args);
    run("gsettings", &full)
}

// Shared command runner for the unix backends.
#[cfg(not(windows))]
fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let status = std::process::Command::new(cmd)
        .args(args)
        .status()
        .map_err(|e| format!("{cmd}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{cmd} exited with {status}"))
    }
}
