//! OS-level kill-switch (leak protection).
//!
//! When armed it installs a firewall policy that DROPS all outbound traffic
//! except:
//!   * loopback,
//!   * the connection(s) to the active VPN server's IP(s) — so the core can
//!     keep the tunnel alive / reconnect,
//!   * the tunnel interface(s) — so already-tunnelled traffic leaves normally,
//!   * (Windows) the core executable itself.
//!
//! so that if the tunnel collapses the user's real traffic is blocked instead
//! of leaking onto the open internet. Fully reversible via [`disable`].
//!
//! Requires elevated privileges (same as TUN). The rules are tagged with a
//! dedicated marker so [`disable`] can always find and remove exactly what we
//! added without disturbing the user's own firewall configuration. Critically:
//! arming is *verified* — if the default-deny policy can't be applied, or if it
//! applied but no allow-path survived (which would strand the user with no
//! internet AND no way for the core to reach the server), [`enable`] rolls back
//! and returns an error instead of silently reporting success.

use std::net::ToSocketAddrs;

/// Marker baked into every rule/anchor/chain we create, so teardown is precise.
const TAG: &str = "NexusShieldKillSwitch";

/// Resolve a host (hostname or literal IP) to its de-duplicated IP addresses.
/// The VPN server endpoint may be a hostname; we must allow each resolved IP.
fn resolve_ips(host: &str) -> Vec<String> {
    // Port is irrelevant for address resolution; use a placeholder.
    let mut ips: Vec<String> = match (host, 0u16).to_socket_addrs() {
        Ok(iter) => iter.map(|s| s.ip().to_string()).collect(),
        Err(_) => Vec::new(),
    };
    ips.sort();
    ips.dedup();
    ips
}

/// Validate that a string is a bare IPv4/IPv6 literal before we ever paste it
/// into a firewall command line. Defends against command injection via a
/// malicious "server address".
fn is_ip_literal(s: &str) -> bool {
    s.parse::<std::net::IpAddr>().is_ok()
}

/// A valid netsh outbound/inbound action token (the two halves of a
/// "<inbound>,<outbound>" firewall policy).
fn is_policy_token(t: &str) -> bool {
    matches!(
        t.to_ascii_lowercase().as_str(),
        "blockinbound" | "allowinbound" | "blockinboundalways" | "blockoutbound" | "allowoutbound"
    )
}

/// Parse the firewall policy value (e.g. "BlockInbound,AllowOutbound") out of the
/// text of `netsh advfirewall show <profile>`.
///
/// IMPORTANT: the label is the TWO words "Firewall Policy" — a naive split on the
/// first whitespace captures "Policy" as part of the value and corrupts the
/// snapshot (which then makes the restore on disarm fail and strand the user
/// offline). We strip the full 15-char ASCII label and validate that the result
/// is genuinely "<inboundToken>,<outboundToken>". Returns None on a localized or
/// unexpected layout, so the caller falls back to the OS default safely. Pure +
/// cross-platform so it's unit-tested without Windows.
fn parse_firewall_policy(show_output: &str) -> Option<String> {
    const LABEL: &str = "firewall policy";
    for line in show_output.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with(LABEL) {
            // The label is ASCII, so the byte offset matches the char count.
            let value = trimmed.get(LABEL.len()..)?.trim();
            // The value is a single space-free token "<In>,<Out>"; take it.
            let token = value.split_whitespace().next()?;
            let (inb, outb) = token.split_once(',')?;
            if is_policy_token(inb) && is_policy_token(outb) {
                return Some(token.to_string());
            }
        }
    }
    None
}

/// Arm the kill-switch, allowing the given server host(s)/IP(s) through.
#[allow(unused_variables)]
pub fn enable(server_hosts: &[String]) -> Result<(), String> {
    // Resolve every provided host to literal IPs and keep only valid literals.
    let mut allow: Vec<String> = Vec::new();
    for h in server_hosts {
        if is_ip_literal(h) {
            allow.push(h.clone());
        } else {
            allow.extend(resolve_ips(h).into_iter().filter(|ip| is_ip_literal(ip)));
        }
    }
    allow.sort();
    allow.dedup();

    enable_impl(&allow)
}

/// Disarm the kill-switch and restore normal networking.
pub fn disable() -> Result<(), String> {
    disable_impl()
}

// ── Windows ─────────────────────────────────────────────────────────────────
// The Windows backend flips the *default* outbound action to Block (the only
// way to get an allow-list, since explicit block rules would override our allow
// rules) and adds tagged allow rules. The prior per-profile policy is snapshotted
// to disk at arm time and restored at disarm, so a user with a non-default
// firewall posture isn't silently switched to allow-all-outbound on teardown.
#[cfg(windows)]
fn enable_impl(allow: &[String]) -> Result<(), String> {
    // Start from a clean slate so re-arming with a new server is idempotent —
    // but DON'T restore the saved policy here (we're about to re-block); just
    // remove our old allow rules.
    remove_allow_rules();

    // Snapshot the current per-profile policy before we change it, so disarm can
    // restore exactly what the user had. Only snapshot if we don't already have
    // one (re-arming shouldn't overwrite the original pre-arm state).
    if read_saved_policy().is_none() {
        if let Some(snap) = snapshot_policies() {
            save_policy(&snap);
        }
    }

    // Default-deny all outbound across every profile; loopback is implicitly
    // exempt on Windows. This is the one step that MUST succeed.
    netsh(&[
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,blockoutbound",
    ])
    .map_err(|e| format!("kill-switch: failed to apply default-deny policy: {e}"))?;

    // Count how many escape hatches we successfully installed. If we end up with
    // a default-deny policy but ZERO working allow paths, the machine is bricked
    // offline with no way for the core to even reach the server — roll back.
    let mut allow_paths = 0usize;

    // Allow the core executable itself to talk to the server.
    if let Some(core) = locate_any_core() {
        let prog = core.to_string_lossy().to_string();
        if netsh(&[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={TAG}-Core"),
            "dir=out",
            "action=allow",
            &format!("program={prog}"),
            "enable=yes",
        ])
        .is_ok()
        {
            allow_paths += 1;
        }
    }

    // Allow direct egress to each resolved server IP (covers cores that don't
    // resolve to a single program path, and the reconnect path).
    for ip in allow {
        if netsh(&[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={TAG}-Server"),
            "dir=out",
            "action=allow",
            &format!("remoteip={ip}"),
            "enable=yes",
        ])
        .is_ok()
        {
            allow_paths += 1;
        }
    }

    // Default-deny with ZERO surviving allow paths is NEVER a valid armed state:
    // it bricks the machine offline AND the core can't even reach the server to
    // build the tunnel. This includes the case where the server was given as a
    // hostname that failed to resolve (so `allow` is empty) and no core binary
    // was found. Roll back unconditionally and surface the failure rather than
    // reporting a success that leaves the user stranded.
    if allow_paths == 0 {
        let _ = disable_impl();
        return Err(
            "kill-switch: default-deny applied but no allow rule could be installed — rolled back to avoid bricking connectivity".into(),
        );
    }

    Ok(())
}

#[cfg(windows)]
fn disable_impl() -> Result<(), String> {
    remove_allow_rules();

    // Restore the user's pre-arm policy if we saved one; otherwise fall back to
    // the Windows default (block inbound / allow outbound).
    let result = if let Some(saved) = read_saved_policy() {
        let mut err: Option<String> = None;
        for (profile, policy) in saved {
            if let Err(e) = netsh(&["advfirewall", "set", &profile, "firewallpolicy", &policy]) {
                err = Some(e);
            }
        }
        match err {
            Some(e) => Err(format!("kill-switch: failed to restore prior policy: {e}")),
            None => Ok(()),
        }
    } else {
        netsh(&[
            "advfirewall",
            "set",
            "allprofiles",
            "firewallpolicy",
            "blockinbound,allowoutbound",
        ])
    };

    clear_saved_policy();
    result
}

#[cfg(windows)]
fn remove_allow_rules() {
    let _ = netsh(&[
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={TAG}-Core"),
    ]);
    let _ = netsh(&[
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={TAG}-Server"),
    ]);
}

#[cfg(windows)]
fn netsh(args: &[&str]) -> Result<(), String> {
    run("netsh", args)
}

/// Capture stdout of a `netsh` invocation (no console flash). None on failure.
#[cfg(windows)]
fn netsh_output(args: &[&str]) -> Option<String> {
    let out = crate::proc::silent_command("netsh")
        .args(args)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

/// The three Windows firewall profiles whose policy we snapshot/restore.
#[cfg(windows)]
const WIN_PROFILES: [&str; 3] = ["domainprofile", "privateprofile", "publicprofile"];

/// Snapshot each profile's `firewallpolicy` (e.g. "BlockInbound,AllowOutbound")
/// so disarm restores exactly what the user had.
#[cfg(windows)]
fn snapshot_policies() -> Option<Vec<(String, String)>> {
    let mut out = Vec::new();
    for profile in WIN_PROFILES {
        let text = netsh_output(&["advfirewall", "show", profile])?;
        let policy = parse_firewall_policy(&text)?;
        out.push((profile.to_string(), policy));
    }
    Some(out)
}

#[cfg(windows)]
fn ks_state_file() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let dir = std::path::PathBuf::from(base).join("NexusShield");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("killswitch-prev-policy.txt"))
}

#[cfg(windows)]
fn save_policy(snap: &[(String, String)]) {
    if let Some(path) = ks_state_file() {
        let body: String = snap
            .iter()
            .map(|(p, v)| format!("{p}={v}"))
            .collect::<Vec<_>>()
            .join("\n");
        let _ = std::fs::write(path, body);
    }
}

#[cfg(windows)]
fn read_saved_policy() -> Option<Vec<(String, String)>> {
    let path = ks_state_file()?;
    let body = std::fs::read_to_string(path).ok()?;
    let mut out = Vec::new();
    for line in body.lines() {
        if let Some((p, v)) = line.split_once('=') {
            if !p.is_empty() && v.contains(',') {
                out.push((p.to_string(), v.to_string()));
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[cfg(windows)]
fn clear_saved_policy() {
    if let Some(path) = ks_state_file() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(windows)]
fn locate_any_core() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["sing-box.exe", "xray.exe"] {
        let p = dir.join("binaries").join(name);
        if p.exists() {
            return Some(p);
        }
        let p2 = dir.join(name);
        if p2.exists() {
            return Some(p2);
        }
    }
    None
}

// ── macOS (pf) ──────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
fn enable_impl(allow: &[String]) -> Result<(), String> {
    // Build an anchor ruleset: drop all out, then punch holes for loopback,
    // the tunnel interfaces and each server IP.
    let rules = build_pf_rules(allow);
    let anchor_path = format!("/etc/pf.anchors/{TAG}");
    std::fs::write(&anchor_path, &rules).map_err(|e| format!("write pf anchor: {e}"))?;

    // Load the anchor in isolation. This MUST succeed.
    run("pfctl", &["-a", TAG, "-f", &anchor_path])
        .map_err(|e| format!("kill-switch: failed to load pf anchor: {e}"))?;

    // Only enable pf if it isn't already enabled, so we don't leak `-E`
    // reference-count tokens across repeated arm/disarm cycles (which would
    // otherwise leave pf enabled system-wide after we disarm).
    if !pf_enabled() {
        let _ = run("pfctl", &["-E"]);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn disable_impl() -> Result<(), String> {
    // Flush only our anchor; leave the rest of pf untouched. We deliberately do
    // not call `pfctl -d` (we may not have been the one to enable pf, and other
    // software may rely on it) — an empty anchor has no effect.
    let _ = run("pfctl", &["-a", TAG, "-F", "rules"]);
    let _ = std::fs::remove_file(format!("/etc/pf.anchors/{TAG}"));
    Ok(())
}

#[cfg(target_os = "macos")]
fn pf_enabled() -> bool {
    std::process::Command::new("pfctl")
        .arg("-s")
        .arg("info")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Status: Enabled"))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn build_pf_rules(allow: &[String]) -> String {
    let mut out = String::new();
    out.push_str("set block-policy drop\n");
    out.push_str("block drop out all\n");
    out.push_str("pass out quick on lo0 all\n");
    // Tunnel interfaces — let already-tunnelled traffic leave normally. The core
    // creates its utun device AFTER the kill-switch is armed and may not get
    // utun0, so allow a generous range of utun units (pf has no name wildcard).
    for n in 0..=15 {
        out.push_str(&format!("pass out quick on utun{n} all\n"));
    }
    // Allow DHCP/local-link so the box can keep its lease.
    out.push_str("pass out quick proto udp from any to any port 67:68\n");
    for ip in allow {
        if ip.contains(':') {
            out.push_str(&format!("pass out quick inet6 from any to {ip}\n"));
        } else {
            out.push_str(&format!("pass out quick inet from any to {ip}\n"));
        }
    }
    out
}

// ── Linux (iptables) ────────────────────────────────────────────────────────
#[cfg(all(unix, not(target_os = "macos")))]
fn enable_impl(allow: &[String]) -> Result<(), String> {
    // Idempotent: clear any previous chain first.
    let _ = disable_impl();

    // Dedicated chain so teardown never touches the user's own rules.
    run("iptables", &["-N", TAG]).ok();
    run("iptables", &["-F", TAG])
        .map_err(|e| format!("kill-switch: failed to create chain: {e}"))?;

    // Allow loopback, established flows, tunnel interfaces and direct egress to
    // the server IPs; drop everything else. `tun+`/`wg+`/`nexus+` are iptables
    // interface wildcards that match any unit (tun0, wg0, nexus-tun, …) — the
    // core may allocate any of these and we can't know the name before it
    // starts, so match them all.
    run("iptables", &["-A", TAG, "-o", "lo", "-j", "ACCEPT"])?;
    run(
        "iptables",
        &[
            "-A",
            TAG,
            "-m",
            "conntrack",
            "--ctstate",
            "ESTABLISHED,RELATED",
            "-j",
            "ACCEPT",
        ],
    )?;
    for iface in ["tun+", "wg+", "nexus+", "utun+"] {
        let _ = run("iptables", &["-A", TAG, "-o", iface, "-j", "ACCEPT"]);
    }
    let mut allow_paths = 0usize;
    for ip in allow {
        if ip.contains(':') {
            continue; // handled by ip6tables below
        }
        if run("iptables", &["-A", TAG, "-d", ip, "-j", "ACCEPT"]).is_ok() {
            allow_paths += 1;
        }
    }
    run("iptables", &["-A", TAG, "-j", "DROP"])?;
    // Hook the chain into OUTPUT.
    run("iptables", &["-I", "OUTPUT", "-j", TAG])?;

    // If there were IPv4 server targets but none installed, the tunnel can never
    // be (re)established through this default-deny chain — roll back.
    let v4_targets = allow.iter().filter(|ip| !ip.contains(':')).count();
    if v4_targets > 0 && allow_paths == 0 {
        let _ = disable_impl();
        return Err("kill-switch: could not install any server allow rule — rolled back".into());
    }

    // Best-effort IPv6: block all v6 egress except loopback to avoid leaks
    // (we don't currently route v6 through the tunnel).
    let _ = run("ip6tables", &["-N", TAG]);
    let _ = run("ip6tables", &["-F", TAG]);
    let _ = run("ip6tables", &["-A", TAG, "-o", "lo", "-j", "ACCEPT"]);
    let _ = run(
        "ip6tables",
        &[
            "-A",
            TAG,
            "-m",
            "conntrack",
            "--ctstate",
            "ESTABLISHED,RELATED",
            "-j",
            "ACCEPT",
        ],
    );
    for iface in ["tun+", "wg+", "nexus+", "utun+"] {
        let _ = run("ip6tables", &["-A", TAG, "-o", iface, "-j", "ACCEPT"]);
    }
    for ip in allow {
        if ip.contains(':') {
            let _ = run("ip6tables", &["-A", TAG, "-d", ip, "-j", "ACCEPT"]);
        }
    }
    let _ = run("ip6tables", &["-A", TAG, "-j", "DROP"]);
    let _ = run("ip6tables", &["-I", "OUTPUT", "-j", TAG]);

    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn disable_impl() -> Result<(), String> {
    // Unhook (possibly multiple stale hooks), flush, then delete our chain on
    // both tables. A single `-D` only removes one matching rule, so loop until
    // it reports failure to guarantee no stranded DROP chain remains hooked.
    for cmd in ["iptables", "ip6tables"] {
        for _ in 0..16 {
            if run(cmd, &["-D", "OUTPUT", "-j", TAG]).is_err() {
                break;
            }
        }
        let _ = run(cmd, &["-F", TAG]);
        let _ = run(cmd, &["-X", TAG]);
    }
    Ok(())
}

// ── Shared command runner (unix) ────────────────────────────────────────────
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

#[cfg(windows)]
fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    // `silent_command` applies CREATE_NO_WINDOW so arming/disarming the
    // kill-switch (which shells out to netsh repeatedly) doesn't flash a
    // console window for every rule.
    let status = crate::proc::silent_command(cmd)
        .args(args)
        .status()
        .map_err(|e| format!("{cmd}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{cmd} exited with {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_literals_are_recognised() {
        assert!(is_ip_literal("1.2.3.4"));
        assert!(is_ip_literal("::1"));
        assert!(is_ip_literal("2606:4700:4700::1111"));
        assert!(!is_ip_literal("example.com"));
        assert!(!is_ip_literal("1.2.3.4; rm -rf /"));
        assert!(!is_ip_literal(""));
    }

    #[test]
    fn resolve_ips_passes_through_literals() {
        let ips = resolve_ips("127.0.0.1");
        assert_eq!(ips, vec!["127.0.0.1".to_string()]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pf_rules_block_all_and_allow_servers() {
        let rules = build_pf_rules(&["1.2.3.4".to_string(), "2606:4700::1111".to_string()]);
        assert!(rules.contains("block drop out all"));
        assert!(rules.contains("pass out quick on lo0 all"));
        assert!(rules.contains("pass out quick inet from any to 1.2.3.4"));
        assert!(rules.contains("pass out quick inet6 from any to 2606:4700::1111"));
    }

    #[test]
    fn parses_firewall_policy_from_real_netsh_output() {
        // The exact shape of `netsh advfirewall show domainprofile`. The label is
        // TWO words ("Firewall Policy") — the parser must not capture "Policy".
        let out = "\r\nDomain Profile Settings:\r\n----------------------------------------------------------------------\r\nState                                 ON\r\nFirewall Policy                       BlockInbound,AllowOutbound\r\nLocalFirewallRules                    N/A (GPO-store only)\r\n";
        assert_eq!(
            parse_firewall_policy(out),
            Some("BlockInbound,AllowOutbound".to_string())
        );
    }

    #[test]
    fn parses_custom_outbound_block_policy() {
        let out = "Firewall Policy                       BlockInbound,BlockOutbound\n";
        assert_eq!(
            parse_firewall_policy(out),
            Some("BlockInbound,BlockOutbound".to_string())
        );
    }

    #[test]
    fn rejects_garbage_and_localized_policy_lines() {
        // No "Firewall Policy" line at all (e.g. localized Windows) → None.
        assert_eq!(parse_firewall_policy("State ON\nSomethingElse x,y\n"), None);
        // Label present but value isn't a valid <in>,<out> pair → None.
        assert_eq!(parse_firewall_policy("Firewall Policy   Nonsense\n"), None);
        assert_eq!(parse_firewall_policy("Firewall Policy   foo,bar\n"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pf_rules_cover_a_range_of_utun_units() {
        let rules = build_pf_rules(&[]);
        // The core may not get utun0; we must allow whatever unit it picks.
        assert!(rules.contains("pass out quick on utun0 all"));
        assert!(rules.contains("pass out quick on utun5 all"));
        assert!(rules.contains("pass out quick on utun15 all"));
    }
}
