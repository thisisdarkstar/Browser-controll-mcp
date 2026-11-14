// Agent Bridge MCP - Media Player, Subtitles & Audio Actions (ES Module)
import { injectAgentVisualCue } from "../ui/hud.js";

export const mediaActions = {
  async media_control(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const action = params.action || "toggle";
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [action, params.value],
      func: (act, val) => {
        const media = document.querySelector("video, audio");
        if (!media) return { error: "No <video> or <audio> element found on page." };

        if (act === "play") media.play();
        else if (act === "pause") media.pause();
        else if (act === "toggle") {
          if (media.paused) media.play();
          else media.pause();
        } else if (act === "mute") media.muted = true;
        else if (act === "unmute") media.muted = false;
        else if (act === "seek" && val !== undefined) media.currentTime = Number(val);
        else if (act === "set_volume" && val !== undefined) media.volume = Math.max(0, Math.min(1, Number(val)));
        else if (act === "set_speed" && val !== undefined) media.playbackRate = Math.max(0.25, Math.min(4, Number(val)));

        return {
          success: true,
          action: act,
          paused: media.paused,
          currentTime: Math.round(media.currentTime),
          duration: Math.round(media.duration || 0),
          muted: media.muted,
          volume: media.volume,
          playbackRate: media.playbackRate,
        };
      },
    });

    if (result.error) throw new Error(result.error);

    await injectAgentVisualCue(params.tabId, {
      label: `Media ${action}: ${result.paused ? "Paused" : "Playing"} (${result.currentTime}s)`,
    });

    return { success: true, tabId: params.tabId, ...result };
  },

  async mute_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const muted = Boolean(params.muted);
    await chrome.tabs.update(params.tabId, { muted });
    return { success: true, tabId: params.tabId, muted };
  },

  async get_subtitles(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      func: () => {
        const texts = [];
        document.querySelectorAll(".ytp-caption-segment").forEach((el) => texts.push(el.textContent.trim()));
        document.querySelectorAll("video").forEach((v) => {
          if (v.textTracks) {
            for (let i = 0; i < v.textTracks.length; i++) {
              const track = v.textTracks[i];
              if (track.activeCues) {
                for (let c = 0; c < track.activeCues.length; c++) {
                  texts.push(track.activeCues[c].text);
                }
              }
            }
          }
        });
        document.querySelectorAll("[class*='caption'], [class*='subtitle']").forEach((el) => {
          const t = el.textContent.trim();
          if (t && t.length < 200 && !texts.includes(t)) texts.push(t);
        });
        return { count: texts.length, subtitles: texts };
      },
    });
    return { success: true, tabId: params.tabId, ...result };
  },
};
