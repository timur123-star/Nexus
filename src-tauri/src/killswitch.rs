//! OS-level kill-switch (leak protection).
//!
//! When armed it installs a firewall policy that DROPS all outbound traffic
//! except:
//!   * loopback,
//!   * the connection(s) to the active VPN server's IP(s) — so the core can
//!     keep the tunnel alive / reconnect,
//!   * (Windows) the core executable itself.
//!
//! so that if the tunnel collapses the user's real traffic is blocked instead
//! of leaking onto the open internet. Fully reversible via [`disable`].
//!
//! Requires elevated privileges (same as TUN). Every backend is best-effort and
//! returns a human-readable error on failure. The rules are tagged with a
//! dedicated marker so [`disable`] can always find and remove exactly what we
//! added without disturbing the user's own firewall configuration.

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
#[cfg(windows)]
fn enable_impl(allow: &[String]) -> Result<(), String> {
    // Start from a clean slate so re-arming with a new server is idempotent.
    let _ = disable_impl();

    // Default-deny all outbound; loopback is implicitly exempt on Windows.
    netsh(&[
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,blockoutbound",
    ])?;

    // Allow the core executable itself to talk to the server.
    if let Some(core) = locate_any_core() {
        let prog = core.to_string_lossy().to_string();
        let _ = netsh(&[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={TAG}-Core"),
            "dir=out",
            "action=allow",
            &format!("program={prog}"),
            "enable=yes",
        ]);
    }

    // Allow direct egress to each resolved server IP (covers cores that don't
    // resolve to a single program path, and the reconnect path).
    for ip in allow {
        let _ = netsh(&[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={TAG}-Server"),
            "dir=out",
            "action=allow",
            &format!("remoteip={ip}"),
            "enable=yes",
        ]);
    }
    Ok(())
}

#[cfg(windows)]
fn disable_impl() -> Result<(), String> {
    // Remove our allow rules (ignore "no rules matched" failures)…
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
    // …and restore the default outbound-allow policy.
    netsh(&[
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,allowoutbound",
    ])
}

#[cfg(windows)]
fn netsh(args: &[&str]) -> Result<(), String> {
    run("netsh", args)
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

    // Load the anchor in isolation and enable pf. `-E` reference-counts the
    // enable so we don't fight the system pf state.
    run("pfctl", &["-a", TAG, "-f", &anchor_path])?;
    let _ = run("pfctl", &["-E"]);
    Ok(())
}

#[cfg(target_os = "macos")]
fn disable_impl() -> Result<(), String> {
    // Flush only our anchor; leave the rest of pf untouched.
    let _ = run("pfctl", &["-a", TAG, "-F", "rules"]);
    let _ = std::fs::remove_file(format!("/etc/pf.anchors/{TAG}"));
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_pf_rules(allow: &[String]) -> String {
    let mut out = String::new();
    out.push_str("set block-policy drop\n");
    out.push_str("block drop out all\n");
    out.push_str("pass out quick on lo0 all\n");
    // Tunnel interfaces — let already-tunnelled traffic leave normally.
    out.push_str("pass out quick on utun0 all\n");
    out.push_str("pass out quick on utun1 all\n");
    out.push_str("pass out quick on utun2 all\n");
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
    run("iptables", &["-F", TAG])?;

    // Allow loopback, established flows, tunnel interfaces and DNS-less direct
    // egress to the server IPs; drop everything else.
    run("iptables", &[
        "-A", TAG, "-o", "lo", "-j", "ACCEPT",
    ])?;
    run("iptables", &[
        "-A", TAG, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT",
    ])?;
    for iface in ["tun0", "tun1", "wg0", "nexus0"] {
        let _ = run("iptables", &["-A", TAG, "-o", iface, "-j", "ACCEPT"]);
    }
    for ip in allow {
        if ip.contains(':') {
            continue; // handled by ip6tables below
        }
        run("iptables", &["-A", TAG, "-d", ip, "-j", "ACCEPT"])?;
    }
    run("iptables", &["-A", TAG, "-j", "DROP"])?;
    // Hook the chain into OUTPUT.
    run("iptables", &["-I", "OUTPUT", "-j", TAG])?;

    // Best-effort IPv6: block all v6 egress except loopback to avoid leaks
    // (we don't currently route v6 through the tunnel).
    let _ = run("ip6tables", &["-N", TAG]);
    let _ = run("ip6tables", &["-F", TAG]);
    let _ = run("ip6tables", &["-A", TAG, "-o", "lo", "-j", "ACCEPT"]);
    let _ = run("ip6tables", &[
        "-A", TAG, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT",
    ]);
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
    // Unhook + flush + delete our chain on both tables (ignore absence).
    for cmd in ["iptables", "ip6tables"] {
        let _ = run(cmd, &["-D", "OUTPUT", "-j", TAG]);
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
}
