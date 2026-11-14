// Agent Bridge MCP - CDP Debugger Session & Event Listeners (ES Module)
import { state, ensureTabStore } from "./state.js";

export async function attachDebuggerIfNeeded(tabId) {
  if (state.attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    state.attachedTabs.add(tabId);
    ensureTabStore(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch (err) {
    console.warn(`[Agent Bridge] Debugger attach error on tab ${tabId}:`, err);
  }
}

export function waitForTabReady(tabId, mode = "load", timeoutMs = 15000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(tabListener);
        resolve({ ready: false, timedOut: true });
      }
    }, timeoutMs);

    function tabListener(updatedId, changeInfo) {
      if (updatedId === tabId) {
        if (mode === "domcontentloaded" && (changeInfo.status === "loading" || changeInfo.status === "complete")) {
          finish(true);
        } else if (changeInfo.status === "complete") {
          finish(true);
        }
      }
    }

    function finish(ok) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(tabListener);
        setTimeout(() => resolve({ ready: ok }), 250);
      }
    }

    chrome.tabs.onUpdated.addListener(tabListener);
  });
}

export function initCdpListeners() {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!tabId) return;
    const store = ensureTabStore(tabId);

    if (method === "Runtime.consoleAPICalled") {
      store.console.push({
        id: "console_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        type: params.type,
        timestamp: params.timestamp,
        args: (params.args || []).map((a) => a.value ?? a.description ?? a.type),
        stackTrace: params.stackTrace,
      });
      if (store.console.length > 500) store.console.shift();
    } else if (method === "Runtime.exceptionThrown") {
      store.console.push({
        id: "exc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        type: "error",
        timestamp: params.timestamp,
        details: params.exceptionDetails?.text || "Uncaught exception",
        url: params.exceptionDetails?.url,
        lineNumber: params.exceptionDetails?.lineNumber,
        stackTrace: params.exceptionDetails?.stackTrace,
      });
      if (store.console.length > 500) store.console.shift();
    } else if (method === "Network.requestWillBeSent") {
      store.network.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData,
        type: params.type,
        status: "pending",
        timestamp: params.timestamp,
        wallTime: params.wallTime,
      });
      if (store.network.size > 500) {
        const oldestKey = store.network.keys().next().value;
        store.network.delete(oldestKey);
      }
    } else if (method === "Network.responseReceived") {
      const req = store.network.get(params.requestId) || { requestId: params.requestId };
      req.status = params.response.status;
      req.statusText = params.response.statusText;
      req.mimeType = params.response.mimeType;
      req.responseHeaders = params.response.headers;
      req.timing = params.response.timing;
      store.network.set(params.requestId, req);
    } else if (method === "Fetch.requestPaused") {
      const mocks = state.tabMockRoutes.get(tabId) || [];
      const reqUrl = params.request.url;
      const matched = mocks.find((m) => {
        if (m.urlPattern.includes("*")) {
          const regex = new RegExp("^" + m.urlPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
          return regex.test(reqUrl);
        }
        return reqUrl.includes(m.urlPattern);
      });

      if (matched) {
        const headersList = Object.entries(matched.headers || {}).map(([name, value]) => ({
          name,
          value: String(value),
        }));
        if (!headersList.some((h) => h.name.toLowerCase() === "content-type")) {
          headersList.push({ name: "Content-Type", value: "application/json; charset=utf-8" });
        }
        chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: matched.status || 200,
          responseHeaders: headersList,
          body: matched.bodyBase64,
        }).catch(() => {});
      } else {
        chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
          requestId: params.requestId,
        }).catch(() => {});
      }
    } else if (method === "Page.javascriptDialogOpening") {
      store.dialogs.push({
        type: params.type,
        message: params.message,
        defaultPrompt: params.defaultPrompt,
        url: params.url,
        timestamp: Date.now(),
      });
    } else if (method === "Tracing.dataCollected") {
      if (Array.isArray(params.value)) {
        state.activeTraceEvents.push(...params.value);
      }
    }
  });

  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      state.attachedTabs.delete(source.tabId);
      state.tabMockRoutes.delete(source.tabId);
    }
  });
}

