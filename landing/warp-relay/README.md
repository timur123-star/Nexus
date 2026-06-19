# NexusShield WARP relay

Cloudflare's WARP registration API (`api.cloudflareclient.com`) is blocked from
some regions (e.g. RU). This tiny relay performs the enrollment from a host
**outside** the blocked region, so the desktop app can create WARP configs again.

## How it works

1. The app generates a WireGuard key pair **locally**. The private key never
   leaves your machine.
2. The app sends only the **public** key to your relay: `POST /reg { "key": "<base64>" }`.
3. The relay registers the peer with Cloudflare and returns the config JSON.
4. The app turns that into a `wireguard://` server and imports it.

Because only the public key is sent, the relay can never decrypt your traffic.

## API

| Method | Path      | Body                        | Response                       |
| ------ | --------- | --------------------------- | ------------------------------ |
| GET    | `/health` | —                           | `{ "ok": true }`               |
| POST   | `/reg`    | `{ "key": "<b64 pubkey>" }` | Cloudflare's registration JSON |

CORS is `*` so the app's webview can call it directly.

## Deploy to Railway (≈2 minutes)

**Option A — from this folder (recommended):**

1. Create a new GitHub repo containing just the contents of `warp-relay/`
   (or push the whole NexusShield repo and set the service root to `warp-relay`).
2. On https://railway.app → **New Project → Deploy from GitHub repo** → pick it.
3. Railway auto-detects Node (or the `Dockerfile`) and runs `npm start`.
4. Open **Settings → Networking → Generate Domain**. You get a URL like
   `https://your-app.up.railway.app`.
5. Hit `https://your-app.up.railway.app/health` in a browser — you should see
   `{"ok":true,...}`.

**Option B — Railway CLI:**

```bash
npm i -g @railway/cli
cd warp-relay
railway login
railway init
railway up
railway domain   # prints your public URL
```

Railway sets `PORT` automatically; the server reads it. No other env vars needed.

> Works the same on Fly.io, Render, a VPS, etc. Any host outside the blocked
> region with a public HTTPS URL will do.

## Point the app at it

In NexusShield: **Settings → Cloudflare WARP → Relay URL** → paste your URL
(e.g. `https://your-app.up.railway.app`). Click **Add WARP**. Done.

Leave the field empty to register directly with Cloudflare (the default).

## Test locally

```bash
node server.js
# in another terminal:
curl -s localhost:8080/health
curl -s -X POST localhost:8080/reg -H 'content-type: application/json' \
  -d '{"key":"<a valid 44-char base64 x25519 public key>"}'
```
