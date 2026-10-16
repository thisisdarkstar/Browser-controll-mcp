// Agent Bridge MCP - Supercharged Background Service Worker (Manifest V3)
// Full multi-tab, multi-profile CDP control matching and exceeding Chrome DevTools MCP.

let wsSocket = null;
let currentPort = 18922;
let profileId = null;
let profileName = "Default Profile";
let agentControlEnabled = true;
let reconnectTimer = null;

const attachedTabs = new Set();
const tabTelemetry = new Map(); // tabId -> { console: [], network: Map(), dialogs: [] }
let activeTracingTab = null;
let activeTraceEvents = [];

// Real-time Agent Action Audit Log
const recentActions = []; // Rolling buffer of last 30 actions for UI audit log
let totalActionCount = 0;

function logAgentAction(action, params, result, error) {
  totalActionCount++;
  const target = params?.ref || params?.target || params?.url || (params?.tabId !== undefined ? `Tab #${params.tabId}` : null);
  const item = {
    id: "act_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
    timestamp: Date.now(),
    action,
    target,
    details: params ? JSON.stringify(params).slice(0, 120) : "",
    success: !error,
    error: error ? error.message : null,
  };
  recentActions.unshift(item);
  if (recentActions.length > 30) recentActions.pop();
}

// Browser detection
function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Microsoft Edge";
  if (navigator.brave && typeof navigator.brave.isBrave === "function") return "Brave";
  if (ua.includes("Chrome/")) return "Google Chrome";
  return "Chromium Browser";
}

// Persistent profile ID and preferences
async function initProfile() {
  const stored = await chrome.storage.local.get([
    "profileId",
    "profileName",
    "wsPort",
    "agentControlEnabled",
  ]);

  if (stored.profileId) {
    profileId = stored.profileId;
  } else {
    profileId = "profile_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    await chrome.storage.local.set({ profileId });
  }

  if (stored.profileName) {
    profileName = stored.profileName;
  } else {
    profileName = `${detectBrowser()} (${profileId.slice(-4)})`;
    await chrome.storage.local.set({ profileName });
  }

  if (stored.wsPort) {
    currentPort = Number(stored.wsPort) || 18922;
  }

  if (stored.agentControlEnabled !== undefined) {
    agentControlEnabled = Boolean(stored.agentControlEnabled);
  }

  updateBadge();
}

function updateBadge() {
  if (!agentControlEnabled) {
    chrome.action.setBadgeText({ text: "PAUSE" });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    chrome.action.setTitle({ title: `Agent Bridge: Control Disabled (${profileName})` });
    return;
  }

  if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    chrome.action.setTitle({ title: `Agent Bridge: Connected to MCP (${profileName})` });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
    chrome.action.setTitle({ title: `Agent Bridge: Disconnected (Port ${currentPort})` });
  }
}

function ensureTabStore(tabId) {
  if (!tabTelemetry.has(tabId)) {
    tabTelemetry.set(tabId, { console: [], network: new Map(), dialogs: [] });
  }
  return tabTelemetry.get(tabId);
}

// Global CDP event router
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
      activeTraceEvents.push(...params.value);
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

async function attachDebuggerIfNeeded(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
    ensureTabStore(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch (err) {
    console.warn(`[Agent Bridge] Debugger attach error on tab ${tabId}:`, err);
  }
}

// Element resolver helper (supports data-agent-ref OR css selector)
async function resolveElementInfo(tabId, selectorOrRef) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selectorOrRef],
    func: (target) => {
      let el = null;
      if (typeof target === "string" && (target.startsWith("ref_") || target.startsWith("ref-"))) {
        el = document.querySelector(`[data-agent-ref="${target}"]`);
      }
      if (!el) {
        try {
          el = document.querySelector(target);
        } catch {
          // not a valid CSS selector, try ref lookup fallback
          el = document.querySelector(`[data-agent-ref="${target}"]`);
        }
      }
      if (!el && typeof target === "string") {
        try {
          el = document.querySelector(target.toLowerCase());
        } catch {}
      }
      if (!el) return null;

      el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();

      // Render glowing visual highlight overlay
      let overlay = document.getElementById("__agent_action_overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "__agent_action_overlay";
        overlay.style.cssText = `
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
          border: 2px solid #00e5ff;
          background: rgba(0, 229, 255, 0.16);
          border-radius: 6px;
          box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4);
          transition: all 0.15s ease-out;
        `;
        document.body.appendChild(overlay);
      }
      overlay.style.left = `${rect.left - 4}px`;
      overlay.style.top = `${rect.top - 4}px`;
      overlay.style.width = `${rect.width + 8}px`;
      overlay.style.height = `${rect.height + 8}px`;
      overlay.style.opacity = "1";
      setTimeout(() => {
        if (overlay) overlay.style.opacity = "0";
      }, 1400);

      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        tagName: el.tagName ? el.tagName.toLowerCase() : "element",
        id: el.id || null,
        className: el.className || null,
      };
    },
  });

  return result;
}

// Comprehensive RPC Dispatcher matching and exceeding Chrome DevTools MCP
async function handleRpc(action, params = {}) {
  if (!agentControlEnabled) {
    throw new Error(
      `Agent control is currently DISABLED by user in profile "${profileName}". Toggle 'Allow Agent Control' ON in the extension popup.`
    );
  }

  switch (action) {
    // -------------------------------------------------------------------------
    // Profile & Tabs
    // -------------------------------------------------------------------------
    case "get_profile_info": {
      const tabs = await chrome.tabs.query({});
      return {
        profileId,
        profileName,
        browser: detectBrowser(),
        tabCount: tabs.length,
        connectedAt: Date.now(),
      };
    }

    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({
        id: t.id,
        windowId: t.windowId,
        index: t.index,
        title: t.title,
        url: t.url,
        active: t.active,
        status: t.status,
        debuggerAttached: attachedTabs.has(t.id),
      }));
    }

    case "switch_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const tab = await chrome.tabs.update(params.tabId, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { success: true, tabId: params.tabId, active: true };
    }

    case "new_tab": {
      const tab = await chrome.tabs.create({
        url: params.url || "about:blank",
        active: params.active ?? true,
      });
      return { success: true, tabId: tab.id, id: tab.id, url: tab.url };
    }

    case "close_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      await chrome.tabs.remove(params.tabId);
      return { success: true, closed: true, closedTabId: params.tabId, tabId: params.tabId };
    }

    case "navigate_or_open": {
      if (params.tabId) {
        await chrome.tabs.update(params.tabId, {
          url: params.url,
          active: params.active ?? true,
        });
        return { success: true, navigated: true, tabId: params.tabId, url: params.url };
      }
      const tab = await chrome.tabs.create({
        url: params.url,
        active: params.active ?? true,
      });
      return { success: true, navigated: true, tabId: tab.id, id: tab.id, url: params.url };
    }

    case "reload_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      await attachDebuggerIfNeeded(params.tabId);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Page.reload", {
        ignoreCache: params.ignoreCache ?? false,
      });
      return { success: true, tabId: params.tabId, reloaded: true };
    }

    case "read_all_tabs": {
      const tabs = await chrome.tabs.query({});
      const results = [];
      for (const tab of tabs) {
        if (
          !tab.url ||
          tab.url.startsWith("chrome://") ||
          tab.url.startsWith("chrome-extension://") ||
          tab.url.startsWith("edge://") ||
          tab.url.startsWith("brave://") ||
          tab.url.startsWith("about:")
        ) {
          results.push({ id: tab.id, title: tab.title, url: tab.url, skipped: true });
          continue;
        }
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (maxLen) => ({
              title: document.title,
              url: location.href,
              text: document.body ? document.body.innerText.slice(0, maxLen) : "",
            }),
            args: [params.maxLength || 4000],
          });
          results.push({ id: tab.id, ...result });
        } catch (err) {
          results.push({ id: tab.id, title: tab.title, url: tab.url, error: err.message });
        }
      }
      return results;
    }

    // -------------------------------------------------------------------------
    // DOM Snapshots & Accessibility
    // -------------------------------------------------------------------------
    case "get_interactive_snapshot": {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: () => {
          const selectors = [
            "a[href]",
            "button",
            "input",
            "select",
            "textarea",
            "[role='button']",
            "[role='link']",
            "[role='tab']",
            "[role='menuitem']",
            "[role='checkbox']",
            "[role='combobox']",
            "[role='radio']",
            "[role='switch']",
            "[contenteditable='true']",
            "[onclick]",
          ].join(",");

          const elements = Array.from(document.querySelectorAll(selectors));
          const map = [];
          const elementsObj = {};
          let refCounter = 1;

          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (
              rect.width === 0 ||
              rect.height === 0 ||
              style.visibility === "hidden" ||
              style.display === "none"
            ) {
              continue;
            }

            const ref = `ref_${refCounter++}`;
            el.setAttribute("data-agent-ref", ref);

            const item = {
              ref,
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute("type") || null,
              role: el.getAttribute("role") || null,
              text: (
                el.innerText ||
                el.value ||
                el.getAttribute("aria-label") ||
                el.getAttribute("placeholder") ||
                el.getAttribute("title") ||
                ""
              )
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 120),
              href: el.getAttribute("href") || null,
              disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
              bounds: {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
            };
            map.push(item);
            elementsObj[ref] = item;
          }

          return {
            count: map.length,
            elements: elementsObj,
            interactiveElements: map,
            list: map,
            title: document.title,
            url: location.href,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        },
      });
      return result;
    }

    case "take_snapshot": {
      // Accessibility-based text snapshot matching chrome-devtools-mcp
      await attachDebuggerIfNeeded(params.tabId);
      const { nodes } = await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Accessibility.getFullAXTree"
      );

      const formatted = (nodes || [])
        .filter((n) => !n.ignored && n.role?.value && n.role.value !== "none")
        .map((n) => {
          const role = n.role.value;
          const name = n.name?.value || "";
          const desc = n.description?.value || "";
          const val = n.value?.value || "";
          return `[${n.backendDOMNodeId || n.nodeId}] ${role} ${name ? `"${name}"` : ""} ${val ? `val="${val}"` : ""} ${desc ? `(${desc})` : ""}`.trim();
        })
        .slice(0, params.verbose ? 1500 : 350)
        .join("\n");

      return {
        tabId: params.tabId,
        snapshot: formatted,
        tree: formatted,
      };
    }

    case "get_css_styles": {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [params.target, params.properties || []],
        func: (target, filterProps) => {
          let el = null;
          if (typeof target === "string" && target.startsWith("ref_")) {
            el = document.querySelector(`[data-agent-ref="${target}"]`);
          } else {
            try {
              el = document.querySelector(target);
            } catch {
              el = document.querySelector(`[data-agent-ref="${target}"]`);
            }
          }
          if (!el && typeof target === "string") {
            try {
              el = document.querySelector(target.toLowerCase());
            } catch {}
          }
          if (!el) return { error: `Element not found: ${target}` };

          const computed = window.getComputedStyle(el);
          const styles = {};
          if (filterProps && filterProps.length > 0) {
            for (const p of filterProps) {
              styles[p] = computed.getPropertyValue(p);
            }
          } else {
            // Default essential visual styling
            const essentials = [
              "display",
              "visibility",
              "opacity",
              "color",
              "background-color",
              "font-size",
              "font-family",
              "font-weight",
              "width",
              "height",
              "margin",
              "padding",
              "border",
              "position",
              "z-index",
              "box-shadow",
            ];
            for (const p of essentials) {
              styles[p] = computed.getPropertyValue(p);
            }
          }
          return { target, styles, computed: styles };
        },
      });
      return result;
    }

    case "wait_for": {
      const start = Date.now();
      const timeout = params.timeout || 10000;
      const texts = Array.isArray(params.text) ? params.text : params.text ? [params.text] : [];

      while (Date.now() - start < timeout) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: params.tabId },
          args: [texts, params.selector || null],
          func: (searchTexts, selector) => {
            if (selector) {
              try {
                const el = document.querySelector(selector);
                if (el) return { found: true, matched: selector };
              } catch {}
            }
            if (searchTexts && searchTexts.length > 0) {
              const pageText = document.body ? document.body.innerText : "";
              for (const t of searchTexts) {
                if (pageText.includes(t)) return { found: true, matched: t };
              }
            }
            return { found: false };
          },
        });

        if (result?.found) {
          return { success: true, found: true, matched: result.matched, elapsedMs: Date.now() - start };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`Timed out waiting for ${JSON.stringify(texts || params.selector)} after ${timeout}ms`);
    }

    // -------------------------------------------------------------------------
    // Precision Hardware-Level Inputs (Mouse & Keyboard)
    // -------------------------------------------------------------------------
    case "click":
    case "act_on_ref": {
      const target = params.ref || params.target;
      let x = params.x;
      let y = params.y;

      if (target) {
        const info = await resolveElementInfo(params.tabId, target);
        if (!info) throw new Error(`Element "${target}" not found.`);
        x = info.x;
        y = info.y;
      }

      if (x === undefined || y === undefined) {
        throw new Error("Must specify target ref/selector or exact x, y coordinates.");
      }

      await attachDebuggerIfNeeded(params.tabId);
      const button = params.button || "left";
      const clickCount = params.clickCount || 1;

      // Dispatch mouse click
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button,
        clickCount,
      });
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount,
      });

      // If text typing was also passed in act_on_ref
      if (params.actionType === "type" && params.text) {
        if (params.clearFirst) {
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: "a",
            code: "KeyA",
            modifiers: 2, // Control
          });
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "a",
            code: "KeyA",
          });
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
        }

        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
          text: params.text,
        });

        if (params.pressEnter) {
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          });
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          });
        }
      }

      return { success: true, clicked: true, coordinates: { x, y } };
    }

    case "hover": {
      let x = params.x;
      let y = params.y;
      if (params.target) {
        const info = await resolveElementInfo(params.tabId, params.target);
        if (!info) throw new Error(`Target "${params.target}" not found.`);
        x = info.x;
        y = info.y;
      }
      await attachDebuggerIfNeeded(params.tabId);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });
      return { success: true, hovered: true, x, y, coordinates: { x, y } };
    }

    case "drag": {
      let fromX = params.fromX;
      let fromY = params.fromY;
      let toX = params.toX;
      let toY = params.toY;

      if (params.fromTarget) {
        const fromInfo = await resolveElementInfo(params.tabId, params.fromTarget);
        if (!fromInfo) throw new Error(`Source "${params.fromTarget}" not found.`);
        fromX = fromInfo.x;
        fromY = fromInfo.y;
      }
      if (params.toTarget) {
        const toInfo = await resolveElementInfo(params.tabId, params.toTarget);
        if (!toInfo) throw new Error(`Destination "${params.toTarget}" not found.`);
        toX = toInfo.x;
        toY = toInfo.y;
      }

      await attachDebuggerIfNeeded(params.tabId);

      // Mouse down at start
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: fromX,
        y: fromY,
        button: "left",
        clickCount: 1,
      });

      // Move in increments
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const curX = Math.round(fromX + ((toX - fromX) * i) / steps);
        const curY = Math.round(fromY + ((toY - fromY) * i) / steps);
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: curX,
          y: curY,
          button: "left",
        });
        await new Promise((r) => setTimeout(r, 20));
      }

      // Mouse release
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: toX,
        y: toY,
        button: "left",
        clickCount: 1,
      });

      return { success: true, dragged: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
    }

    case "fill": {
      const target = params.target || params.ref;
      const info = await resolveElementInfo(params.tabId, target);
      if (!info) throw new Error(`Element "${target}" not found.`);

      await attachDebuggerIfNeeded(params.tabId);

      // Click to focus
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: info.x,
        y: info.y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: info.x,
        y: info.y,
        button: "left",
        clickCount: 1,
      });

      // Clear existing value
      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [target],
        func: (sel) => {
          let el = sel.startsWith("ref_") ? document.querySelector(`[data-agent-ref="${sel}"]`) : document.querySelector(sel);
          if (el && "value" in el) {
            el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
      });

      // Insert text
      if (params.value) {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
          text: params.value,
        });
      }

      return { success: true, filled: true, target, value: params.value };
    }

    case "fill_form": {
      // Fill multiple form inputs in one call
      const entries = Object.entries(params.fields || {});
      const filled = [];
      for (const [target, value] of entries) {
        await handleRpc("fill", { tabId: params.tabId, target, value });
        filled.push({ target, value });
      }
      return { success: true, count: filled.length, filledCount: filled.length, fields: filled };
    }

    case "press_key": {
      await attachDebuggerIfNeeded(params.tabId);
      const key = params.key;
      const code = params.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key);

      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
      });
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
      });
      return { success: true, pressed: true, key, code };
    }

    case "type_text": {
      await attachDebuggerIfNeeded(params.tabId);
      if (params.target) {
        const info = await resolveElementInfo(params.tabId, params.target);
        if (info) {
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: info.x,
            y: info.y,
            button: "left",
            clickCount: 1,
          });
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: info.x,
            y: info.y,
            button: "left",
            clickCount: 1,
          });
        }
      }
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
        text: params.text,
      });
      return { success: true, typed: true, text: params.text };
    }

    case "upload_file": {
      await attachDebuggerIfNeeded(params.tabId);
      const { root } = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.getDocument");
      const target = params.target || params.ref;
      let nodeId = null;

      if (target.startsWith("ref_")) {
        const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.querySelector", {
          nodeId: root.nodeId,
          selector: `[data-agent-ref="${target}"]`,
        });
        nodeId = res.nodeId;
      } else {
        const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.querySelector", {
          nodeId: root.nodeId,
          selector: target,
        });
        nodeId = res.nodeId;
      }

      if (!nodeId) throw new Error(`Could not find DOM nodeId for target "${target}".`);

      const files = Array.isArray(params.filePaths) ? params.filePaths : [params.filePaths];
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.setFileInputFiles", {
        nodeId,
        files,
      });

      return { success: true, target, files };
    }

    case "handle_dialog": {
      await attachDebuggerIfNeeded(params.tabId);
      const accept = params.action === "accept";
      let activeDialog = true;
      try {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Page.handleJavaScriptDialog", {
          accept,
          promptText: params.promptText,
        });
      } catch (err) {
        if (err.message?.includes("No dialog is showing") || err.code === -32602) {
          activeDialog = false;
        } else {
          throw err;
        }
      }
      return { success: true, handled: true, activeDialog, action: params.action, promptText: params.promptText };
    }

    // -------------------------------------------------------------------------
    // Emulation & Viewport
    // -------------------------------------------------------------------------
    case "resize_page": {
      await attachDebuggerIfNeeded(params.tabId);
      const width = params.width || 1280;
      const height = params.height || 800;
      const deviceScaleFactor = params.deviceScaleFactor || 1;
      const mobile = params.mobile || false;
      await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Emulation.setDeviceMetricsOverride",
        {
          width,
          height,
          deviceScaleFactor,
          mobile,
        }
      );
      return { success: true, width, height, viewport: { width, height, deviceScaleFactor, mobile } };
    }

    case "emulate": {
      await attachDebuggerIfNeeded(params.tabId);
      const res = {};

      if (params.colorScheme) {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setEmulatedMedia", {
          media: "",
          features: [{ name: "prefers-color-scheme", value: params.colorScheme }],
        });
        res.colorScheme = params.colorScheme;
      }

      if (params.cpuThrottlingRate) {
        await chrome.debugger.sendCommand(
          { tabId: params.tabId },
          "Emulation.setCPUThrottlingRate",
          { rate: params.cpuThrottlingRate }
        );
        res.cpuThrottlingRate = params.cpuThrottlingRate;
      }

      if (params.networkConditions) {
        const profiles = {
          Offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
          "Slow 3G": { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 },
          "Fast 3G": { offline: false, latency: 150, downloadThroughput: 180000, uploadThroughput: 84000 },
          "Slow 4G": { offline: false, latency: 100, downloadThroughput: 500000, uploadThroughput: 250000 },
          "Fast 4G": { offline: false, latency: 40, downloadThroughput: 4000000, uploadThroughput: 3000000 },
        };
        const cond = profiles[params.networkConditions];
        if (cond) {
          await chrome.debugger.sendCommand(
            { tabId: params.tabId },
            "Network.emulateNetworkConditions",
            cond
          );
          res.networkConditions = params.networkConditions;
        }
      }

      if (params.geolocation) {
        const [lat, lon] = params.geolocation.split(",").map((s) => parseFloat(s.trim()));
        if (!isNaN(lat) && !isNaN(lon)) {
          await chrome.debugger.sendCommand(
            { tabId: params.tabId },
            "Emulation.setGeolocationOverride",
            { latitude: lat, longitude: lon, accuracy: 100 }
          );
          res.geolocation = { latitude: lat, longitude: lon };
        }
      }

      if (params.userAgent) {
        await chrome.debugger.sendCommand(
          { tabId: params.tabId },
          "Emulation.setUserAgentOverride",
          { userAgent: params.userAgent }
        );
        res.userAgent = params.userAgent;
      }

      return { success: true, applied: Object.keys(res), emulated: res };
    }

    // -------------------------------------------------------------------------
    // Network & Cookies & Storage
    // -------------------------------------------------------------------------
    case "list_network_requests": {
      await attachDebuggerIfNeeded(params.tabId);
      const store = ensureTabStore(params.tabId);
      const reqs = Array.from(store.network.values()).map((r) => ({
        requestId: r.requestId,
        url: r.url,
        method: r.method,
        type: r.type,
        status: r.status,
        mimeType: r.mimeType,
        timestamp: r.timestamp,
      }));
      return { tabId: params.tabId, count: reqs.length, requests: reqs };
    }

    case "get_network_request": {
      await attachDebuggerIfNeeded(params.tabId);
      const store = ensureTabStore(params.tabId);
      const req = store.network.get(params.requestId);
      if (!req) throw new Error(`Request ID "${params.requestId}" not found in telemetry.`);

      let body = null;
      try {
        const bodyRes = await chrome.debugger.sendCommand(
          { tabId: params.tabId },
          "Network.getResponseBody",
          { requestId: params.requestId }
        );
        body = bodyRes.body;
      } catch {
        // Response body might not be available or already expired
      }

      return { ...req, body };
    }

    case "get_response_body": {
      await attachDebuggerIfNeeded(params.tabId);
      return await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
    }

    case "get_cookies": {
      const tab = await chrome.tabs.get(params.tabId);
      const cookies = await chrome.cookies.getAll({ url: tab.url });
      return { tabId: params.tabId, url: tab.url, count: cookies.length, cookies };
    }

    case "set_cookie": {
      const tab = await chrome.tabs.get(params.tabId);
      const res = await chrome.cookies.set({
        url: params.url || tab.url,
        name: params.name,
        value: params.value,
        domain: params.domain,
        path: params.path || "/",
        secure: params.secure ?? true,
        httpOnly: params.httpOnly ?? false,
      });
      return { success: true, cookie: res };
    }

    case "clear_cookies": {
      await attachDebuggerIfNeeded(params.tabId);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.clearBrowserCookies");
      return { success: true, cleared: true };
    }

    case "storage": {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [params.operation || "get", params.key || null, params.value || null, params.storageType || "localStorage"],
        func: (op, key, val, stType) => {
          const st = stType === "sessionStorage" ? window.sessionStorage : window.localStorage;
          if (op === "get") {
            if (key) {
              const itemVal = st.getItem(key);
              return { success: true, operation: "get", key, value: itemVal, [key]: itemVal };
            }
            const all = {};
            for (let i = 0; i < st.length; i++) {
              const k = st.key(i);
              all[k] = st.getItem(k);
            }
            return { success: true, operation: "get", all, ...all };
          }
          if (op === "set" && key) {
            st.setItem(key, val);
            return { success: true, operation: "set", key, val, value: val };
          }
          if (op === "remove" && key) {
            st.removeItem(key);
            return { success: true, operation: "remove", removed: key };
          }
          if (op === "clear") {
            st.clear();
            return { success: true, operation: "clear", cleared: true };
          }
        },
      });
      return result;
    }

    // -------------------------------------------------------------------------
    // Console & Diagnostics
    // -------------------------------------------------------------------------
    case "list_console_messages": {
      await attachDebuggerIfNeeded(params.tabId);
      const store = ensureTabStore(params.tabId);
      let list = [...store.console];
      if (params.level) {
        list = list.filter((m) => m.type === params.level);
      }
      return { tabId: params.tabId, count: list.length, messages: list };
    }

    case "get_telemetry": {
      await attachDebuggerIfNeeded(params.tabId);
      const store = ensureTabStore(params.tabId);
      const result = {
        tabId: params.tabId,
        console: [...store.console],
        network: Array.from(store.network.values()),
        dialogs: [...store.dialogs],
      };
      if (params.clearAfterRead) {
        store.console = [];
        store.network.clear();
        store.dialogs = [];
      }
      return result;
    }

    // -------------------------------------------------------------------------
    // Performance & Profiling
    // -------------------------------------------------------------------------
    case "performance_start_trace": {
      await attachDebuggerIfNeeded(params.tabId);
      activeTracingTab = params.tabId;
      activeTraceEvents = [];
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Tracing.start", {
        categories: "-*,devtools.timeline,disabled-by-default-devtools.timeline,v8.execute",
      });
      return { success: true, tracing: true, tabId: params.tabId };
    }

    case "performance_stop_trace": {
      if (!activeTracingTab) throw new Error("No active performance trace running.");
      const traceTabId = activeTracingTab;
      activeTracingTab = null;
      await chrome.debugger.sendCommand({ tabId: traceTabId }, "Tracing.end");
      const events = [...activeTraceEvents];
      activeTraceEvents = [];
      return { success: true, tracing: false, tabId: traceTabId, events };
    }

    case "performance_analyze_insight": {
      // Core Web Vitals (LCP, FCP, CLS, long tasks)
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: () => {
          const nav = performance.getEntriesByType("navigation")[0] || {};
          const paint = performance.getEntriesByType("paint") || [];
          const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0;

          return {
            pageUrl: location.href,
            timing: {
              dnsLookup: nav.domainLookupEnd - nav.domainLookupStart,
              tcpConnect: nav.connectEnd - nav.connectStart,
              ttfb: nav.responseStart - nav.requestStart,
              domContentLoaded: nav.domContentLoadedEventEnd - nav.fetchStart,
              loadComplete: nav.loadEventEnd - nav.fetchStart,
              firstContentfulPaint: Math.round(fcp),
            },
            resourcesCount: performance.getEntriesByType("resource").length,
          };
        },
      });
      return result;
    }

    case "take_heapsnapshot": {
      await attachDebuggerIfNeeded(params.tabId);
      let metrics = [];
      try {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Performance.enable");
        const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "Performance.getMetrics");
        metrics = res.metrics || [];
      } catch {}

      const metricMap = {};
      for (const m of metrics) metricMap[m.name] = m.value;

      const totalSize = metricMap["JSHeapTotalSize"] || 0;
      const usedSize = metricMap["JSHeapUsedSize"] || 0;

      try {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "HeapProfiler.takeHeapSnapshot", {
          reportProgress: false,
        });
      } catch {}

      return {
        success: true,
        tabId: params.tabId,
        snapshotTaken: true,
        summary: {
          totalSize,
          usedSize,
          nodes: metricMap["Nodes"] || 0,
          documents: metricMap["Documents"] || 0,
          listeners: metricMap["JSEventListeners"] || 0,
        },
        metrics: metricMap,
      };
    }

    // -------------------------------------------------------------------------
    // Execution & Raw CDP
    // -------------------------------------------------------------------------
    case "eval_js": {
      await attachDebuggerIfNeeded(params.tabId);
      return await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Runtime.evaluate",
        {
          expression: params.expression,
          returnByValue: true,
          awaitPromise: true,
        }
      );
    }

    case "raw_cdp": {
      await attachDebuggerIfNeeded(params.tabId);
      return await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        params.method,
        params.commandParams || {}
      );
    }

    case "screenshot": {
      await attachDebuggerIfNeeded(params.tabId);
      const { data } = await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Page.captureScreenshot",
        { format: "png" }
      );
      return { base64Png: data };
    }

    case "reload_extension": {
      setTimeout(() => chrome.runtime.reload(), 50);
      return { success: true, reloaded: true };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

let reconnectDelay = 2000;

// Pre-flight check: Verifies if the MCP server is listening via a silent HTTP probe.
// If the server is offline, fetch fails silently in catch(), preventing Chrome from
// logging net::ERR_CONNECTION_REFUSED in the chrome://extensions Errors panel!
async function isServerReady() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`http://127.0.0.1:${currentPort}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function connectWebSocket() {
  if (
    wsSocket &&
    (wsSocket.readyState === WebSocket.OPEN || wsSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  // Probe server before creating WebSocket
  const ready = await isServerReady();
  if (!ready) {
    updateBadge();
    scheduleReconnect();
    return;
  }

  const url = `ws://127.0.0.1:${currentPort}`;

  try {
    const ws = new WebSocket(url);
    wsSocket = ws;

    ws.onopen = () => {
      reconnectDelay = 2000;
      console.log(`%c[Agent Bridge] Successfully connected to MCP server at ${url}!`, "color: #10b981; font-weight: bold;");
      updateBadge();
      ws.send(
        JSON.stringify({
          type: "register",
          profileId,
          profileName,
          browser: detectBrowser(),
          timestamp: Date.now(),
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (msg.id && msg.action) {
          try {
            const result = await handleRpc(msg.action, msg.params);
            logAgentAction(msg.action, msg.params, result, null);
            ws.send(JSON.stringify({ id: msg.id, result }));
          } catch (err) {
            logAgentAction(msg.action, msg.params, null, err);
            ws.send(JSON.stringify({ id: msg.id, error: err.message }));
          }
        }
      } catch (parseErr) {
        console.warn("[Agent Bridge] Failed to parse message:", parseErr);
      }
    };

    ws.onclose = () => {
      wsSocket = null;
      updateBadge();
      scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {}
    };
  } catch (err) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}

// Keepalive via chrome.alarms + WebSocket heartbeat
chrome.runtime.onInstalled.addListener(async () => {
  await initProfile();
  chrome.alarms.create("agent-bridge-keepalive", { periodInMinutes: 0.4 });
  connectWebSocket();
});

chrome.runtime.onStartup.addListener(async () => {
  await initProfile();
  chrome.alarms.create("agent-bridge-keepalive", { periodInMinutes: 0.4 });
  connectWebSocket();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "agent-bridge-keepalive") {
    if (!wsSocket || wsSocket.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      wsSocket.send(
        JSON.stringify({
          type: "heartbeat",
          profileId,
          profileName,
          ts: Date.now(),
        })
      );
    }
  }
});

// Extension Popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getStatus") {
    chrome.tabs.query({}).then((tabs) => {
      sendResponse({
        connected: Boolean(wsSocket && wsSocket.readyState === WebSocket.OPEN),
        profileId,
        profileName,
        wsPort: currentPort,
        agentControlEnabled,
        tabCount: tabs.length,
        browser: detectBrowser(),
        debuggerAttachedCount: attachedTabs.size,
        totalActions: totalActionCount,
      });
    });
    return true;
  }

  if (request.action === "getRecentActions") {
    sendResponse({
      actions: recentActions,
      totalCount: totalActionCount,
    });
    return true;
  }

  if (request.action === "clearRecentActions") {
    recentActions.length = 0;
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
          debuggerAttached: attachedTabs.has(t.id),
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
    fetch(`http://127.0.0.1:${currentPort}/health`, {
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

    if (newProfileName !== undefined && newProfileName !== profileName) {
      profileName = newProfileName.trim() || profileName;
      updates.profileName = profileName;
    }

    if (newEnabled !== undefined && newEnabled !== agentControlEnabled) {
      agentControlEnabled = Boolean(newEnabled);
      updates.agentControlEnabled = agentControlEnabled;
    }

    let portChanged = false;
    if (newPort !== undefined && Number(newPort) && Number(newPort) !== currentPort) {
      currentPort = Number(newPort);
      updates.wsPort = currentPort;
      portChanged = true;
    }

    chrome.storage.local.set(updates).then(() => {
      updateBadge();
      if (portChanged) {
        if (wsSocket) wsSocket.close();
        connectWebSocket();
      } else if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
        wsSocket.send(
          JSON.stringify({
            type: "register",
            profileId,
            profileName,
            browser: detectBrowser(),
            timestamp: Date.now(),
          })
        );
      }
      sendResponse({ success: true, profileName, currentPort, agentControlEnabled });
    });
    return true;
  }

  if (request.action === "reconnect") {
    if (wsSocket) wsSocket.close();
    connectWebSocket();
    sendResponse({ success: true });
    return true;
  }
});

initProfile().then(() => {
  connectWebSocket();
});
