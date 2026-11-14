// Agent Bridge MCP - Navigation Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerNavigationTools(server) {
  server.registerTool(
    "browser_navigate",
    {
      description: "Navigate an existing tab or open a new one to a specific URL with customizable ready wait conditions.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().optional().describe("Existing tabId to navigate. Omit to open and navigate a new tab."),
        url: z.string().describe("Target URL to navigate to"),
        waitFor: z.enum(["load", "domcontentloaded", "none"]).optional().describe("Wait condition (default 'load')"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds (default 15000)"),
      },
    },
    async ({ profile, tabId, url, waitFor, timeoutMs }) => {
      const res = await callProfileExtension(profile, "navigate_or_open", { tabId, url, waitFor, timeoutMs });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_go_back",
    {
      description: "Navigate back in browser history for a specific tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to navigate back"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "go_back", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_go_forward",
    {
      description: "Navigate forward in browser history for a specific tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to navigate forward"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "go_forward", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_reload",
    {
      description: "Reload a specific tab with optional cache bypass.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        ignoreCache: z.boolean().optional().describe("Whether to hard reload bypassing cache (default false)"),
      },
    },
    async ({ profile, tabId, ignoreCache }) => {
      const res = await callProfileExtension(profile, "reload_tab", { tabId, ignoreCache });
      return jsonResult(res);
    }
  );
}
