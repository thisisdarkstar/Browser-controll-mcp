// Agent Bridge MCP - Bookmarks, History, Notifications, Clipboard & Downloads Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerBrowserDataTools(server) {
  server.registerTool(
    "browser_search_bookmarks",
    {
      description: "Search the user's personal browser bookmarks by query keyword or folder name.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        query: z.string().optional().describe("Search keyword to match in title or URL. Empty string returns all recent bookmarks."),
        limit: z.number().optional().describe("Max bookmarks to return (default 50)"),
      },
    },
    async ({ profile, query, limit }) => {
      const res = await callProfileExtension(profile, "search_bookmarks", { query, limit });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_add_bookmark",
    {
      description: "Create a new bookmark in the user's browser with title and URL.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        title: z.string().describe("Title for the bookmark"),
        url: z.string().describe("Target webpage URL to bookmark"),
        parentId: z.string().optional().describe("Optional parent bookmark folder ID (defaults to 'Other bookmarks')"),
      },
    },
    async ({ profile, title, url, parentId }) => {
      const res = await callProfileExtension(profile, "add_bookmark", { title, url, parentId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_search_history",
    {
      description: "Search the user's browsing history by query keyword, date range, and visit counts.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        query: z.string().optional().describe("Search keyword in history titles or URLs"),
        limit: z.number().optional().describe("Max history items to return (default 50)"),
        startTime: z.number().optional().describe("Milliseconds timestamp to search after (defaults to 7 days ago)"),
      },
    },
    async ({ profile, query, limit, startTime }) => {
      const res = await callProfileExtension(profile, "search_history", { query, limit, startTime });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_show_notification",
    {
      description: "Display a native OS desktop notification from the browser (ideal for alerting user when a long-running agent task finishes).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        title: z.string().optional().describe("Notification title"),
        message: z.string().describe("Notification body message text"),
      },
    },
    async ({ profile, title, message }) => {
      const res = await callProfileExtension(profile, "show_notification", { title, message });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_download_file",
    {
      description: "Trigger a file download from a direct URL in the browser with customizable filename and conflict action.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().optional().describe("Optional tabId associated with the download"),
        url: z.string().describe("Direct URL of the file to download"),
        filename: z.string().optional().describe("Custom local filename or subpath"),
        saveAs: z.boolean().optional().describe("Whether to prompt user with save file dialog (default false)"),
        conflictAction: z.enum(["uniquify", "overwrite", "prompt"]).optional().describe("Action on duplicate filename (default 'uniquify')"),
      },
    },
    async ({ profile, tabId, url, filename, saveAs, conflictAction }) => {
      const res = await callProfileExtension(profile, "download_file", { tabId, url, filename, saveAs, conflictAction });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_wait_for_download",
    {
      description: "Wait for a file download to complete, returning its final filename and file size.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        downloadId: z.number().optional().describe("Specific download ID to wait for"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ profile, downloadId, timeoutMs }) => {
      const res = await callProfileExtension(profile, "wait_for_download", { downloadId, timeoutMs });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_list_downloads",
    {
      description: "List recent downloads in the browser profile (status, file path, bytes received).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        limit: z.number().optional().describe("Max downloads to return (default 20)"),
        state: z.enum(["in_progress", "interrupted", "complete"]).optional().describe("Filter by state"),
      },
    },
    async ({ profile, limit, state }) => {
      const res = await callProfileExtension(profile, "list_downloads", { limit, state });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_clipboard",
    {
      description: "Read or copy text directly to/from the system clipboard in the active tab context.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        operation: z.enum(["get", "set"]).optional().describe("'get' to read clipboard, 'set' to copy text (default 'get')"),
        text: z.string().optional().describe("Text string to write when operation is 'set'"),
      },
    },
    async ({ profile, tabId, operation, text }) => {
      const res = await callProfileExtension(profile, "clipboard", { tabId, operation, text });
      return jsonResult(res);
    }
  );
}
