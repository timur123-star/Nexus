//! System proxy toggling. Windows-native via the registry; other platforms are
//! stubbed (sing-box TUN mode is the cross-platform path there).

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
        key.set_value("ProxyOverride", &"localhost;127.*;10.*;172.16.*;192.168.*;<local>")
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
        InternetSetOptionW(std::ptr::null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, std::ptr::null_mut(), 0);
        InternetSetOptionW(std::ptr::null_mut(), INTERNET_OPTION_REFRESH, std::ptr::null_mut(), 0);
    }
}

#[cfg(not(windows))]
pub fn set_system_proxy(_enable: bool, _port: u16) -> Result<(), String> {
    // TODO: gsettings (GNOME) / networksetup (macOS). TUN mode is preferred here.
    Ok(())
}
