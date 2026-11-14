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
