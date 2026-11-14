// Agent Bridge MCP - Diagnostics, Performance, Console & Raw CDP Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerDiagnosticTools(server) {
  server.registerTool(
    "browser_wait_for",
    {
      description: "Wait until a selector appears in DOM or text appears in document body (replaces arbitrary sleep timers).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        selector: z.string().optional().describe("CSS selector or ref to wait for"),
        text: z.string().optional().describe("Text string to wait for on page"),
        visible: z.boolean().optional().describe("Require element to be visible (default true)"),
        timeout: z.number().optional().describe("Timeout in milliseconds (default 10000)"),
      },
    },
    async ({ profile, tabId, selector, text, visible, timeout }) => {
      const res = await callProfileExtension(profile, "wait_for", { tabId, selector, text, visible, timeout });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_list_console_messages",
    {
      description: "List captured console messages (log, info, warn, error, uncaught exceptions) with arguments and stack traces.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        types: z.array(z.string()).optional().describe("Filter by type (e.g. ['error', 'warn'])"),
        limit: z.number().optional().describe("Max messages to return (default 100)"),
      },
    },
    async ({ profile, tabId, types, limit }) => {
      const res = await callProfileExtension(profile, "list_console_messages", { tabId, types, limit });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_telemetry",
    {
      description: "Combined telemetry snapshot: console logs, recent network requests, and dialog events for a tab in one call.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "get_telemetry", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_take_heapsnapshot",
    {
      description: "Capture V8 heap snapshot via DevTools HeapProfiler.takeHeapSnapshot for JavaScript memory leak diagnosis.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "take_heapsnapshot", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_performance_trace",
    {
      description: "Start or stop Chrome DevTools Tracing performance profile.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        action: z.enum(["start", "stop"]).describe("Action to perform"),
        categories: z.string().optional().describe("Trace categories string"),
      },
    },
    async ({ profile, tabId, action, categories }) => {
      const res = await callProfileExtension(profile, "performance_trace", { tabId, action, categories });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_performance_analyze_insight",
    {
      description: "Extract Core Web Vitals (TTFB, FCP, First Paint, DOMContentLoaded, Load Time, Transfer Size) for a tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "performance_analyze_insight", { tabId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_eval_js",
    {
      description: "Evaluate arbitrary JavaScript in the tab context with async/await support and return serialized result.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        code: z.string().describe("JavaScript code string to evaluate"),
        useDebugger: z.boolean().optional().describe("Use Runtime.evaluate over CDP (default false)"),
      },
    },
    async ({ profile, tabId, code, useDebugger }) => {
      const res = await callProfileExtension(profile, "eval_js", { tabId, code, useDebugger });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_raw_cdp",
    {
      description: "Ultimate escape hatch: execute ANY raw Chrome DevTools Protocol command with arbitrary parameters on a tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        method: z.string().describe("CDP method name (e.g. 'Page.captureScreenshot', 'DOM.getDocument', 'Network.clearBrowserCache')"),
        commandParams: z.record(z.any()).optional().describe("Parameters for the CDP command"),
      },
    },
    async ({ profile, tabId, method, commandParams }) => {
      const res = await callProfileExtension(profile, "raw_cdp", { tabId, method, commandParams });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_request_human_takeover",
    {
      description: "Pause agent execution and display a prominent interactive takeover banner in the browser for manual 2FA, CAPTCHA, or payment confirmation. Resumes automatically when user clicks 'Resume Agent' or timeout expires.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        reason: z.string().optional().describe("Brief message shown to the user explaining what they need to complete (e.g. 'Please complete 2FA on screen')"),
        timeoutSeconds: z.number().optional().describe("Maximum seconds to pause before timing out (default 300)"),
      },
    },
    async ({ profile, tabId, reason, timeoutSeconds }) => {
      const res = await callProfileExtension(profile, "request_human_takeover", { tabId, reason, timeoutSeconds });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_reload_extension",
    {
      description: "Hot reload the Agent Bridge Chrome extension service worker in the browser profile.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
      },
    },
    async ({ profile }) => {
      const res = await callProfileExtension(profile, "reload_extension");
      return jsonResult(res);
    }
  );
}

