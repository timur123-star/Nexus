# Changelog

All notable changes to NexusShield are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

A production-hardening pass focused on leak prevention, supply-chain integrity,
and never leaving a user stranded offline.

### Security

- **Supply chain:** core binaries (sing-box / Xray) are now **SHA-256 verified**
  against pinned hashes before being bundled. An unverified or tampered download
  aborts the build instead of shipping a binary that runs with elevated/TUN
  privileges.
- **Kill-switch is now fail-safe and verified.** Arming reports failure instead
  of silently leaving traffic unprotected; the connection is refused if the
  kill-switch was requested but couldn't arm. On Windows the prior firewall
  policy is snapshotted and restored on disarm (no more clobbering a user's
  custom outbound policy). Linux/macOS now cover the actual tunnel interface
  (wildcards / a wide `utun` range) instead of a hardcoded guess.
- **Crash safety:** a panic hook disarms the kill-switch and resets the system
  proxy so a crash can never strand the machine with no internet.
- **macOS privilege escalation:** fixed a command-injection hole in the
  AppleScript elevation path (executable paths are now escaped for both shell
  and AppleScript quoting).
- The running config (with server credentials) is written `0600` on Unix.
- The Clash API secret is masked in Settings; the help link uses
  `noopener,noreferrer`.
- Destructive actions (removing a subscription with its servers, clearing
  history) now require confirmation.

### Fixed

- **sing-box config:** the `geosite-cn` DNS rule is no longer emitted in
  global/direct routing modes (it referenced an undefined rule-set, making the
  whole config invalid). Fake-IP is now actually functional (dedicated fake-IP
  DNS server + query-type rule).
- **Core supervision:** closed an auto-restart race that could orphan a core
  process; readiness is now verified for Xray too (probes the inbound port when
  there's no Clash API); removed an unsafe `PATH` fallback for the core binary.
- **Connection state:** a delayed `running` event from a previous session can no
  longer resurrect a disconnected UI; connect is reentrancy-guarded; failover is
  bounded so a flapping network can't loop forever; system-proxy failures are
  surfaced instead of showing a misleading "connected".
- **xtls-rprx-vision** `flow` is dropped over non-TCP transports (it would
  otherwise produce a core-rejected config).
- **ShadowTLS** inner Shadowsocks credentials are recovered from the detouring
  outbound on sing-box config import.
- **Subscriptions:** a failing subscription now backs off instead of being
  re-fetched on every scheduler tick.
- **Xray:** custom DNS resolvers are now honoured (were silently dropped).

### Added

- The system-tray menu is localized to the UI language.
- Global unhandled-rejection / error handlers and a top-level error boundary.
- A reusable, accessible confirmation dialog (focus trap, Escape, ARIA).

### CI / tooling

- CI now compiles and tests Rust on **Windows, macOS and Linux** (was Linux
  only) and runs `clippy -D warnings`, `cargo fmt --check`, `cargo test`,
  Prettier check and the frontend test suite.
- `fetch-cores` selects the core arch from the **build target** (fixes the macOS
  Intel build shipping arm64 cores) and retries transient download failures.
- Releases are published as **drafts** (a human gate before auto-update clients
  receive them); the updater signing-key passphrase can be set via a secret.
