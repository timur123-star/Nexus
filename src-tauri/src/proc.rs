//! Small process-spawning helpers.
//!
//! Every helper command we shell out to on Windows (netsh, net, powershell,
//! reg, the proxy core itself, …) is a *console-subsystem* program. Spawning one
//! normally pops a black console window on screen for a split second — users
//! reported these "flashing consoles" whenever the kill-switch armed, the app
//! checked for elevation, or the core (re)started.
//!
//! `CREATE_NO_WINDOW` tells Windows to run the child without allocating a
//! console, which suppresses the flash entirely. This module centralises that
//! flag so no spawn site can forget it.

use std::process::Command;

/// Windows flag: create the process without a console window.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply the no-console-window creation flag on Windows. No-op elsewhere.
#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

/// No-op on non-Windows platforms (no console-window concept).
#[cfg(not(windows))]
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    cmd
}

/// Construct a `Command` that already has the no-window flag applied. Prefer
/// this over `Command::new` for any auxiliary process we launch ourselves.
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}
