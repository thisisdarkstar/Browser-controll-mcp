// Agent Bridge MCP - Smart Content, Markdown & Table Extraction Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerExtractionTools(server) {
  server.registerTool(
    "browser_get_markdown",
    {
      description: "Convert an entire webpage or a specific CSS container into clean, structured GitHub-flavored Markdown (stripping navbars, scripts, ads, and style bloat). Extremely token-efficient for LLM context windows.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        selector: z.string().optional().describe("Optional container ref or CSS selector to extract markdown from (defaults to entire page body)"),
        includeLinks: z.boolean().optional().describe("Whether to preserve hyperlinks in markdown format (default true)"),
        includeImages: z.boolean().optional().describe("Whether to preserve image alt/src in markdown format (default false)"),
        maxLength: z.number().optional().describe("Maximum character length to return (default 50000)"),
      },
    },
    async ({ profile, tabId, selector, includeLinks, includeImages, maxLength }) => {
      const res = await callProfileExtension(profile, "get_markdown", {
        tabId,
        selector,
        includeLinks,
        includeImages,
        maxLength,
      });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_extract_table",
    {
      description: "Automatically detect and extract data from <table> elements or repeating grid layouts into clean structured JSON, CSV, or Markdown tables.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().optional().describe("Optional table element ref or selector. If omitted, extracts all tables on the page."),
        format: z.enum(["json", "csv", "markdown"]).optional().describe("Output data format (default 'json')"),
      },
    },
    async ({ profile, tabId, target, format }) => {
      const res = await callProfileExtension(profile, "extract_table", { tabId, target, format });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_find_in_page",
    {
      description: "Search for text on the page (matching browser Ctrl+F), returning count of occurrences, surrounding text snippets, and optionally scrolling the matched occurrence into view.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        query: z.string().describe("Search term or text to find"),
        caseSensitive: z.boolean().optional().describe("Whether the search is case-sensitive (default false)"),
        matchIndex: z.number().optional().describe("Zero-based index of the specific match to scroll to (default 0)"),
        scrollToMatch: z.boolean().optional().describe("Whether to scroll to the matched element with visual highlight (default true)"),
      },
    },
    async ({ profile, tabId, query, caseSensitive, matchIndex, scrollToMatch }) => {
      const res = await callProfileExtension(profile, "find_in_page", {
        tabId,
        query,
        caseSensitive,
        matchIndex,
        scrollToMatch,
      });
      return jsonResult(res);
    }
  );
}

