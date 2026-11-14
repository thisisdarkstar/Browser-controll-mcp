// Agent Bridge MCP - Viewport, Emulation, Screenshots & PDF Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerEmulationTools(server) {
  server.registerTool(
    "browser_resize_page",
    {
      description: "Emulate viewport screen dimensions and device scale factor via CDP Emulation.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        width: z.number().describe("Viewport width in pixels (e.g. 1280)"),
        height: z.number().describe("Viewport height in pixels (e.g. 800)"),
        deviceScaleFactor: z.number().optional().describe("Device scale factor / DPR (default 1)"),
        mobile: z.boolean().optional().describe("Emulate mobile screen (default false)"),
      },
    },
    async ({ profile, tabId, width, height, deviceScaleFactor, mobile }) => {
      const res = await callProfileExtension(profile, "resize_page", { tabId, width, height, deviceScaleFactor, mobile });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_emulate",
    {
      description: "Emulate device color scheme, network throttling, CPU throttling, geolocation, or user agent.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        colorScheme: z.enum(["dark", "light", "no-preference"]).optional().describe("Emulate dark/light mode"),
        userAgent: z.string().optional().describe("Custom User-Agent override"),
        cpuThrottlingRate: z.number().optional().describe("CPU slowdown factor (1 = normal, 4 = 4x slowdown)"),
        geolocation: z.object({
          latitude: z.number(),
          longitude: z.number(),
          accuracy: z.number().optional(),
        }).optional().describe("Mock geolocation coordinates"),
        networkConditions: z.union([
          z.enum(["offline", "slow3g", "fast3g", "4g"]),
          z.object({
            offline: z.boolean(),
            latency: z.number(),
            downloadThroughput: z.number(),
            uploadThroughput: z.number(),
          }),
        ]).optional().describe("Network throttling preset or custom conditions"),
      },
    },
    async ({ profile, tabId, colorScheme, userAgent, cpuThrottlingRate, geolocation, networkConditions }) => {
      const res = await callProfileExtension(profile, "emulate", {
        tabId,
        colorScheme,
        userAgent,
        cpuThrottlingRate,
        geolocation,
        networkConditions,
      });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_emulate_timezone",
    {
      description: "Override browser timezone and locale for geolocation testing or internationalization.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        timezoneId: z.string().describe("IANA Timezone ID (e.g. 'America/New_York', 'Asia/Tokyo', 'Europe/London')"),
      },
    },
    async ({ profile, tabId, timezoneId }) => {
      const res = await callProfileExtension(profile, "emulate_timezone", { tabId, timezoneId });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_screenshot",
    {
      description: "Capture high-resolution screenshot (PNG or compressed JPEG), full page, or clipped to an element ref/selector.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        format: z.enum(["png", "jpeg"]).optional().describe("Image format (default 'png')"),
        quality: z.number().optional().describe("Compression quality 0-100 (for jpeg)"),
        fullPage: z.boolean().optional().describe("Capture entire scrollable page height (default false)"),
        target: z.string().optional().describe("Clip screenshot to this element ref (e.g. 'ref_1') or selector"),
      },
    },
    async ({ profile, tabId, format, quality, fullPage, target }) => {
      const res = await callProfileExtension(profile, "screenshot", { tabId, format, quality, fullPage, target });
      return {
        content: [
          {
            type: "image",
            data: res.dataBase64,
            mimeType: res.mimeType,
          },
        ],
      };
    }
  );

  server.registerTool(
    "browser_print_to_pdf",
    {
      description: "Generate a PDF document of the webpage via Chrome DevTools Page.printToPDF.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        landscape: z.boolean().optional().describe("Paper orientation landscape (default false)"),
        displayHeaderFooter: z.boolean().optional().describe("Display header and footer"),
        printBackground: z.boolean().optional().describe("Print background graphics (default true)"),
        scale: z.number().optional().describe("Scale factor 0.1 - 2.0 (default 1)"),
      },
    },
    async ({ profile, tabId, landscape, displayHeaderFooter, printBackground, scale }) => {
      const res = await callProfileExtension(profile, "print_to_pdf", { tabId, landscape, displayHeaderFooter, printBackground, scale });
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: `data:application/pdf;base64,${res.dataBase64}`,
              mimeType: res.mimeType,
              text: "PDF document generated successfully. Base64 encoded PDF.",
            },
          },
        ],
      };
    }
  );
}
