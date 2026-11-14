// Agent Bridge MCP - Server State & Configuration (ES Module)
import path from "path";
import os from "os";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(__dirname, "../../extension");
export const PORT = Number(process.env.MCP_BROWSER_PORT) || 18922;
export const AUTO_SPAWN = process.env.AUTO_SPAWN === "true";

// Track connected browser profiles: profileId -> { id, name, browser, ws, lastActive, tabCount }
export const activeProfiles = new Map();
export const pendingRequests = new Map();

export const serverState = {
  isMasterServer: false,
  httpServer: null,
  wss: null,
  browserProcess: null,
};

export function log(...args) {
  console.error("[Agent Bridge MCP]", ...args);
}

export function jsonResult(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

export function resolveChromeBinary() {
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

export function spawnIsolatedBrowser() {
  if (serverState.browserProcess) return;
  const profileDir = path.join(os.homedir(), ".agent-browser-profile");
  const chromeBin = resolveChromeBinary();
  log(`Spawning isolated fallback Chrome instance at ${profileDir}...`);

  serverState.browserProcess = spawn(
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
  serverState.browserProcess.unref();
}

