// Agent Bridge MCP - Modular Background Service Worker Entrypoint (Manifest V3 ES Module)
import { state, initProfile, updateBadge, detectBrowser } from "./core/state.js";
import { initCdpListeners } from "./core/cdp.js";
import { connectWebSocket, initKeepalive } from "./core/ws.js";
import { handleRpc } from "./actions/index.js";
import { injectAgentVisualCue } from "./ui/hud.js";

// 1. Initialize CDP Debugger Event Listeners
initCdpListeners();

// 2. Lifecycle Handlers
chrome.runtime.onInstalled.addListener(async () => {
  await initProfile();
  initKeepalive(handleRpc);
  connectWebSocket(handleRpc);
});

chrome.runtime.onStartup.addListener(async () => {
  await initProfile();
  initKeepalive(handleRpc);
  connectWebSocket(handleRpc);
});

// 3. Extension Popup UI Communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getStatus") {
    Promise.all([
      chrome.tabs.query({}),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]).then(([tabs, activeTabs]) => {
      const activeTab = activeTabs && activeTabs[0]
        ? {
            id: activeTabs[0].id,
            title: activeTabs[0].title || "Untitled",
            url: activeTabs[0].url || "about:blank",
            favIconUrl: activeTabs[0].favIconUrl || "",
            debuggerAttached: state.attachedTabs.has(activeTabs[0].id),
          }
        : null;

      sendResponse({
        connected: Boolean(state.wsSocket && state.wsSocket.readyState === WebSocket.OPEN),
        profileId: state.profileId,
        profileName: state.profileName,
        wsPort: state.currentPort,
        agentControlEnabled: state.agentControlEnabled,
        tabCount: tabs.length,
        browser: detectBrowser(),
        debuggerAttachedCount: state.attachedTabs.size,
        totalActions: state.totalActionCount,
        isBusy: state.activeRpcCount > 0,
        currentAction: state.currentExecutingAction,
        lastActionTime: state.lastAgentActionTime,
        activeTab,
      });
    });
    return true;
  }

  if (request.action === "testHighlight") {
    if (!request.tabId) {
      sendResponse({ success: false, error: "Missing tabId" });
      return true;
    }
    handleRpc("get_interactive_snapshot", { tabId: request.tabId })
      .then(async (res) => {
        if (res && res.list && res.list.length > 0) {
          const first = res.list[0];
          await injectAgentVisualCue(request.tabId, {
            type: "click",
            x: first.bounds ? first.bounds.x : 100,
            y: first.bounds ? first.bounds.y : 100,
            rect: first.bounds
              ? {
                  x: first.bounds.x - Math.round(first.bounds.w / 2),
                  y: first.bounds.y - Math.round(first.bounds.h / 2),
                  width: first.bounds.w,
                  height: first.bounds.h,
                }
              : null,
            label: `Agent Bridge: ${res.count} interactive targets identified`,
          });
        }
        sendResponse({ success: true, count: res.count });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "getRecentActions") {
    sendResponse({
      actions: state.recentActions,
      totalCount: state.totalActionCount,
    });
    return true;
  }

  if (request.action === "clearRecentActions") {
    state.recentActions.length = 0;
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "getTabs") {
    chrome.tabs.query({}).then((tabs) => {
      sendResponse(
        tabs.map((t) => ({
          id: t.id,
          title: t.title || "Untitled",
          url: t.url || "about:blank",
          favIconUrl: t.favIconUrl || "",
          active: t.active,
          windowId: t.windowId,
          debuggerAttached: state.attachedTabs.has(t.id),
        }))
      );
    });
    return true;
  }

  if (request.action === "focusTab") {
    chrome.tabs.update(request.tabId, { active: true }, () => {
      if (request.windowId) {
        chrome.windows.update(request.windowId, { focused: true });
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "closeTab") {
    chrome.tabs.remove(request.tabId, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "createTab") {
    chrome.tabs.create({ url: request.url || "about:blank" }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (request.action === "pingMaster") {
    fetch(`http://127.0.0.1:${state.currentPort}/health`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.action === "updateConfig") {
    const { newProfileName, newPort, newEnabled } = request;
    const updates = {};

    if (newProfileName !== undefined && newProfileName !== state.profileName) {
      state.profileName = newProfileName.trim() || state.profileName;
      updates.profileName = state.profileName;
    }

    if (newEnabled !== undefined && newEnabled !== state.agentControlEnabled) {
      state.agentControlEnabled = Boolean(newEnabled);
      updates.agentControlEnabled = state.agentControlEnabled;
    }

    let portChanged = false;
    if (newPort !== undefined && Number(newPort) && Number(newPort) !== state.currentPort) {
      state.currentPort = Number(newPort);
      updates.wsPort = state.currentPort;
      portChanged = true;
    }

    chrome.storage.local.set(updates).then(() => {
      updateBadge();
      if (portChanged) {
        if (state.wsSocket) state.wsSocket.close();
        connectWebSocket(handleRpc);
      } else if (state.wsSocket && state.wsSocket.readyState === WebSocket.OPEN) {
        state.wsSocket.send(
          JSON.stringify({
            type: "register",
            profileId: state.profileId,
            profileName: state.profileName,
            browser: detectBrowser(),
            timestamp: Date.now(),
          })
        );
      }
      sendResponse({ success: true, profileName: state.profileName, currentPort: state.currentPort, agentControlEnabled: state.agentControlEnabled });
    });
    return true;
  }

  if (request.action === "reconnect") {
    if (state.wsSocket) state.wsSocket.close();
    connectWebSocket(handleRpc);
    sendResponse({ success: true });
    return true;
  }
});

// 4. Initial Bootstrap
initProfile().then(() => {
  initKeepalive(handleRpc);
  connectWebSocket(handleRpc);
});
