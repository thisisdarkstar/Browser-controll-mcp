// Agent Bridge MCP - Navigation Actions (ES Module)
import { injectAgentVisualCue } from "../ui/hud.js";
import { waitForTabReady, attachDebuggerIfNeeded } from "../core/cdp.js";

export const navigationActions = {
  async navigate_or_open(params) {
    let targetTabId = params.tabId;
    if (targetTabId) {
      await chrome.tabs.update(targetTabId, {
        url: params.url,
        active: params.active ?? true,
      });
    } else {
      const tab = await chrome.tabs.create({
        url: params.url,
        active: params.active ?? true,
      });
      targetTabId = tab.id;
    }

    if (params.waitFor && params.waitFor !== "none") {
      await waitForTabReady(targetTabId, params.waitFor, params.timeoutMs || 15000);
    }

    await injectAgentVisualCue(targetTabId, {
      type: "navigate",
      label: `Navigating: ${params.url}`,
    });

    return { success: true, navigated: true, tabId: targetTabId, id: targetTabId, url: params.url };
  },

  async go_back(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    try {
      await chrome.tabs.goBack(params.tabId);
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: () => window.history.back(),
      });
    }
    await injectAgentVisualCue(params.tabId, {
      type: "navigate",
      label: "Navigating Back",
    });
    return { success: true, tabId: params.tabId, navigated: "back" };
  },

  async go_forward(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    try {
      await chrome.tabs.goForward(params.tabId);
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: () => window.history.forward(),
      });
    }
    await injectAgentVisualCue(params.tabId, {
      type: "navigate",
      label: "Navigating Forward",
    });
    return { success: true, tabId: params.tabId, navigated: "forward" };
  },

  async reload_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    await attachDebuggerIfNeeded(params.tabId);
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Page.reload", {
      ignoreCache: params.ignoreCache ?? false,
    });
    await injectAgentVisualCue(params.tabId, {
      type: "navigate",
      label: "Reloading Page",
    });
    return { success: true, tabId: params.tabId, reloaded: true };
  },
};
