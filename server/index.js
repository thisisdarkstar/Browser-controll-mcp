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

    const reqUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

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
  version: "2.1.0",
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
    description: "Open a new tab or navigate an existing tabId to a specified URL with optional navigation completion waiting.",
    inputSchema: {
      url: z.string().describe("The URL to open or navigate to"),
      tabId: z.number().optional().describe("Omit to open a new tab, or provide tabId to navigate existing tab"),
      active: z.boolean().optional().describe("Whether to make the tab active (default true)"),
      waitFor: z.enum(["load", "domcontentloaded", "none"]).optional().describe("Wait condition after navigating (default 'load')"),
      timeoutMs: z.number().optional().describe("Timeout for navigation wait in milliseconds (default 15000)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ url, tabId, active, waitFor, timeoutMs, profile }) =>
    jsonResult(await callProfileExtension(profile, "navigate_or_open", { url, tabId, active, waitFor, timeoutMs }))
);

server.registerTool(
  "browser_go_back",
  {
    description: "Navigate back in browser history for a specific tab.",
    inputSchema: {
      tabId: z.number().describe("The tabId to navigate back"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "go_back", { tabId }))
);

server.registerTool(
  "browser_go_forward",
  {
    description: "Navigate forward in browser history for a specific tab.",
    inputSchema: {
      tabId: z.number().describe("The tabId to navigate forward"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) => jsonResult(await callProfileExtension(profile, "go_forward", { tabId }))
);

server.registerTool(
  "browser_scroll",
  {
    description: "Scroll page or specific scrollable container/element by direction, pixel distance, or target ref/selector.",
    inputSchema: {
      tabId: z.number().describe("The tabId to scroll"),
      direction: z.enum(["up", "down", "top", "bottom", "left", "right"]).optional().describe("Scroll direction (default 'down')"),
      distance: z.number().optional().describe("Scroll distance in pixels (default 500)"),
      target: z.string().optional().describe("Optional ref (e.g. 'ref_5') or CSS selector to scroll into view or scroll inside container"),
      smooth: z.boolean().optional().describe("Smooth scroll animation (default false for instant)"),
      x: z.number().optional().describe("Direct absolute X scroll coordinate"),
      y: z.number().optional().describe("Direct absolute Y scroll coordinate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, direction, distance, target, smooth, x, y, profile }) =>
    jsonResult(await callProfileExtension(profile, "scroll", { tabId, direction, distance, target, smooth, x, y }))
);

server.registerTool(
  "browser_manage_tab_group",
  {
    description: "Organize, group, ungroup, collapse, or expand browser tabs into named colored tab groups.",
    inputSchema: {
      tabIds: z.array(z.number()).describe("Array of tab IDs to manage"),
      action: z.enum(["group", "ungroup", "collapse", "expand"]).optional().describe("Group action (default 'group')"),
      title: z.string().optional().describe("Optional title for the tab group (e.g. 'AI Agent Work')"),
      color: z.enum(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"]).optional().describe("Color of the tab group"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabIds, action, title, color, profile }) =>
    jsonResult(await callProfileExtension(profile, "manage_tab_group", { tabIds, action, title, color }))
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
    description: "Assigns data-agent-ref IDs (ref_1, ref_2...) to all visible interactive elements in a tab and returns a structured map of clickable buttons, inputs, links, coordinates, and form context with Shadow DOM traversal.",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      viewportOnly: z.boolean().optional().describe("If true, only returns interactive elements currently visible in viewport (saves tokens on long pages)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, viewportOnly, profile }) => jsonResult(await callProfileExtension(profile, "get_interactive_snapshot", { tabId, viewportOnly }))
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
  "browser_get_markdown",
  {
    description: "Extract clean, readable GitHub-flavored Markdown from the active or specified tab, stripping navbars, ads, scripts, and clutter to maximize LLM token efficiency.",
    inputSchema: {
      tabId: z.number().describe("The tabId to extract content from"),
      selector: z.string().optional().describe("Optional CSS selector to extract from (defaults to main/article/body)"),
      includeLinks: z.boolean().optional().describe("Whether to retain hyperlinks in markdown (default true)"),
      includeImages: z.boolean().optional().describe("Whether to retain image tags in markdown (default false)"),
      maxLength: z.number().optional().describe("Max character limit for returned markdown (default 50000)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, selector, includeLinks, includeImages, maxLength, profile }) =>
    jsonResult(await callProfileExtension(profile, "get_markdown", { tabId, selector, includeLinks, includeImages, maxLength }))
);

server.registerTool(
  "browser_extract_table",
  {
    description: "Automatically detect and parse HTML <table> elements or repetitive data grids on the page into structured JSON, CSV, or Markdown tables.",
    inputSchema: {
      tabId: z.number().describe("The tabId to inspect"),
      target: z.string().optional().describe("Optional table selector (e.g. '#data-table', 'table.results') or element ref"),
      format: z.enum(["json", "markdown", "csv"]).optional().describe("Output format: 'json' (default), 'markdown', or 'csv'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, format, profile }) =>
    jsonResult(await callProfileExtension(profile, "extract_table", { tabId, target, format }))
);

server.registerTool(
  "browser_find_in_page",
  {
    description: "Fast in-page text search (equivalent to Chrome Ctrl+F). Returns match count, surrounding snippets, coordinates, and can smoothly scroll to match #N with visual highlight.",
    inputSchema: {
      tabId: z.number().describe("The tabId to search in"),
      query: z.string().describe("Text to search for"),
      caseSensitive: z.boolean().optional().describe("Whether search is case-sensitive (default false)"),
      scrollToIndex: z.number().optional().describe("0-based index of match to scroll into view and highlight"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, query, caseSensitive, scrollToIndex, profile }) =>
    jsonResult(await callProfileExtension(profile, "find_in_page", { tabId, query, caseSensitive, scrollToIndex }))
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

server.registerTool(
  "browser_select_option",
  {
    description: "Deterministically select an option from a <select> dropdown element by value, visible text label, or index.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().describe("Ref (e.g. 'ref_5') or CSS selector for the <select> element"),
      value: z.string().optional().describe("Option value to select"),
      label: z.string().optional().describe("Visible text label of option to select"),
      index: z.number().optional().describe("0-based index of option to select"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, value, label, index, profile }) =>
    jsonResult(await callProfileExtension(profile, "select_option", { tabId, target, value, label, index }))
);

server.registerTool(
  "browser_set_checked",
  {
    description: "Explicitly set a checkbox or radio input to checked (true) or unchecked (false) with visual feedback.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      target: z.string().describe("Ref (e.g. 'ref_9') or CSS selector for the checkbox or radio input"),
      checked: z.boolean().describe("Desired state: true to check, false to uncheck"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, checked, profile }) =>
    jsonResult(await callProfileExtension(profile, "set_checked", { tabId, target, checked }))
);

server.registerTool(
  "browser_download_file",
  {
    description: "Programmatically trigger a file download from a direct URL with custom filename and conflict handling.",
    inputSchema: {
      url: z.string().describe("URL of the file to download"),
      filename: z.string().optional().describe("Optional filename or relative path to save as"),
      conflictAction: z.enum(["uniquify", "overwrite", "prompt"]).optional().describe("File conflict action (default: 'uniquify')"),
      tabId: z.number().optional().describe("Optional active tabId to display visual download indicator"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ url, filename, conflictAction, tabId, profile }) =>
    jsonResult(await callProfileExtension(profile, "download_file", { url, filename, conflictAction, tabId }))
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
    description: "Capture a PNG or JPEG screenshot of a specific tab, full-page, or clipped to an element ref/selector.",
    inputSchema: {
      tabId: z.number().describe("The tabId to screenshot"),
      target: z.string().optional().describe("Optional element ref (e.g. 'ref_5') or CSS selector to clip screenshot to only that element"),
      fullPage: z.boolean().optional().describe("Whether to capture full scrollable page beyond current viewport"),
      format: z.enum(["png", "jpeg"]).optional().describe("Image format (default 'png')"),
      quality: z.number().optional().describe("Compression quality for jpeg (0 to 100) to save token context"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, target, fullPage, format, quality, profile }) => {
    const res = await callProfileExtension(profile, "screenshot", { tabId, target, fullPage, format, quality });
    return {
      content: [{ type: "image", data: res.base64Image || res.base64Png, mimeType: res.mimeType || "image/png" }],
    };
  }
);

server.registerTool(
  "browser_print_to_pdf",
  {
    description: "Generate and download a PDF document of the current tab via Chrome DevTools Page.printToPDF.",
    inputSchema: {
      tabId: z.number().describe("The tabId to print"),
      landscape: z.boolean().optional().describe("Paper orientation: true for landscape, false for portrait"),
      printBackground: z.boolean().optional().describe("Print background graphics (default true)"),
      scale: z.number().optional().describe("Scale of the webpage rendering (default 1)"),
      paperWidth: z.number().optional().describe("Paper width in inches (default 8.5)"),
      paperHeight: z.number().optional().describe("Paper height in inches (default 11)"),
      pageRanges: z.string().optional().describe("Paper ranges to print, e.g. '1-5, 8, 11-13'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, landscape, printBackground, scale, paperWidth, paperHeight, pageRanges, profile }) =>
    jsonResult(await callProfileExtension(profile, "print_to_pdf", { tabId, landscape, printBackground, scale, paperWidth, paperHeight, pageRanges }))
);

server.registerTool(
  "browser_wait_for_download",
  {
    description: "Wait for an active or triggered file download to finish, returning filename, saved path, size, and status.",
    inputSchema: {
      timeoutMs: z.number().optional().describe("Timeout in ms to wait for download to finish (default 30000)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ timeoutMs, profile }) => jsonResult(await callProfileExtension(profile, "wait_for_download", { timeoutMs }))
);

server.registerTool(
  "browser_list_downloads",
  {
    description: "List recent downloads in the browser profile (file name, size, MIME type, state, URL).",
    inputSchema: {
      limit: z.number().optional().describe("Maximum number of recent downloads to return (default 10)"),
      query: z.string().optional().describe("Optional search query string for filename or URL"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ limit, query, profile }) => jsonResult(await callProfileExtension(profile, "list_downloads", { limit, query }))
);

server.registerTool(
  "browser_request_human_takeover",
  {
    description: "Display an interactive takeover banner at the top of the user's active tab asking them to complete 2FA, solve a CAPTCHA, or provide manual approval, and pause until the user clicks 'Resume Agent'.",
    inputSchema: {
      tabId: z.number().describe("The tabId where intervention is needed"),
      reason: z.string().describe("Clear message displayed to user explaining why agent is paused (e.g. 'Please complete SMS 2FA')"),
      timeoutMs: z.number().optional().describe("Timeout in ms to wait for user resumption (default 120000 = 2 minutes)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, reason, timeoutMs, profile }) =>
    jsonResult(await callProfileExtension(profile, "request_human_takeover", { tabId, reason, timeoutMs }))
);

server.registerTool(
  "browser_clipboard",
  {
    description: "Read or write to the system clipboard in the tab context without requiring manual focus.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      operation: z.enum(["get", "set"]).describe("Operation: 'get' to read clipboard or 'set' to write text to clipboard"),
      text: z.string().optional().describe("Text to write if operation is 'set'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, operation, text, profile }) =>
    jsonResult(await callProfileExtension(profile, "clipboard", { tabId, operation, text }))
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

// ---------------------------------------------------------------------------
// Network Interception, Ad-Blocking & Routing
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_block_urls",
  {
    description: "Block specific URL patterns (e.g. ['*analytics*', '*ads*', '*.gif']) via CDP Network.setBlockedURLs to accelerate browsing and eliminate ad distractions.",
    inputSchema: {
      tabId: z.number().describe("The tabId to block URLs in"),
      patterns: z.union([z.string(), z.array(z.string())]).describe("URL pattern(s) with wildcards to block"),
      clear: z.boolean().optional().describe("Set true to clear all blocked URL patterns"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, patterns, clear, profile }) =>
    jsonResult(await callProfileExtension(profile, "block_urls", { tabId, patterns, clear }))
);

server.registerTool(
  "browser_set_extra_headers",
  {
    description: "Inject custom HTTP headers into all outgoing requests in a tab (e.g. Authorization, X-Custom-Header, staging cookies).",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      headers: z.record(z.string()).describe("Object of { headerName: headerValue }"),
      clear: z.boolean().optional().describe("Set true to clear custom extra headers"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, headers, clear, profile }) =>
    jsonResult(await callProfileExtension(profile, "set_extra_headers", { tabId, headers, clear }))
);

server.registerTool(
  "browser_mock_route",
  {
    description: "Intercept HTTP requests matching a URL pattern and return custom mock status, headers, and response body via CDP Fetch.",
    inputSchema: {
      tabId: z.number().describe("The tabId to apply mock route to"),
      urlPattern: z.string().optional().describe("URL pattern to match (e.g. '*/api/user*', 'https://example.com/data.json')"),
      status: z.number().optional().describe("HTTP response status code (default: 200)"),
      headers: z.record(z.string()).optional().describe("Custom response headers object"),
      responseBody: z.any().optional().describe("Mock response body (string or JSON object)"),
      clear: z.boolean().optional().describe("Set true to disable mock routing on this tab"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, urlPattern, status, headers, responseBody, clear, profile }) =>
    jsonResult(await callProfileExtension(profile, "mock_route", { tabId, urlPattern, status, headers, responseBody, clear }))
);

// ---------------------------------------------------------------------------
// User Context (Bookmarks, History & Desktop Notifications)
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_search_bookmarks",
  {
    description: "Search personal browser bookmarks by query string or keyword.",
    inputSchema: {
      query: z.string().describe("Search query string"),
      limit: z.number().optional().describe("Maximum number of results to return (default 50)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ query, limit, profile }) =>
    jsonResult(await callProfileExtension(profile, "search_bookmarks", { query, limit }))
);

server.registerTool(
  "browser_add_bookmark",
  {
    description: "Create a new bookmark in the user's browser with title and URL.",
    inputSchema: {
      title: z.string().describe("Title for the bookmark"),
      url: z.string().describe("URL to bookmark"),
      parentId: z.string().optional().describe("Optional ID of the folder to save into"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ title, url, parentId, profile }) =>
    jsonResult(await callProfileExtension(profile, "add_bookmark", { title, url, parentId }))
);

server.registerTool(
  "browser_search_history",
  {
    description: "Search user's browser browsing history by query keyword and time range.",
    inputSchema: {
      query: z.string().describe("Search keyword in history"),
      limit: z.number().optional().describe("Maximum results (default 50)"),
      startTime: z.number().optional().describe("Start timestamp in ms (default: 7 days ago)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ query, limit, startTime, profile }) =>
    jsonResult(await callProfileExtension(profile, "search_history", { query, limit, startTime }))
);

server.registerTool(
  "browser_show_notification",
  {
    description: "Display a native OS desktop notification from the browser (ideal for alerting user when a background agent task finishes).",
    inputSchema: {
      title: z.string().describe("Notification title"),
      message: z.string().describe("Notification body message text"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ title, message, profile }) =>
    jsonResult(await callProfileExtension(profile, "show_notification", { title, message }))
);

// ---------------------------------------------------------------------------
// Media Controls (Audio & Video)
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_media_control",
  {
    description: "Control video/audio playback on active page (play, pause, toggle, mute, unmute, seek, set_volume, set_speed).",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      action: z.enum(["play", "pause", "toggle", "mute", "unmute", "seek", "set_volume", "set_speed"]).describe("Media action to perform"),
      value: z.number().optional().describe("Numeric parameter (seconds for seek, 0-1 for volume, 0.25-4 for speed)"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, action, value, profile }) =>
    jsonResult(await callProfileExtension(profile, "media_control", { tabId, action, value }))
);

server.registerTool(
  "browser_mute_tab",
  {
    description: "Mute or unmute audio on any open browser tab.",
    inputSchema: {
      tabId: z.number().describe("The tabId to mute or unmute"),
      muted: z.boolean().describe("True to mute audio, false to unmute"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, muted, profile }) =>
    jsonResult(await callProfileExtension(profile, "mute_tab", { tabId, muted }))
);

server.registerTool(
  "browser_get_subtitles",
  {
    description: "Extract live captions, subtitles, or text tracks from active video players on the page (e.g. YouTube, media players).",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) =>
    jsonResult(await callProfileExtension(profile, "get_subtitles", { tabId }))
);

// ---------------------------------------------------------------------------
// Tab & Window Ergonomics
// ---------------------------------------------------------------------------
server.registerTool(
  "browser_duplicate_tab",
  {
    description: "Duplicate an existing tab with its state and history.",
    inputSchema: {
      tabId: z.number().describe("The tabId to duplicate"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, profile }) =>
    jsonResult(await callProfileExtension(profile, "duplicate_tab", { tabId }))
);

server.registerTool(
  "browser_pin_tab",
  {
    description: "Pin or unpin a tab to dock it in the browser tab strip.",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      pinned: z.boolean().describe("True to pin, false to unpin"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, pinned, profile }) =>
    jsonResult(await callProfileExtension(profile, "pin_tab", { tabId, pinned }))
);

server.registerTool(
  "browser_set_zoom",
  {
    description: "Get or set page zoom level (e.g. 1.0 = 100%, 1.25 = 125%, 0.8 = 80%).",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      zoomFactor: z.number().optional().describe("Zoom multiplier factor (e.g. 1.0, 1.25, 0.8). Omit to read current zoom."),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, zoomFactor, profile }) =>
    jsonResult(await callProfileExtension(profile, "set_zoom", { tabId, zoomFactor }))
);

server.registerTool(
  "browser_emulate_timezone",
  {
    description: "Override browser timezone using CDP Emulation (e.g. 'America/New_York', 'Asia/Tokyo', 'Europe/London').",
    inputSchema: {
      tabId: z.number().describe("The tabId"),
      timezoneId: z.string().describe("IANA timezone string, e.g. 'America/New_York' or 'Asia/Tokyo'"),
      profile: z.string().optional().describe("Optional profile name or ID"),
    },
  },
  async ({ tabId, timezoneId, profile }) =>
    jsonResult(await callProfileExtension(profile, "emulate_timezone", { tabId, timezoneId }))
);

// Connect MCP stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
log("Agent Bridge MCP Server v2.0 connected and ready with full DevTools capabilities!");
