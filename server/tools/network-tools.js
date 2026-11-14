// Agent Bridge MCP - Network, Cookies, Storage & Routing Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerNetworkTools(server) {
  server.registerTool(
    "browser_list_network_requests",
    {
      description: "List captured network requests for a tab (status, method, url, resourceType, mimeType, timestamp).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        limit: z.number().optional().describe("Max requests to return (default 50)"),
      },
    },
    async ({ profile, tabId, limit }) => {
      const res = await callProfileExtension(profile, "list_network_requests", { tabId, limit });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_network_request",
    {
      description: "Get full details and request/response headers for a recorded requestId.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        requestId: z.string().describe("The requestId returned by browser_list_network_requests"),
      },
    },
    async ({ profile, tabId, requestId }) => {
      const res = await callProfileExtension(profile, "get_network_request", { tabId, requestId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_network_body",
    {
      description: "Fetch the raw response body of a network request via CDP Network.getResponseBody.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        requestId: z.string().describe("The requestId"),
      },
    },
    async ({ profile, tabId, requestId }) => {
      const res = await callProfileExtension(profile, "get_network_body", { tabId, requestId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_cookies",
    {
      description: "Retrieve cookies for the browser profile or filtered by URLs.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        urls: z.union([z.string(), z.array(z.string())]).optional().describe("URL(s) to filter cookies by"),
      },
    },
    async ({ profile, urls }) => {
      const res = await callProfileExtension(profile, "get_cookies", { urls });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_set_cookie",
    {
      description: "Set a cookie in the active browser profile.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        url: z.string().describe("The request-URI with which the cookie will be associated"),
        name: z.string().describe("Cookie name"),
        value: z.string().describe("Cookie value"),
        domain: z.string().optional().describe("Cookie domain"),
        path: z.string().optional().describe("Cookie path"),
        secure: z.boolean().optional().describe("HTTPS only"),
        httpOnly: z.boolean().optional().describe("HttpOnly flag"),
        sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]).optional(),
        expirationDate: z.number().optional().describe("Expiration timestamp in seconds"),
      },
    },
    async ({ profile, url, name, value, domain, path, secure, httpOnly, sameSite, expirationDate }) => {
      const res = await callProfileExtension(profile, "set_cookie", {
        url,
        name,
        value,
        domain,
        path,
        secure,
        httpOnly,
        sameSite,
        expirationDate,
      });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_clear_cookies",
    {
      description: "Clear all cookies stored in the current browser profile.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
      },
    },
    async ({ profile }) => {
      const res = await callProfileExtension(profile, "clear_cookies");
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_storage",
    {
      description: "Read, write, or clear localStorage or sessionStorage in a tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        type: z.enum(["local", "session"]).optional().describe("Storage type (default 'local')"),
        action: z.enum(["get", "set", "remove", "clear"]).optional().describe("Storage action (default 'get')"),
        key: z.string().optional().describe("Storage item key"),
        value: z.any().optional().describe("Value to set"),
      },
    },
    async ({ profile, tabId, type, action, key, value }) => {
      const res = await callProfileExtension(profile, "storage", { tabId, type, action, key, value });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_block_urls",
    {
      description: "Block network requests matching specific URL wildcard patterns (e.g. ['*google-analytics*', '*ads*', '*.png']) via CDP Network.setBlockedURLs.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        patterns: z.union([z.string(), z.array(z.string())]).optional().describe("URL pattern(s) with wildcards to block"),
        clear: z.boolean().optional().describe("If true, removes all URL blocking rules on this tab"),
      },
    },
    async ({ profile, tabId, patterns, clear }) => {
      const res = await callProfileExtension(profile, "block_urls", { tabId, patterns, clear });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_set_extra_headers",
    {
      description: "Inject custom HTTP headers (e.g. Authorization, custom API keys, mock cookies) into all outgoing HTTP requests on a tab via CDP Network.setExtraHTTPHeaders.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        headers: z.record(z.string()).optional().describe("Key-value dictionary of HTTP header names and values to inject"),
        clear: z.boolean().optional().describe("If true, clears all custom headers on this tab"),
      },
    },
    async ({ profile, tabId, headers, clear }) => {
      const res = await callProfileExtension(profile, "set_extra_headers", { tabId, headers, clear });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_mock_route",
    {
      description: "Intercept HTTP network requests matching a URL pattern and return custom mock status codes, headers, and response bodies via CDP Fetch interception.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        urlPattern: z.string().optional().describe("URL pattern to intercept (e.g. '*api/v1/user*', 'https://api.example.com/*')"),
        responseBody: z.any().optional().describe("Mock response body string or JSON object"),
        status: z.number().optional().describe("HTTP response status code (default 200)"),
        headers: z.record(z.string()).optional().describe("Custom HTTP response headers"),
        clear: z.boolean().optional().describe("If true, disables Fetch interception and clears all mock routes for this tab"),
      },
    },
    async ({ profile, tabId, urlPattern, responseBody, status, headers, clear }) => {
      const res = await callProfileExtension(profile, "mock_route", {
        tabId,
        urlPattern,
        responseBody,
        status,
        headers,
        clear,
      });
      return jsonResult(res);
    }
  );
}

