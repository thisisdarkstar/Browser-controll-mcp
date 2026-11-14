// Agent Bridge MCP - Media Player, Subtitles & Audio Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerMediaTools(server) {
  server.registerTool(
    "browser_media_control",
    {
      description: "Control audio and video elements on the page: play, pause, toggle, mute, seek, change volume, or adjust playback speed.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        action: z.enum(["play", "pause", "toggle", "mute", "unmute", "seek", "set_volume", "set_speed"]).describe("Media action to execute"),
        value: z.union([z.number(), z.string()]).optional().describe("Parameter value (seconds for 'seek', 0.0-1.0 for 'set_volume', 0.25-4.0 for 'set_speed')"),
      },
    },
    async ({ profile, tabId, action, value }) => {
      const res = await callProfileExtension(profile, "media_control", { tabId, action, value });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_mute_tab",
    {
      description: "Mute or unmute all audio output for an entire browser tab.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        muted: z.boolean().describe("Whether the tab should be muted (true) or unmuted (false)"),
      },
    },
    async ({ profile, tabId, muted }) => {
      const res = await callProfileExtension(profile, "mute_tab", { tabId, muted });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_subtitles",
    {
      description: "Extract current live captions, active subtitles, and text tracks from video players on the page (YouTube, Coursera, video players).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
      },
    },
    async ({ profile, tabId }) => {
      const res = await callProfileExtension(profile, "get_subtitles", { tabId });
      return jsonResult(res);
    }
  );
}

