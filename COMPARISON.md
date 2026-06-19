# NexusShield vs. other VPN / proxy clients — honest analysis

*Author: TIMUR VALERIEVICH · written 2026-06-14. This is a deliberately honest
assessment — strengths **and** real gaps — so the roadmap is driven by facts,
not marketing.*

## What NexusShield is

A cross-platform desktop client (Tauri v2 + React + Rust) that drives **two
proxy cores** — sing-box and Xray-core — behind one UI. It parses share-links /
subscriptions, generates each core's JSON config itself, and supervises the
core process with health-watchdog + failover, a kill-switch, system-proxy/TUN,
QR share, ⌘K palette, mini-mode and an auto-updater.

## Direct competitors

| Client | Stack | Cores | Platforms | Notes |
|---|---|---|---|---|
| **Hiddify** | Flutter | sing-box | Win/mac/Linux/iOS/Android | Market leader, huge protocol coverage, mobile-first |
| **Nekoray / NekoBox** | Qt/C++ | sing-box + Xray | Win/Linux | Power-user favourite, very complete, dated UI |
| **v2rayN** | C#/.NET | Xray + sing-box | Windows | The Windows classic; massive feature set |
| **Clash Verge Rev** | Tauri+React | Mihomo (Clash.Meta) | Win/mac/Linux | Closest *architectural* twin to us; Clash ecosystem |
| **FlClash** | Flutter | Mihomo | All | Modern UI, Clash core |
| **Streisand / V2Box / Shadowrocket** | native | mixed | mostly mobile | mobile-centric |

## Where NexusShield genuinely competes well

1. **Dual-core abstraction.** Most clients lock you to one core. We pick
   sing-box *or* Xray automatically per-server (e.g. force Xray for XHTTP /
   post-quantum REALITY, fall back to sing-box for Hysteria/TUIC/AnyTLS). Few
   desktop clients do automatic per-node core selection.
2. **Reliability layer.** Health-probe watchdog + automatic failover to the best
   reachable server, exponential-backoff reconnect, and a kill-switch armed
   *before* the tunnel comes up. This is more than many clients ship.
3. **Modern, focused UX.** Tauri (small, native) + a clean crimson design,
   ⌘K command palette, mini-mode, QR share, real speed-test through the live
   proxy. Lighter and more cohesive than Nekoray/v2rayN.
4. **Self-contained config generation + tests.** Parser and both config
   generators are unit-tested (parity tests), so subscription import is
   predictable. Many clients shell the link straight into the core and hope.
5. **Auto-updater** with signed artifacts already wired in.

## Protocols implemented (as of 2026-06-14)

Parser **and** config generation (sing-box, plus Xray where the core supports
it) are wired and unit-tested for:

**VLESS** (incl. REALITY, `flow`/Vision, XHTTP, post-quantum REALITY), **VMess**,
**Trojan**, **Shadowsocks** (incl. SIP002 + plugin/obfs), **Hysteria2**,
**Hysteria v1**, **TUIC**, **WireGuard** (+ one-click **Cloudflare WARP**
auto-registration), **AnyTLS**, **ShadowTLS** (v1/v2/v3 over inner SS),
**SOCKS5**, **HTTP/HTTPS CONNECT**, **SSH** outbound, **Tor** outbound.

## Honest gaps vs. the leaders

1. **No mobile.** Hiddify, NekoBox, FlClash all ship Android/iOS. We are
   desktop-only. This is the single biggest coverage gap.
2. **Juicity + naïve.** Two protocols still missing vs. the maximalists. Neither
   sing-box nor Xray implements **Juicity** — it needs its own `juicity-client`
   binary bundled as a third engine, so it can't be faked through the existing
   cores. **naïve** (naiveproxy) is likewise a separate core. Everything else on
   the common-protocol list is now supported.
3. **Tor / SSH depend on the core build.** Tor and SSH outbounds require a
   sing-box binary compiled `with_*` those tags; the bundled build from
   `fetch-cores` must include them or those two outbounds won't start.
4. ~~**No mobile-style remote rule providers.**~~ **DONE (2026-06-19).** The
   rule editor now has a **`Rule URL`** match type: paste any sing-box
   rule-provider URL (`.srs` binary or `.json` source) and it's turned into a
   `remote` rule-set downloaded through the proxy and routed to the chosen
   target — Mihomo-style rule-provider parity on the desktop. (sing-box core
   only; Xray has no equivalent and silently ignores these rules.)

## What's now on par with the leaders

- **Protocol breadth** is now comparable to NekoBox / v2rayN for the protocols
  the cores actually run.
- **Routing.** GeoIP/GeoSite rule editor, per-app split tunnelling
  (process_name presets), QUIC blocking, and one-click saved routing profiles.
- **Subscriptions.** Scheduled auto-update, status badges, custom User-Agent,
  and **traffic + expiry** parsed from the `Subscription-Userinfo` header.
- **WARP.** One-click client-side registration (X25519 keypair → Cloudflare
  API → `wireguard://`), no external scripts.

## Verdict (honest)

NexusShield is a **genuinely strong desktop client** — its dual-core engine,
reliability/failover layer and clean UX put it ahead of the older desktop tools
(v2rayN, Nekoray) on *polish and robustness*, and on par architecturally with
Clash Verge Rev. On the desktop it now matches the protocol/routing/subscription
breadth of the power-user clients for everything the two cores can run. It is
**not yet** at Hiddify's level overall — almost entirely because of **no mobile
apps** (and the two separate-binary protocols, Juicity/naïve). As a portfolio
project it clearly demonstrates senior-level engineering: protocol parsing,
multi-core config generation, process supervision, and a production
build/release pipeline.

**Highest-leverage next steps:** (1) a mobile target (the one real breadth gap),
(2) bundle a third `juicity-client` core if Juicity coverage is wanted,
(3) remote rule-provider URLs for Mihomo-style routing parity.
