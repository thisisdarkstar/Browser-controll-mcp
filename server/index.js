import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";
import crypto from "crypto";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../extension");
const PORT = Number(process.env.MCP_BROWSER_PORT) || 18922;
const AUTO_SPAWN = process.env.AUTO_SPAWN === "true";

// Track connected browser profiles: profileId -> { id, name, browser, ws, lastActive, tabCount }
const activeProfiles = new Map();
const pendingRequests = new Map();
let browserProcess = null;

function log(...args) {
  console.error("[Agent Bridge MCP]", ...args);
}

// 1. Multi-Instance Master / Relay Architecture
// If an instance of Antigravity is already running server/index.js, subsequent Antigravity
// windows will automatically operate as Relay Clients, forwarding requests to the Master
// via HTTP RPC on port 18922. Every Antigravity instance shares the same live browser!
let isMasterServer = false;
let httpServer = null;
let wss = null;

async function checkMasterAlive() {
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

function startMasterServer() {
  if (isMasterServer && httpServer?.listening) return;

  try {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  } catch {}

  httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", profiles: activeProfiles.size, pid: process.pid }));
      return;
    }

    if (req.method === "GET" && req.url === "/profiles") {
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

    if (req.method === "POST" && req.url === "/rpc") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { profile, action, params } = JSON.parse(body);
          const result = await callProfileExtensionInternal(profile, action, params);
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

  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${PORT} in use. Running as Relay Client.`);
      isMasterServer = false;
    } else {
      log("Server error:", err.message);
    }
  });

  wss = new WebSocketServer({ server: httpServer });
  wss.on("error", (err) => {
    log("WebSocket server error:", err.message);
  });

  wss.on("connection", (ws) => {
    let attachedProfileId = null;

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === "register") {
          attachedProfileId = data.profileId || `profile_${Date.now()}`;
          activeProfiles.set(attachedProfileId, {
            id: attachedProfileId,
            name: data.profileName || "Browser Profile",
            browser: data.browser || "Chromium",
            ws,
            lastActive: Date.now(),
            connectedAt: data.timestamp || Date.now(),
          });
          log(`Profile Connected: "${data.profileName}" (${attachedProfileId}) [${data.browser}]`);
          return;
        }

        if (data.type === "heartbeat") {
          if (data.profileId && activeProfiles.has(data.profileId)) {
            const profile = activeProfiles.get(data.profileId);
            profile.lastActive = Date.now();
            if (data.profileName) profile.name = data.profileName;
          }
          return;
        }

        if (data.id && pendingRequests.has(data.id)) {
          const { resolve, reject, timer } = pendingRequests.get(data.id);
          clearTimeout(timer);
          pendingRequests.delete(data.id);

          if (attachedProfileId && activeProfiles.has(attachedProfileId)) {
            activeProfiles.get(attachedProfileId).lastActive = Date.now();
          }

          if (data.error) reject(new Error(data.error));
          else resolve(data.result);
        }
      } catch (err) {
        log("Error processing WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      if (attachedProfileId && activeProfiles.has(attachedProfileId)) {
        const profile = activeProfiles.get(attachedProfileId);
        log(`Profile Disconnected: "${profile.name}" (${attachedProfileId})`);
        activeProfiles.delete(attachedProfileId);
      }
    });

    ws.on("error", (err) => {
      log("WebSocket client error:", err.message);
    });
  });

  httpServer.listen(PORT, "127.0.0.1", () => {
    isMasterServer = true;
    log(`Master Bridge listening on http://127.0.0.1:${PORT} (WebSocket + HTTP Relay)`);
  });
}

async function ensureMasterOrRelay() {
  if (isMasterServer && httpServer?.listening) return true;
  const alive = await checkMasterAlive();
  if (alive) {
    isMasterServer = false;
    return false;
  }
  startMasterServer();
  await new Promise((r) => setTimeout(r, 400));
  return isMasterServer;
}

// Initialize Master or Relay
await ensureMasterOrRelay();

// Master/Relay Watchdog: If Relay and Master goes down, promote to Master automatically
setInterval(async () => {
  if (!isMasterServer) {
    const alive = await checkMasterAlive();
    if (!alive) {
      log("Master server offline. Auto-promoting this instance to Master Bridge...");
      await ensureMasterOrRelay();
    }
  }
}, 3500);

// Optional standalone browser spawn fallback
function resolveChromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return "google-chrome";
}

function spawnIsolatedBrowser() {
  if (browserProcess) return;
  const profileDir = path.join(os.homedir(), ".agent-browser-profile");
  const chromeBin = resolveChromeBinary();
  log(`Spawning isolated fallback Chrome instance at ${profileDir}...`);

  browserProcess = spawn(
    chromeBin,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--silent-debugger-extension-api",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );
  browserProcess.unref();
}

async function waitForProfile(timeoutMs = 10000) {
  if (activeProfiles.size > 0) return;
  if (AUTO_SPAWN && !browserProcess) spawnIsolatedBrowser();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (activeProfiles.size > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function getTargetProfile(requestedProfile) {
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

async function callProfileExtensionInternal(profileQuery, action, params = {}, timeoutMs = 25000) {
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

async function callProfileExtension(profileQuery, action, params = {}, timeoutMs = 25000) {
  // If running as a Relay Client in a secondary Antigravity window/instance,
  // forward the request to the Master instance over HTTP RPC!
  if (!isMasterServer) {
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
        if (isMasterServer) {
          return callProfileExtensionInternal(profileQuery, action, params, timeoutMs);
        }
      }
      throw err;
    }
  }

  return callProfileExtensionInternal(profileQuery, action, params, timeoutMs);
}

function jsonResult(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

// 2. Initialize MCP Server
const server = new McpServer({
  name: "custom-browser-bridge",
  version: "2.0.0",
});

// ---------------------------------------------------------------------------
// Profiles & Tabs
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_list_profiles",
  {
    description: "List all currently connected browser profiles (e.g. Work, Personal, Brave, Edge), their IDs, names, and active status.",
  },
  async () => {
    await ensureMasterOrRelay();
    if (!isMasterServer) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/profiles`, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        return jsonResult(data);
      } catch (err) {
        log(`Relay profile fetch failed: ${err.message}`);
        await ensureMasterOrRelay();
      }
    }

    const list = Array.from(activeProfiles.values()).map((p) => ({
      id: p.id,
      name: p.name,
      browser: p.browser,
      connectedAt: new Date(p.connectedAt).toISOString(),
      lastActive: new Date(p.lastActive).toISOString(),
    }));
    return jsonResult({
      count: list.length,
      profiles: list,
      hint: list.length > 1 ? "Specify 'profile' (name or ID) in browser commands to target a specific profile." : undefined,
    });
  }
);

server.registerTool(
  "browser_list_tabs",
  {
    description: "List all open tabs across browser windows in the profile, including tabId, URL, title, active state, and debugger attachment.",
    inputSchema: { profile: z.string().optional().describe("Optional profile name or ID") },
  },
  async ({ profile }) => jsonResult(await callProfileExtension(profile, "list_tabs"))
);

server.registerTool(
  "browser_switch_tab",
  {
    description: "Focus and switch to a specific tab by tabId, bringing its browser window to the foreground.",
    inputSchema: {
      tabId: z.number().describe("The ID of the tab to activate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "switch_tab", { tabId }))
);

server.registerTool(
  "browser_new_tab",
  {
    description: "Open a new tab with an optional URL.",
    inputSchema: {
      url: z.string().optional().describe("URL to open (defaults to 'about:blank')"),
      active: z.boolean().optional().describe("Whether to make the new tab active (default true)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ url, active, profile }) => jsonResult(await callProfileExtension(profile, "new_tab", { url, active }))
);

server.registerTool(
  "browser_close_tab",
  {
    description: "Close a specific tab by tabId.",
    inputSchema: {
      tabId: z.number().describe("The ID of the tab to close"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "close_tab", { tabId }))
);

server.registerTool(
  "browser_navigate",
  {
    description: "Open a new tab or navigate an existing tabId to a specified URL.",
    inputSchema: {
      url: z.string().describe("The URL to open or navigate to"),
      tabId: z.number().optional().describe("Omit to open a new tab, or provide tabId to navigate existing tab"),
      active: z.boolean().optional().describe("Whether to make the tab active (default true)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ url, tabId, active, profile }) => jsonResult(await callProfileExtension(profile, "navigate_or_open", { url, tabId, active }))
);

server.registerTool(
  "browser_reload",
  {
    description: "Reload a specific tab with optional cache bypass.",
    inputSchema: {
      tabId: z.number().describe("The ID of the tab to reload"),
      ignoreCache: z.boolean().optional().describe("Bypass browser cache (hard reload)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, ignoreCache, profile }) => jsonResult(await callProfileExtension(profile, "reload_tab", { tabId, ignoreCache }))
);

server.registerTool(
  "browser_read_all_tabs",
  {
    description: "Extract visible text and metadata from every open tab in the browser profile at once.",
    inputSchema: {
      maxLengthPerTab: z.number().optional().describe("Max characters to extract per tab (default 4000)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ maxLengthPerTab, profile }) => jsonResult(await callProfileExtension(profile, "read_all_tabs", { maxLength: maxLengthPerTab }))
);

// ---------------------------------------------------------------------------
// DOM, Snapshots, Accessibility & CSS
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_get_interactive_snapshot",
  {
    description: "Assigns data-agent-ref IDs (ref_1, ref_2...) to all visible interactive elements in a tab and returns a structured map of clickable buttons, inputs, links, and coordinates.",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "get_interactive_snapshot", { tabId }))
);

server.registerTool(
  "browser_take_snapshot",
  {
    description: "Take an accessibility (a11y) tree text snapshot of the page listing elements, roles, names, and node IDs.",
    inputSchema: {
      tabId: z.number().describe("The tabId to snapshot"),
      verbose: z.boolean().optional().describe("Include full detailed a11y tree"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, verbose, profile }) => jsonResult(await callProfileExtension(profile, "take_snapshot", { tabId, verbose }))
);

server.registerTool(
  "browser_get_css_styles",
  {
    description: "Inspect computed CSS styles for an element specified by ref (e.g. 'ref_4') or CSS selector.",
    inputSchema: {
      tabId: z.number().describe("The tabId where the element is located"),
      target: z.string().describe("Element ref (e.g. 'ref_5') or CSS selector (e.g. 'button.primary')"),
      properties: z.array(z.string()).optional().describe("Specific CSS properties to retrieve (defaults to essential visual styles)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, properties, profile }) => jsonResult(await callProfileExtension(profile, "get_css_styles", { tabId, target, properties }))
);

server.registerTool(
  "browser_wait_for",
  {
    description: "Wait for specific text or a CSS selector to appear on the page.",
    inputSchema: {
      tabId: z.number().describe("The tabId to watch"),
      text: z.union([z.string(), z.array(z.string())]).optional().describe("One or more texts to wait for"),
      selector: z.string().optional().describe("CSS selector to wait for"),
      timeout: z.number().optional().describe("Timeout in ms (default 10000ms)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, text, selector, timeout, profile }) => jsonResult(await callProfileExtension(profile, "wait_for", { tabId, text, selector, timeout }))
);

// ---------------------------------------------------------------------------
// Precision Input & Interaction
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_act_on_ref",
  {
    description: "Click or type into a specific data-agent-ref element from browser_get_interactive_snapshot using trusted CDP hardware events and rendering a glowing visual action overlay.",
    inputSchema: {
      tabId: z.number().describe("The tabId where the element is located"),
      ref: z.string().describe("The ref ID, e.g. 'ref_14'"),
      actionType: z.enum(["click", "type"]).describe("Action to perform: 'click' or 'type'"),
      text: z.string().optional().describe("Text to type if actionType is 'type'"),
      clearFirst: z.boolean().optional().describe("Clear existing input value before typing"),
      pressEnter: z.boolean().optional().describe("Press Enter key after typing"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, ref, actionType, text, clearFirst, pressEnter, profile }) =>
    jsonResult(await callProfileExtension(profile, "act_on_ref", { tabId, ref, actionType, text, clearFirst, pressEnter }))
);

server.registerTool(
  "browser_click",
  {
    description: "Click an element (by ref, CSS selector, or coordinates) using trusted hardware CDP events.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().optional().describe("Ref (e.g. 'ref_3') or CSS selector (e.g. '#submit')"),
      x: z.number().optional().describe("Explicit X coordinate"),
      y: z.number().optional().describe("Explicit Y coordinate"),
      button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default 'left')"),
      clickCount: z.number().optional().describe("Click count: 1 for single click, 2 for double click"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, x, y, button, clickCount, profile }) =>
    jsonResult(await callProfileExtension(profile, "click", { tabId, target, x, y, button, clickCount }))
);

server.registerTool(
  "browser_hover",
  {
    description: "Hover over an element (by ref, selector, or coordinates) triggering mouse hover states.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().optional().describe("Ref (e.g. 'ref_2') or CSS selector"),
      x: z.number().optional().describe("Explicit X coordinate"),
      y: z.number().optional().describe("Explicit Y coordinate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, x, y, profile }) => jsonResult(await callProfileExtension(profile, "hover", { tabId, target, x, y }))
);

server.registerTool(
  "browser_drag",
  {
    description: "Drag an element or coordinate onto another element or coordinate.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      fromTarget: z.string().optional().describe("Source ref or selector"),
      toTarget: z.string().optional().describe("Destination ref or selector"),
      fromX: z.number().optional().describe("Source X coordinate"),
      fromY: z.number().optional().describe("Source Y coordinate"),
      toX: z.number().optional().describe("Destination X coordinate"),
      toY: z.number().optional().describe("Destination Y coordinate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async (params) => jsonResult(await callProfileExtension(params.profile, "drag", params))
);

server.registerTool(
  "browser_fill",
  {
    description: "Fill an input or textarea element with text (focuses, clears existing text, and types value).",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().describe("Ref (e.g. 'ref_4') or CSS selector (e.g. 'input[name=\"email\"]')"),
      value: z.string().describe("Text value to fill into the input"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, value, profile }) => jsonResult(await callProfileExtension(profile, "fill", { tabId, target, value }))
);

server.registerTool(
  "browser_fill_form",
  {
    description: "Fill multiple form inputs at once given a key-value mapping of targets to values.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      fields: z.record(z.string()).describe("Object of { selector_or_ref: value }, e.g. { '#username': 'admin', '#password': 'pass' }"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, fields, profile }) => jsonResult(await callProfileExtension(profile, "fill_form", { tabId, fields }))
);

server.registerTool(
  "browser_press_key",
  {
    description: "Press a keyboard key or shortcut (e.g. 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown').",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      key: z.string().describe("Key to press, e.g. 'Enter', 'Tab', 'Escape', 'a'"),
      code: z.string().optional().describe("Optional key code, e.g. 'Enter', 'KeyA'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, key, code, profile }) => jsonResult(await callProfileExtension(profile, "press_key", { tabId, key, code }))
);

server.registerTool(
  "browser_type_text",
  {
    description: "Type text into the currently focused element or into a specific target element.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      text: z.string().describe("Text string to type"),
      target: z.string().optional().describe("Optional ref or selector to focus before typing"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, text, target, profile }) => jsonResult(await callProfileExtension(profile, "type_text", { tabId, text, target }))
);

server.registerTool(
  "browser_upload_file",
  {
    description: "Upload local file(s) into a file input element.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().describe("Ref (e.g. 'ref_8') or selector for the file input element"),
      filePaths: z.union([z.string(), z.array(z.string())]).describe("Absolute local path(s) to the file(s) to upload"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, filePaths, profile }) => jsonResult(await callProfileExtension(profile, "upload_file", { tabId, target, filePaths }))
);

server.registerTool(
  "browser_handle_dialog",
  {
    description: "Accept or dismiss a JavaScript alert, confirm, prompt, or beforeunload dialog.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      action: z.enum(["accept", "dismiss"]).describe("Action to take on dialog: 'accept' or 'dismiss'"),
      promptText: z.string().optional().describe("Optional text to enter into a prompt dialog"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, action, promptText, profile }) => jsonResult(await callProfileExtension(profile, "handle_dialog", { tabId, action, promptText }))
);

// ---------------------------------------------------------------------------
// Emulation & Viewport
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_resize_page",
  {
    description: "Set viewport width, height, deviceScaleFactor, and mobile emulation.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      width: z.number().describe("Viewport width in pixels (e.g. 1280, 390)"),
      height: z.number().describe("Viewport height in pixels (e.g. 800, 844)"),
      deviceScaleFactor: z.number().optional().describe("Device scale factor (e.g. 1, 2)"),
      mobile: z.boolean().optional().describe("Whether to emulate mobile screen"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, width, height, deviceScaleFactor, mobile, profile }) =>
    jsonResult(await callProfileExtension(profile, "resize_page", { tabId, width, height, deviceScaleFactor, mobile }))
);

server.registerTool(
  "browser_emulate",
  {
    description: "Emulate color scheme, CPU throttling, network conditions, geolocation, or user agent.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      colorScheme: z.enum(["dark", "light", "auto"]).optional().describe("Emulate dark or light color scheme"),
      cpuThrottlingRate: z.number().optional().describe("CPU slowdown factor (1 to 20, 1 disables)"),
      networkConditions: z.enum(["Offline", "Slow 3G", "Fast 3G", "Slow 4G", "Fast 4G"]).optional().describe("Network throttling profile"),
      geolocation: z.string().optional().describe("Geolocation as 'latitude,longitude', e.g. '37.7749,-122.4194'"),
      userAgent: z.string().optional().describe("Custom user agent override string"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, colorScheme, cpuThrottlingRate, networkConditions, geolocation, userAgent, profile }) =>
    jsonResult(await callProfileExtension(profile, "emulate", { tabId, colorScheme, cpuThrottlingRate, networkConditions, geolocation, userAgent }))
);

// ---------------------------------------------------------------------------
// Network, Cookies & Storage
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_list_network_requests",
  {
    description: "List recorded network requests for a tab (status, method, url, resourceType, mimeType, timestamp).",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "list_network_requests", { tabId }))
);

server.registerTool(
  "browser_get_network_request",
  {
    description: "Get full details and response body of a specific network request by requestId.",
    inputSchema: {
      tabId: z.number().describe("The tabId where the request was made"),
      requestId: z.string().describe("The requestId from network request list"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, requestId, profile }) => jsonResult(await callProfileExtension(profile, "get_network_request", { tabId, requestId }))
);

server.registerTool(
  "browser_get_network_body",
  {
    description: "Fetch the raw response body of a specific network requestId obtained from browser_get_telemetry or network requests.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      requestId: z.string().describe("The requestId"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, requestId, profile }) => jsonResult(await callProfileExtension(profile, "get_response_body", { tabId, requestId }))
);

server.registerTool(
  "browser_get_cookies",
  {
    description: "Retrieve all cookies for the current tab's active URL.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "get_cookies", { tabId }))
);

server.registerTool(
  "browser_set_cookie",
  {
    description: "Set a cookie on the active tab's domain.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      name: z.string().describe("Cookie name"),
      value: z.string().describe("Cookie value"),
      url: z.string().optional().describe("Target URL (defaults to tab URL)"),
      domain: z.string().optional().describe("Cookie domain"),
      path: z.string().optional().describe("Cookie path (defaults to '/')"),
      secure: z.boolean().optional().describe("Secure cookie flag (default true)"),
      httpOnly: z.boolean().optional().describe("HttpOnly cookie flag (default false)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async (params) => jsonResult(await callProfileExtension(params.profile, "set_cookie", params))
);

server.registerTool(
  "browser_clear_cookies",
  {
    description: "Clear all cookies for the browser profile.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "clear_cookies", { tabId }))
);

server.registerTool(
  "browser_storage",
  {
    description: "Inspect or manipulate localStorage or sessionStorage in a tab.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      operation: z.enum(["get", "set", "remove", "clear"]).describe("Storage operation to perform"),
      key: z.string().optional().describe("Storage key name"),
      value: z.string().optional().describe("Value to set (if operation is 'set')"),
      storageType: z.enum(["localStorage", "sessionStorage"]).optional().describe("Type of storage (default 'localStorage')"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, operation, key, value, storageType, profile }) =>
    jsonResult(await callProfileExtension(profile, "storage", { tabId, operation, key, value, storageType }))
);

// ---------------------------------------------------------------------------
// Console, Telemetry & Diagnostics
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_list_console_messages",
  {
    description: "List captured console logs, warnings, errors, and uncaught exceptions with timestamps and stack traces.",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      level: z.enum(["log", "info", "warn", "error"]).optional().describe("Filter by message level"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, level, profile }) => jsonResult(await callProfileExtension(profile, "list_console_messages", { tabId, level }))
);

server.registerTool(
  "browser_get_telemetry",
  {
    description: "Attach CDP debugger to a tab and retrieve buffered console logs, uncaught exceptions, dialogs, and recorded network requests.",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      clearAfterRead: z.boolean().optional().describe("Clear buffered telemetry after reading (default false)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, clearAfterRead, profile }) => jsonResult(await callProfileExtension(profile, "get_telemetry", { tabId, clearAfterRead }))
);

// ---------------------------------------------------------------------------
// Performance, Memory & Screenshots
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_screenshot",
  {
    description: "Capture a PNG screenshot of a specific tab.",
    inputSchema: {
      tabId: z.number().describe("The tabId to screenshot"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => {
    const { base64Png } = await callProfileExtension(profile, "screenshot", { tabId });
    return {
      content: [{ type: "image", data: base64Png, mimeType: "image/png" }],
    };
  }
);

server.registerTool(
  "browser_take_heapsnapshot",
  {
    description: "Take a V8 heap snapshot for memory leak analysis.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "take_heapsnapshot", { tabId }))
);

server.registerTool(
  "browser_performance_trace",
  {
    description: "Start or stop a Chrome performance timeline trace.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      action: z.enum(["start", "stop"]).describe("Trace action: 'start' or 'stop'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, action, profile }) => {
    const rpc = action === "start" ? "performance_start_trace" : "performance_stop_trace";
    return jsonResult(await callProfileExtension(profile, rpc, { tabId }));
  }
);

server.registerTool(
  "browser_performance_analyze_insight",
  {
    description: "Extract Core Web Vitals and navigation performance timings (TTFB, FCP, DOMContentLoaded, LoadTime).",
    inputSchema: {
      tabId: z.number().describe("The tabId to analyze"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "performance_analyze_insight", { tabId }))
);

// ---------------------------------------------------------------------------
// Execution & Raw CDP Escape Hatch
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_eval_js",
  {
    description: "Execute arbitrary JavaScript or DOM inspection inside any tab via CDP Runtime.evaluate.",
    inputSchema: {
      tabId: z.number().describe("The tabId to run code in"),
      expression: z.string().describe("JavaScript code or expression to evaluate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, expression, profile }) => jsonResult(await callProfileExtension(profile, "eval_js", { tabId, expression }))
);

server.registerTool(
  "browser_raw_cdp",
  {
    description: "Execute any raw Chrome DevTools Protocol (CDP) method on a tab (e.g. DOM.getDocument, Input.dispatchMouseEvent, Network.getCookies).",
    inputSchema: {
      tabId: z.number().describe("The tabId to control"),
      method: z.string().describe("CDP method name, e.g. 'DOM.getDocument' or 'Network.getCookies'"),
      commandParams: z.record(z.any()).optional().describe("Optional parameters object for the CDP command"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, method, commandParams, profile }) => jsonResult(await callProfileExtension(profile, "raw_cdp", { tabId, method, commandParams }))
);

// Connect MCP stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
log("Agent Bridge MCP Server v2.0 connected and ready with full DevTools capabilities!");
