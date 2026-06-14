/**
 * NexusShield WARP relay.
 *
 * Cloudflare's WARP registration endpoint (api.cloudflareclient.com) is blocked
 * from some regions (e.g. RU), so the desktop app can't enroll a WARP peer
 * directly. Deploy this tiny relay on a host OUTSIDE the blocked region (Railway,
 * Fly, a VPS, …) and point the app at it: Settings → Cloudflare WARP → "Relay URL".
 *
 * Security model: the app generates the WireGuard key pair LOCALLY and only ever
 * sends its PUBLIC key here. The private key never leaves the user's machine, so
 * the relay can never decrypt traffic — it only performs the public enrollment
 * call Cloudflare would otherwise receive from the client.
 *
 * Zero dependencies (Node 18+ built-in http + fetch) so Railway/Nixpacks builds
 * it with no install step.
 */
"use strict";

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
// Cloudflare WARP client API — kept in sync with the Rust `warp_register`.
const CF_URL = "https://api.cloudflareclient.com/v0a2485/reg";
const CF_VERSION = "a-6.30-2485";
const CF_UA = "okhttp/3.12.1";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function randomHex22() {
  return crypto.randomBytes(11).toString("hex"); // 22 lowercase-hex chars
}

/** Register a fresh WARP peer for the given public key; returns Cloudflare's JSON. */
async function registerWarp(publicKey) {
  const body = {
    key: publicKey,
    install_id: randomHex22(),
    fcm_token: "",
    tos: new Date().toISOString(),
    type: "android",
    locale: "en_US",
  };
  const resp = await fetch(CF_URL, {
    method: "POST",
    headers: {
      "User-Agent": CF_UA,
      "CF-Client-Version": CF_VERSION,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Cloudflare returned HTTP ${resp.status}`);
    err.status = 502;
    err.detail = text.slice(0, 300);
    throw err;
  }
  return text; // pass Cloudflare's JSON straight through; the app parses it
}

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) {
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check — Railway pings this and you can open it in a browser.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json(res, 200, { ok: true, service: "nexusshield-warp-relay" });
  }

  if (req.method === "POST" && url.pathname === "/reg") {
    try {
      const raw = await readBody(req);
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        return json(res, 400, { error: "invalid JSON body" });
      }
      const key = String(parsed.key || parsed.publicKey || "").trim();
      // A WARP public key is a 44-char base64 X25519 key (32 bytes → 44 b64).
      if (!/^[A-Za-z0-9+/]{42,46}={0,2}$/.test(key)) {
        return json(res, 400, { error: "missing or malformed public key" });
      }
      const cf = await registerWarp(key);
      cors(res);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(cf);
    } catch (e) {
      return json(res, e.status || 500, {
        error: e.message || "registration failed",
        detail: e.detail,
      });
    }
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`NexusShield WARP relay listening on :${PORT}`);
});
