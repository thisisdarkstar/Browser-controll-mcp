// Agent Bridge MCP - Master Server & Relay Architecture (ES Module)
import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import {
  PORT,
  activeProfiles,
  pendingRequests,
  serverState,
  log,
  AUTO_SPAWN,
  spawnIsolatedBrowser,
} from "./state.js";

export async function checkMasterAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startMasterServer() {
  if (serverState.isMasterServer && serverState.httpServer?.listening) return;

  try {
    if (serverState.httpServer) {
      serverState.httpServer.close();
      serverState.httpServer = null;
    }
  } catch {}

  serverState.httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (reqUrl.pathname === "/health" || reqUrl.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", profiles: activeProfiles.size, pid: process.pid }));
      return;
    }

    if (reqUrl.pathname === "/test-fixture") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Agent Bridge Test Fixture</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; min-height: 2500px; background: #0b0f19; color: #f8fafc; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th, td { border: 1px solid #334155; padding: 10px 14px; text-align: left; }
    th { background: #0f172a; color: #00e5ff; }
    input, select, button { padding: 8px 12px; margin: 4px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: white; }
    button { background: #00e5ff; color: #020617; font-weight: bold; cursor: pointer; }
    .box { width: 120px; height: 80px; background: #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 12px 0; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Agent Bridge MCP Automated Test Fixture</h1>
  <p>Test paragraph for markdown extraction and find-in-page search keyword cohort testing.</p>

  <section id="form-section">
    <h2>Form Controls</h2>
    <form id="test-form">
      <input type="text" id="username" name="username" placeholder="Enter username" />
      <input type="password" id="password" name="password" placeholder="Enter password" />
      <select id="role-select" name="role">
        <option value="admin">Administrator</option>
        <option value="developer" selected>Developer</option>
        <option value="designer">Designer</option>
      </select>
      <label><input type="checkbox" id="subscribe" name="subscribe" /> Subscribe to updates</label>
      <label><input type="radio" name="plan" value="pro" id="plan-pro" /> Pro Plan</label>
      <label><input type="radio" name="plan" value="free" id="plan-free" checked /> Free Plan</label>
      <input type="file" id="file-input" />
      <button type="button" id="submit-btn" onclick="console.log('Button clicked!');">Submit Form</button>
    </form>
  </section>

  <section id="table-section">
    <h2>Data Table</h2>
    <table id="metrics-table">
      <caption>Performance Metrics</caption>
      <thead>
        <tr><th>Metric</th><th>Score</th><th>Status</th></tr>
      </thead>
      <tbody>
        <tr><td>LCP</td><td>1.2s</td><td>Good</td></tr>
        <tr><td>FID</td><td>18ms</td><td>Good</td></tr>
        <tr><td>CLS</td><td>0.01</td><td>Excellent</td></tr>
      </tbody>
    </table>
  </section>

  <section id="drag-section">
    <h2>Drag Target</h2>
    <div id="drag-source" class="box">Drag Me</div>
    <div id="drag-target" class="box" style="background: #10b981;">Drop Here</div>
  </section>

  <section id="media-section">
    <h2>Media Player</h2>
    <video id="test-video" width="320" height="180" controls>
      <source src="data:video/mp4;base64," type="video/mp4">
      <track kind="captions" label="English" srclang="en" default>
    </video>
  </section>

  <div style="margin-top: 1500px;" id="footer-section">
    <h2>Deep Scroll Anchor</h2>
    <p>Target found at bottom of page.</p>
  </div>
</body>
</html>`);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/profiles") {
      const list = Array.from(activeProfiles.values()).map((p) => ({
        id: p.id,
        name: p.name,
        browser: p.browser,
        connectedAt: new Date(p.connectedAt).toISOString(),
        lastActive: new Date(p.lastActive).toISOString(),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: list.length, profiles: list }));
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/rpc") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const targetProfile = parsed.profile || reqUrl.searchParams.get("profile");
          const result = await callProfileExtensionInternal(targetProfile, parsed.action, parsed.params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, result }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  serverState.httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${PORT} in use. Running as Relay Client.`);
      serverState.isMasterServer = false;
    } else {
      log("Server error:", err.message);
    }
  });

  serverState.wss = new WebSocketServer({ server: serverState.httpServer });

  serverState.wss.on("connection", (ws) => {
    let currentProfileId = null;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "register") {
          currentProfileId = msg.profileId;
          activeProfiles.set(currentProfileId, {
            id: msg.profileId,
            name: msg.profileName || "Browser Profile",
            browser: msg.browser || "Chromium",
            ws,
            connectedAt: Date.now(),
            lastActive: Date.now(),
          });
          log(`Profile registered: "${msg.profileName}" (${msg.browser}) [${msg.profileId}]`);
          return;
        }

        if (msg.type === "heartbeat") {
          if (currentProfileId && activeProfiles.has(currentProfileId)) {
            const p = activeProfiles.get(currentProfileId);
            p.lastActive = Date.now();
            if (msg.profileName) p.name = msg.profileName;
          }
          return;
        }

        if (msg.id && pendingRequests.has(msg.id)) {
          const req = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          clearTimeout(req.timer);
          if (msg.error) {
            req.reject(new Error(msg.error));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch (err) {
        log("WebSocket message parse error:", err.message);
      }
    });

    ws.on("close", () => {
      if (currentProfileId && activeProfiles.has(currentProfileId)) {
        const p = activeProfiles.get(currentProfileId);
        log(`Profile disconnected: "${p.name}" [${currentProfileId}]`);
        activeProfiles.delete(currentProfileId);
      }
    });

    ws.on("error", (err) => {
      log("WebSocket client error:", err.message);
    });
  });

  serverState.httpServer.listen(PORT, "127.0.0.1", () => {
    serverState.isMasterServer = true;
    log(`Master Bridge listening on http://127.0.0.1:${PORT} (WebSocket + HTTP Relay)`);
  });
}

export async function ensureMasterOrRelay() {
  if (serverState.isMasterServer && serverState.httpServer?.listening) return true;
  const alive = await checkMasterAlive();
  if (alive) {
    serverState.isMasterServer = false;
    return false;
  }
  startMasterServer();
  await new Promise((r) => setTimeout(r, 400));
  return serverState.isMasterServer;
}

export function initMasterRelayWatchdog() {
  setInterval(async () => {
    if (!serverState.isMasterServer) {
      const alive = await checkMasterAlive();
      if (!alive) {
        log("Master server offline. Auto-promoting this instance to Master Bridge...");
        await ensureMasterOrRelay();
      }
    }
  }, 3500);
}

export async function waitForProfile(timeoutMs = 10000) {
  if (activeProfiles.size > 0) return;
  if (AUTO_SPAWN && !serverState.browserProcess) spawnIsolatedBrowser();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (activeProfiles.size > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function getTargetProfile(requestedProfile) {
  await waitForProfile();

  if (activeProfiles.size === 0) {
    throw new Error(
      `No browser profile with "Agent Bridge MCP" extension is currently connected on ws://127.0.0.1:${PORT}.\n` +
      `Please open your browser (Chrome/Edge/Brave) where the extension is loaded and ensure the popup status shows "Connected".`
    );
  }

  if (requestedProfile) {
    const req = requestedProfile.toLowerCase().trim();
    if (activeProfiles.has(requestedProfile)) {
      return activeProfiles.get(requestedProfile);
    }
    for (const profile of activeProfiles.values()) {
      if (profile.name.toLowerCase() === req || profile.id.toLowerCase() === req) {
        return profile;
      }
    }
    for (const profile of activeProfiles.values()) {
      if (profile.name.toLowerCase().includes(req)) {
        return profile;
      }
    }
    const available = Array.from(activeProfiles.values())
      .map((p) => `"${p.name}" (ID: ${p.id})`)
      .join(", ");
    throw new Error(`Profile "${requestedProfile}" not found. Available profiles: ${available}`);
  }

  if (activeProfiles.size === 1) {
    return activeProfiles.values().next().value;
  }

  let mostRecent = null;
  for (const profile of activeProfiles.values()) {
    if (!mostRecent || profile.lastActive > mostRecent.lastActive) {
      mostRecent = profile;
    }
  }
  return mostRecent;
}

export async function callProfileExtensionInternal(profileQuery, action, params = {}, timeoutMs = 25000) {
  const profile = await getTargetProfile(profileQuery);

  return new Promise((resolve, reject) => {
    if (!profile.ws || profile.ws.readyState !== 1) {
      return reject(new Error(`Browser profile "${profile.name}" WebSocket is not open.`));
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Extension request timed out (${action}) on profile "${profile.name}".`));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });
    profile.ws.send(JSON.stringify({ id, action, params }));
  });
}

export async function callProfileExtension(profileQuery, action, params = {}, timeoutMs = 25000) {
  if (!serverState.isMasterServer) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileQuery, action, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.result;
    } catch (err) {
      log(`Relay call failed (${err.message}). Checking Master health...`);
      const masterStillAlive = await checkMasterAlive();
      if (!masterStillAlive) {
        log("Master server died. Promoting this instance to Master Bridge...");
        startMasterServer();
        await new Promise((r) => setTimeout(r, 600));
        if (serverState.isMasterServer) {
          return callProfileExtensionInternal(profileQuery, action, params, timeoutMs);
        }
      }
      throw err;
    }
  }

  return callProfileExtensionInternal(profileQuery, action, params, timeoutMs);
}

