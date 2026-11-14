// Agent Bridge MCP - Tab, Window & Profile Tools (ES Module)
import { z } from "zod";
import { activeProfiles, jsonResult } from "../core/state.js";
import { ensureMasterOrRelay, callProfileExtension } from "../core/bridge.js";

export function registerTabTools(server) {
  server.registerTool(
    "browser_list_profiles",
    {
      description: "List all currently connected browser profiles (e.g. Work, Personal, Brave, Edge), their IDs, names, and active status.",
    },
    async () => {
      await ensureMasterOrRelay();
      const profiles = Array.from(activeProfiles.values()).map((p) => ({
        id: p.id,
        name: p.name,
        browser: p.browser,
        connectedAt: new Date(p.connectedAt).toISOString(),
        lastActive: new Date(p.lastActive).toISOString(),
      }));
      return jsonResult({ count: profiles.length, profiles });
    }
  );

  server.registerTool(
    "browser_list_tabs",
    {
      description: "List all open tabs in a browser profile with their IDs, titles, URLs, active state, and debugger attachment status.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile name or ID (defaults to active/most recent)"),
      },
    },
    async ({ profile }) => {
      const tabs = await callProfileExtension(profile, "list_tabs");
      return jsonResult(tabs);
    }
  );

  server.registerTool(
    "browser_switch_tab",
    {
      description: "Switch to and focus a specific tab by tabId, bringing its browser window to the foreground.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to focus"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "switch_tab", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_new_tab",
    {
      description: "Open a new tab with an optional URL in the browser profile.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        url: z.string().optional().describe("URL to open (defaults to about:blank)"),
        active: z.boolean().optional().describe("Whether to immediately focus the tab (default true)"),
      },
    },
    async ({ profile, url, active }) => {
      const res = await callProfileExtension(profile, "new_tab", { url, active });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_close_tab",
    {
      description: "Close an open tab by tabId.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to close"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "close_tab", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_duplicate_tab",
    {
      description: "Duplicate an existing browser tab with all its history and loaded state.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to duplicate"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "duplicate_tab", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_pin_tab",
    {
      description: "Pin or unpin a tab to dock it in the browser's persistent tab strip.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to pin/unpin"),
        pinned: z.boolean().describe("Whether the tab should be pinned (true) or unpinned (false)"),
      },
    },
    async ({ profile, tabId, pinned }) => {
      const res = await callProfileExtension(profile, "pin_tab", { tabId, pinned });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_set_zoom",
    {
      description: "Get or set the zoom level factor for a browser tab (e.g. 1.0 for 100%, 1.25 for 125%, 0.8 for 80%).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("The ID of the tab to adjust zoom for"),
        zoomFactor: z.number().optional().describe("Zoom factor (e.g. 1.0, 1.25, 1.5). Omit to read current zoom factor."),
      },
    },
    async ({ profile, tabId, zoomFactor }) => {
      const res = await callProfileExtension(profile, "set_zoom", { tabId, zoomFactor });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_scroll",
    {
      description: "Scroll the page or a scrollable container in any direction (up, down, left, right, top, bottom) or scroll a specific ref/selector into view.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional().describe("Scroll direction (default 'down')"),
        distance: z.number().optional().describe("Scroll distance in pixels (default 500)"),
        target: z.string().optional().describe("Target element data-agent-ref (e.g. 'ref_1') or CSS selector to scroll into view or scroll inside"),
        smooth: z.boolean().optional().describe("Whether to animate scrolling smoothly (default false)"),
        x: z.number().optional().describe("Direct absolute X coordinate to scroll to"),
        y: z.number().optional().describe("Direct absolute Y coordinate to scroll to"),
      },
    },
    async ({ profile, tabId, direction, distance, target, smooth, x, y }) => {
      const res = await callProfileExtension(profile, "scroll", { tabId, direction, distance, target, smooth, x, y });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_read_all_tabs",
    {
      description: "Extract readable text content and titles from all open tabs in a single batch call. Fast multi-tab triage.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        maxLength: z.number().optional().describe("Max text characters per tab (default 4000)"),
      },
    },
    async ({ profile, maxLength }) => {
      const res = await callProfileExtension(profile, "read_all_tabs", { maxLength });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_manage_tab_group",
    {
      description: "Organize tabs into Chrome tab groups, colorize them, collapse/expand, or ungroup.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        action: z.enum(["group", "ungroup", "collapse", "expand"]).optional().describe("Action to perform (default 'group')"),
        tabIds: z.array(z.number()).describe("Array of tab IDs to group or ungroup"),
        title: z.string().optional().describe("Title for the tab group (e.g. 'Mercor Research')"),
        color: z.enum(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]).optional().describe("Color for the tab group"),
      },
    },
    async ({ profile, action, tabIds, title, color }) => {
      const res = await callProfileExtension(profile, "manage_tab_group", { action, tabIds, title, color });
      return jsonResult(res);
    }
  );
}

