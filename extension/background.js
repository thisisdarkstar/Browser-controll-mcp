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
const tabMockRoutes = new Map(); // tabId -> Array<{ urlPattern, status, headers, bodyBase64 }>
let activeTracingTab = null;
let activeTraceEvents = [];

// Real-time Agent Action Audit Log & State
const recentActions = []; // Rolling buffer of last 30 actions for UI audit log
let totalActionCount = 0;
let activeRpcCount = 0;
let currentExecutingAction = null;
let lastAgentActionTime = null;

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

  if (activeRpcCount > 0) {
    chrome.action.setBadgeText({ text: "RUN" });
    chrome.action.setBadgeBackgroundColor({ color: "#00e5ff" });
    chrome.action.setTitle({ title: `Agent Bridge: Executing ${currentExecutingAction || "action"}...` });
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
  } else if (method === "Fetch.requestPaused") {
    const mocks = tabMockRoutes.get(tabId) || [];
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
      activeTraceEvents.push(...params.value);
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    tabMockRoutes.delete(source.tabId);
  }
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

// Wait for a tab to finish loading (navigation synchronization)
function waitForTabReady(tabId, mode = "load", timeoutMs = 15000) {
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

// Virtual Agent Cursor & Action HUD Injector
async function injectAgentVisualCue(tabId, cue) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [cue],
      func: (data) => {
        if (!document || !document.body) return;

        // 1. Inject Hardware-Accelerated CSS Keyframes
        if (!document.getElementById("__agent_hud_styles")) {
          const styleTag = document.createElement("style");
          styleTag.id = "__agent_hud_styles";
          styleTag.textContent = `
            @keyframes agentPulseGlow {
              0%, 100% { box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4); }
              50% { box-shadow: 0 0 28px rgba(0, 229, 255, 1), inset 0 0 14px rgba(0, 229, 255, 0.7); }
            }
            @keyframes agentChevronDown {
              0% { transform: translateY(-8px); opacity: 0; }
              50% { opacity: 1; }
              100% { transform: translateY(10px); opacity: 0; }
            }
            @keyframes agentChevronUp {
              0% { transform: translateY(8px); opacity: 0; }
              50% { opacity: 1; }
              100% { transform: translateY(-10px); opacity: 0; }
            }
            @keyframes agentNavProgress {
              0% { width: 0%; opacity: 1; }
              60% { width: 75%; opacity: 1; }
              90% { width: 95%; opacity: 1; }
              100% { width: 100%; opacity: 0; }
            }
            @keyframes agentKeycapBounce {
              0% { transform: translate(-50%, 6px) scale(0.85); opacity: 0; }
              25% { transform: translate(-50%, -3px) scale(1.08); opacity: 1; }
              50% { transform: translate(-50%, 0) scale(1); opacity: 1; }
              85% { transform: translate(-50%, 0) scale(1); opacity: 1; }
              100% { transform: translate(-50%, -4px) scale(0.9); opacity: 0; }
            }
            @keyframes agentPerimeterFlash {
              0% { opacity: 0; }
              25% { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes agentCheckBloom {
              0% { transform: scale(0.3); opacity: 0; }
              40% { transform: scale(1.3); opacity: 1; }
              70% { transform: scale(1); opacity: 1; }
              100% { transform: scale(1.4); opacity: 0; }
            }
            @keyframes agentDragPulse {
              0% { stroke-dashoffset: 40; }
              100% { stroke-dashoffset: 0; }
            }
          `;
          (document.head || document.documentElement).appendChild(styleTag);
        }

        let cursor = document.getElementById("__agent_virtual_cursor");
        let label = document.getElementById("__agent_cursor_label");
        let overlay = document.getElementById("__agent_action_overlay");

        if (!cursor) {
          cursor = document.createElement("div");
          cursor.id = "__agent_virtual_cursor";
          cursor.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            pointer-events: none;
            width: 26px;
            height: 26px;
            top: 20px;
            left: 20px;
            transform: translate(-3px, -3px);
            transition: left 0.22s cubic-bezier(0.2, 0, 0, 1), top 0.22s cubic-bezier(0.2, 0, 0, 1), transform 0.2s ease, opacity 0.35s ease;
            filter: drop-shadow(0 3px 10px rgba(0, 229, 255, 0.75));
            opacity: 0;
          `;
          cursor.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M4 3L19 10.5L11.5 13.5L8.5 21L4 3Z" fill="#00e5ff" stroke="#070a12" stroke-width="2" stroke-linejoin="round"/>
              <circle cx="5.5" cy="5.5" r="1.5" fill="#ffffff"/>
            </svg>
            <div id="__agent_cursor_label" style="
              position: absolute;
              left: 22px;
              top: 16px;
              background: rgba(15, 23, 42, 0.94);
              color: #f8fafc;
              border: 1px solid rgba(0, 229, 255, 0.6);
              border-radius: 8px;
              padding: 4px 10px;
              font-size: 11px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
              font-weight: 600;
              white-space: nowrap;
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 10px rgba(0, 229, 255, 0.3);
              pointer-events: none;
              opacity: 0;
              transform: translateY(2px);
              transition: opacity 0.2s ease, transform 0.2s ease;
              display: flex;
              align-items: center;
              gap: 6px;
            "></div>
          `;
          document.body.appendChild(cursor);
          label = document.getElementById("__agent_cursor_label");
        }

        // Position cursor
        if (data.x !== undefined && data.y !== undefined) {
          cursor.style.left = `${data.x}px`;
          cursor.style.top = `${data.y}px`;
          cursor.style.opacity = "1";
        }

        // Action Tooltip Pill
        if (data.label && label) {
          label.innerHTML = `<span style="font-size: 13px;">🤖</span> ${data.label}`;
          label.style.opacity = "1";
          label.style.transform = "translateY(0)";

          clearTimeout(window.__agentLabelTimeout);
          window.__agentLabelTimeout = setTimeout(() => {
            if (label) {
              label.style.opacity = "0";
              label.style.transform = "translateY(2px)";
            }
          }, 2400);
        }

        // 2. Click Shockwave Ripple & Cursor Bounce
        if (data.type === "click" && data.x !== undefined && data.y !== undefined) {
          const ripple = document.createElement("div");
          ripple.style.cssText = `
            position: fixed;
            left: ${data.x - 20}px;
            top: ${data.y - 20}px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 2px solid #00e5ff;
            background: rgba(0, 229, 255, 0.35);
            pointer-events: none;
            z-index: 2147483646;
            transform: scale(0.2);
            opacity: 1;
            transition: transform 0.45s cubic-bezier(0.1, 0.8, 0.2, 1), opacity 0.45s ease-out;
          `;
          document.body.appendChild(ripple);
          requestAnimationFrame(() => {
            ripple.style.transform = "scale(2.8)";
            ripple.style.opacity = "0";
          });
          setTimeout(() => ripple.remove(), 500);

          // Click bounce animation
          cursor.style.transform = "translate(-3px, -3px) scale(0.85)";
          setTimeout(() => {
            cursor.style.transform = "translate(-3px, -3px) scale(1)";
          }, 150);
        }

        // 3. Cinematic Scroll Velocity Strip & Cursor Tilt Animation
        if (data.type === "scroll") {
          const dir = data.direction || "down";
          const isDown = dir === "down" || dir === "bottom";
          const isUp = dir === "up" || dir === "top";

          // Cursor Wheel Tilt simulation
          if (cursor) {
            cursor.style.opacity = "1";
            cursor.style.transform = isDown
              ? "translate(-3px, -3px) rotate(16deg) scale(0.95)"
              : "translate(-3px, -3px) rotate(-16deg) scale(0.95)";
            setTimeout(() => {
              if (cursor) cursor.style.transform = "translate(-3px, -3px) rotate(0deg) scale(1)";
            }, 350);
          }

          // Calculate scroll progress percentage
          const curY = data.scrollY !== undefined ? data.scrollY : window.scrollY;
          const maxScroll = Math.max(1, (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight);
          const scrollPct = Math.min(100, Math.max(0, Math.round((curY / maxScroll) * 100)));

          // Scroll HUD capsule on right viewport margin
          let scrollStrip = document.getElementById("__agent_scroll_strip");
          if (!scrollStrip) {
            scrollStrip = document.createElement("div");
            scrollStrip.id = "__agent_scroll_strip";
            scrollStrip.style.cssText = `
              position: fixed;
              right: 24px;
              top: 50%;
              transform: translateY(-50%);
              z-index: 2147483647;
              pointer-events: none;
              background: rgba(15, 23, 42, 0.94);
              color: #f8fafc;
              border: 1px solid rgba(0, 229, 255, 0.7);
              border-radius: 12px;
              padding: 12px 14px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(0, 229, 255, 0.35);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
              font-size: 11px;
              font-weight: 600;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
              opacity: 0;
              transition: opacity 0.25s ease, transform 0.25s ease;
            `;
            document.body.appendChild(scrollStrip);
          }

          const arrowAnimation = isDown ? "agentChevronDown 0.6s infinite ease-in-out" : "agentChevronUp 0.6s infinite ease-in-out";
          const arrowSymbol = isDown ? "↓" : "↑";

          scrollStrip.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; color: #00e5ff; font-size: 14px;">
              <span style="animation: ${arrowAnimation};">${arrowSymbol}</span>
              <span style="animation: ${arrowAnimation}; animation-delay: 0.15s;">${arrowSymbol}</span>
            </div>
            <div style="width: 4px; height: 44px; background: rgba(255,255,255,0.12); border-radius: 2px; position: relative; overflow: hidden;">
              <div style="position: absolute; width: 100%; top: 0; height: ${scrollPct}%; background: #00e5ff; box-shadow: 0 0 6px #00e5ff;"></div>
            </div>
            <div style="font-size: 10px; color: #38bdf8; font-weight: 700; white-space: nowrap;">
              ${scrollPct}%
            </div>
            <div style="font-size: 11px; color: #cbd5e1; font-weight: 500; white-space: nowrap; margin-top: 2px;">
              ${data.label || `Scroll ${dir}`}
            </div>
          `;

          scrollStrip.style.opacity = "1";
          scrollStrip.style.transform = "translateY(-50%) scale(1)";

          clearTimeout(window.__agentScrollTimeout);
          window.__agentScrollTimeout = setTimeout(() => {
            if (scrollStrip) {
              scrollStrip.style.opacity = "0";
              scrollStrip.style.transform = "translateY(-50%) scale(0.95)";
            }
          }, 1500);
        }

        // 4. Keyboard Keycap HUD Animation
        if (data.type === "key" && data.key) {
          const keycap = document.createElement("div");
          keycap.style.cssText = `
            position: fixed;
            left: ${data.x !== undefined ? data.x : window.innerWidth / 2}px;
            top: ${data.y !== undefined ? data.y - 45 : window.innerHeight / 2}px;
            z-index: 2147483647;
            pointer-events: none;
            background: linear-gradient(180deg, #1e293b, #0f172a);
            color: #00e5ff;
            border: 1px solid rgba(0, 229, 255, 0.8);
            border-bottom: 3px solid #00e5ff;
            border-radius: 8px;
            padding: 6px 14px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', Consolas, monospace;
            font-weight: 700;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 229, 255, 0.5);
            animation: agentKeycapBounce 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          `;
          const keyLabels = {
            Enter: "↵ Enter",
            Tab: "⇥ Tab",
            Escape: "⎋ Esc",
            Backspace: "⌫ Backspace",
            ArrowDown: "↓ Down",
            ArrowUp: "↑ Up",
            ArrowLeft: "← Left",
            ArrowRight: "→ Right",
            Space: "␣ Space",
          };
          keycap.innerHTML = `⌨️ ${keyLabels[data.key] || data.key}`;
          document.body.appendChild(keycap);
          setTimeout(() => keycap.remove(), 900);
        }

        // 5. Navigation Neon Laser Streamer
        if (data.type === "navigate") {
          let navBeam = document.getElementById("__agent_nav_beam");
          if (!navBeam) {
            navBeam = document.createElement("div");
            navBeam.id = "__agent_nav_beam";
            navBeam.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              height: 3px;
              width: 0%;
              z-index: 2147483647;
              pointer-events: none;
              background: linear-gradient(90deg, #00e5ff, #38bdf8, #818cf8);
              box-shadow: 0 0 14px #00e5ff, 0 0 6px #38bdf8;
              animation: agentNavProgress 0.85s ease-out forwards;
            `;
            document.body.appendChild(navBeam);
            setTimeout(() => navBeam.remove(), 900);
          }
        }

        // 6. Tab Focus Perimeter Flash
        if (data.type === "tab_focus") {
          const flash = document.createElement("div");
          flash.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            pointer-events: none;
            box-shadow: inset 0 0 40px rgba(0, 229, 255, 0.5), inset 0 0 12px #00e5ff;
            animation: agentPerimeterFlash 0.6s ease-out forwards;
          `;
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 650);
        }

        // 7. Checkbox & Radio Bloom
        if (data.type === "check" && data.x !== undefined && data.y !== undefined) {
          const checkBloom = document.createElement("div");
          checkBloom.style.cssText = `
            position: fixed;
            left: ${data.x - 16}px;
            top: ${data.y - 16}px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.35);
            border: 2px solid #10b981;
            color: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: bold;
            z-index: 2147483647;
            pointer-events: none;
            box-shadow: 0 0 14px rgba(16, 185, 129, 0.6);
            animation: agentCheckBloom 0.6s ease-out forwards;
          `;
          checkBloom.innerHTML = data.checked ? "✓" : "✕";
          document.body.appendChild(checkBloom);
          setTimeout(() => checkBloom.remove(), 650);
        }

        // 8. Target Element Highlight Ring & Typing Pulse
        if (data.rect) {
          if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "__agent_action_overlay";
            overlay.style.cssText = `
              position: fixed;
              z-index: 2147483645;
              pointer-events: none;
              border: 2px solid #00e5ff;
              background: rgba(0, 229, 255, 0.14);
              border-radius: 6px;
              box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4);
              transition: all 0.15s ease-out;
            `;
            document.body.appendChild(overlay);
          }
          overlay.style.left = `${data.rect.x - 4}px`;
          overlay.style.top = `${data.rect.y - 4}px`;
          overlay.style.width = `${data.rect.width + 8}px`;
          overlay.style.height = `${data.rect.height + 8}px`;
          overlay.style.opacity = "1";

          if (data.type === "type") {
            overlay.style.animation = "agentPulseGlow 1.2s infinite ease-in-out";
          } else {
            overlay.style.animation = "none";
          }

          clearTimeout(window.__agentOverlayTimeout);
          window.__agentOverlayTimeout = setTimeout(() => {
            if (overlay) overlay.style.opacity = "0";
          }, 1800);
        }

        // 9. Animated Laser Drag Path
        if (data.type === "drag" && data.from && data.to) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.style.cssText = `
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            z-index: 2147483646;
            pointer-events: none;
          `;
          svg.innerHTML = `
            <line x1="${data.from.x}" y1="${data.from.y}" x2="${data.to.x}" y2="${data.to.y}"
              stroke="#00e5ff" stroke-width="2.5" stroke-dasharray="6 4" style="animation: agentDragPulse 0.5s linear infinite; filter: drop-shadow(0 0 8px #00e5ff);" />
            <circle cx="${data.to.x}" cy="${data.to.y}" r="6" fill="#00e5ff" style="filter: drop-shadow(0 0 10px #00e5ff);" />
          `;
          document.body.appendChild(svg);
          setTimeout(() => svg.remove(), 700);

          cursor.style.left = `${data.from.x}px`;
          cursor.style.top = `${data.from.y}px`;
          cursor.style.opacity = "1";
          setTimeout(() => {
            cursor.style.left = `${data.to.x}px`;
            cursor.style.top = `${data.to.y}px`;
          }, 80);
        }

        // Auto-fade cursor when idle for 5 seconds
        clearTimeout(window.__agentCursorFadeTimeout);
        window.__agentCursorFadeTimeout = setTimeout(() => {
          if (cursor) cursor.style.opacity = "0";
        }, 5000);
      },
    });
  } catch {}
}

// Element resolver helper (supports data-agent-ref OR css selector with shadow DOM traversal)
async function resolveElementInfo(tabId, selectorOrRef) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selectorOrRef],
    func: (target) => {
      function findInShadow(root, sel) {
        try {
          const direct = root.querySelector(sel);
          if (direct) return direct;
          const all = root.querySelectorAll("*");
          for (const node of all) {
            if (node.shadowRoot) {
              const found = findInShadow(node.shadowRoot, sel);
              if (found) return found;
            }
          }
        } catch {}
        return null;
      }

      let el = null;
      if (typeof target === "string" && (target.startsWith("ref_") || target.startsWith("ref-"))) {
        el = findInShadow(document, `[data-agent-ref="${target}"]`);
      }
      if (!el) {
        try {
          el = findInShadow(document, target);
        } catch {
          el = findInShadow(document, `[data-agent-ref="${target}"]`);
        }
      }
      if (!el && typeof target === "string") {
        try {
          el = findInShadow(document, target.toLowerCase());
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
      await injectAgentVisualCue(params.tabId, {
        type: "tab_focus",
        label: "Tab Focused",
      });
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
    }

    case "go_back": {
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
    }

    case "go_forward": {
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
    }

    case "scroll": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [
          params.direction || "down",
          params.distance ?? 500,
          params.target || null,
          params.smooth ?? false,
          params.x ?? null,
          params.y ?? null,
        ],
        func: (direction, distance, target, smooth, directX, directY) => {
          const behavior = smooth ? "smooth" : "instant";

          if (directX !== null || directY !== null) {
            window.scrollTo({
              left: directX ?? window.scrollX,
              top: directY ?? window.scrollY,
              behavior,
            });
            return {
              scrolled: true,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              scrollHeight: document.body ? document.body.scrollHeight : 0,
            };
          }

          let container = null;
          if (target) {
            if (target.startsWith("ref_") || target.startsWith("ref-")) {
              container = document.querySelector(`[data-agent-ref="${target}"]`);
            }
            if (!container) {
              try {
                container = document.querySelector(target);
              } catch {}
            }
          }

          if (container) {
            const overflowY = window.getComputedStyle(container).overflowY;
            const isScrollable =
              (overflowY === "auto" || overflowY === "scroll") && container.scrollHeight > container.clientHeight;

            if (isScrollable) {
              if (direction === "top") container.scrollTo({ top: 0, behavior });
              else if (direction === "bottom") container.scrollTo({ top: container.scrollHeight, behavior });
              else if (direction === "up") container.scrollBy({ top: -distance, behavior });
              else if (direction === "down") container.scrollBy({ top: distance, behavior });
              else if (direction === "left") container.scrollBy({ left: -distance, behavior });
              else if (direction === "right") container.scrollBy({ left: distance, behavior });
              return {
                scrolled: true,
                target,
                scrollTop: container.scrollTop,
                scrollLeft: container.scrollLeft,
                scrollHeight: container.scrollHeight,
              };
            } else {
              container.scrollIntoView({ behavior, block: "center", inline: "center" });
              return {
                scrolled: true,
                target,
                scrolledIntoView: true,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
              };
            }
          }

          if (direction === "top") {
            window.scrollTo({ top: 0, behavior });
          } else if (direction === "bottom") {
            window.scrollTo({
              top: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
              behavior,
            });
          } else if (direction === "up") {
            window.scrollBy({ top: -distance, behavior });
          } else if (direction === "down") {
            window.scrollBy({ top: distance, behavior });
          } else if (direction === "left") {
            window.scrollBy({ left: -distance, behavior });
          } else if (direction === "right") {
            window.scrollBy({ left: distance, behavior });
          }

          return {
            scrolled: true,
            direction,
            distance,
            scrollX: Math.round(window.scrollX),
            scrollY: Math.round(window.scrollY),
            viewportHeight: window.innerHeight,
            pageHeight: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
          };
        },
      });
      await injectAgentVisualCue(params.tabId, {
        type: "scroll",
        direction: result.direction,
        distance: result.distance,
        scrollY: result.scrollY,
        pageHeight: result.pageHeight,
        label: `Scroll ${result.direction || "down"} (${result.distance ?? 500}px)`,
      });
      return { success: true, tabId: params.tabId, ...result };
    }

    case "reload_tab": {
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
        args: [params.viewportOnly ?? false],
        func: (viewportOnly) => {
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

          function queryElementsWithShadow(root) {
            const list = [];
            try {
              list.push(...root.querySelectorAll(selectors));
              const all = root.querySelectorAll("*");
              for (const el of all) {
                if (el.shadowRoot) {
                  list.push(...queryElementsWithShadow(el.shadowRoot));
                }
              }
            } catch {}
            return list;
          }

          const elements = queryElementsWithShadow(document);
          const map = [];
          const elementsObj = {};
          let refCounter = 1;
          const vw = window.innerWidth;
          const vh = window.innerHeight;

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

            if (viewportOnly) {
              if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
                continue;
              }
            }

            const ref = `ref_${refCounter++}`;
            el.setAttribute("data-agent-ref", ref);

            const form = el.closest ? el.closest("form") : null;
            const formId = form ? form.id || form.name || "form" : null;

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
              formId,
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
            viewportOnly: Boolean(viewportOnly),
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

    case "get_markdown": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [
          params.selector || null,
          params.includeLinks ?? true,
          params.includeImages ?? false,
          params.maxLength ?? 50000,
        ],
        func: (selector, includeLinks, includeImages, maxLength) => {
          let root = null;
          if (selector) {
            root = document.querySelector(selector);
          }
          if (!root) {
            root = document.querySelector("article, main, [role='main'], #content, .content, #main, .main, body") || document.body;
          }
          if (!root) return { error: "No root content found on page." };

          const clone = root.cloneNode(true);
          const removeSelectors = [
            "script", "style", "noscript", "svg", "iframe", "canvas",
            "nav", "header", "footer", ".nav", ".navbar", ".menu", ".footer",
            ".sidebar", "#sidebar", ".advertisement", ".ad", ".ads",
            "[aria-hidden='true']", "#__agent_virtual_cursor", "#__agent_action_overlay",
            "#__agent_scroll_indicator", "#__agent_takeover_banner"
          ];
          if (clone.tagName && clone.tagName.toLowerCase() === "body") {
            for (const sel of removeSelectors) {
              clone.querySelectorAll(sel).forEach((el) => el.remove());
            }
          } else {
            clone.querySelectorAll("script, style, noscript, svg, iframe").forEach((el) => el.remove());
          }

          function nodeToMd(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              return node.nodeValue.replace(/\s+/g, " ");
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return "";

            const tag = node.tagName.toLowerCase();
            const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
            if (style && (style.display === "none" || style.visibility === "hidden")) return "";

            let inner = "";
            for (const child of node.childNodes) {
              inner += nodeToMd(child);
            }
            inner = inner.trim();

            switch (tag) {
              case "h1": return `\n\n# ${inner}\n\n`;
              case "h2": return `\n\n## ${inner}\n\n`;
              case "h3": return `\n\n### ${inner}\n\n`;
              case "h4": return `\n\n#### ${inner}\n\n`;
              case "h5": return `\n\n##### ${inner}\n\n`;
              case "h6": return `\n\n###### ${inner}\n\n`;
              case "p": return `\n\n${inner}\n\n`;
              case "blockquote": return `\n\n> ${inner.replace(/\n/g, "\n> ")}\n\n`;
              case "hr": return `\n\n---\n\n`;
              case "br": return `\n`;
              case "b":
              case "strong": return inner ? `**${inner}**` : "";
              case "i":
              case "em": return inner ? `*${inner}*` : "";
              case "code":
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === "pre") {
                  return inner;
                }
                return inner ? `\`${inner}\`` : "";
              case "pre": {
                const lang = node.className || "";
                return `\n\n\`\`\`${lang}\n${inner}\n\`\`\`\n\n`;
              }
              case "ul": return `\n\n${inner}\n\n`;
              case "ol": return `\n\n${inner}\n\n`;
              case "li": {
                const isOrdered = node.parentElement && node.parentElement.tagName.toLowerCase() === "ol";
                const bullet = isOrdered ? "1. " : "* ";
                return `\n${bullet}${inner}`;
              }
              case "a": {
                const href = node.getAttribute("href");
                if (includeLinks && href && href !== "#" && !href.startsWith("javascript:")) {
                  try {
                    const absoluteUrl = new URL(href, location.href).href;
                    return inner ? `[${inner}](${absoluteUrl})` : "";
                  } catch {
                    return inner ? `[${inner}](${href})` : "";
                  }
                }
                return inner;
              }
              case "img": {
                if (!includeImages) return "";
                const src = node.getAttribute("src");
                const alt = node.getAttribute("alt") || "image";
                if (src) {
                  try {
                    const absoluteSrc = new URL(src, location.href).href;
                    return `![${alt}](${absoluteSrc})`;
                  } catch {
                    return `![${alt}](${src})`;
                  }
                }
                return "";
              }
              case "table": {
                const rows = Array.from(node.querySelectorAll("tr"));
                if (!rows.length) return "";
                let mdTable = "\n\n";
                let colCount = 0;
                rows.forEach((row, rIdx) => {
                  const cells = Array.from(row.querySelectorAll("th, td"));
                  if (!colCount) colCount = cells.length;
                  const cellTexts = cells.map((c) => c.textContent.trim().replace(/\|/g, "\\|").replace(/\n/g, " "));
                  mdTable += `| ${cellTexts.join(" | ")} |\n`;
                  if (rIdx === 0) {
                    mdTable += `| ${cells.map(() => "---").join(" | ")} |\n`;
                  }
                });
                return mdTable + "\n\n";
              }
              default: {
                const isBlock = ["div", "section", "article", "main", "aside"].includes(tag);
                return isBlock ? `\n\n${inner}\n\n` : ` ${inner} `;
              }
            }
          }

          let md = nodeToMd(clone);
          md = md.replace(/\n{3,}/g, "\n\n").trim();
          let truncated = false;
          if (maxLength && md.length > maxLength) {
            md = md.slice(0, maxLength) + `\n\n... [Truncated: ${md.length - maxLength} more characters]`;
            truncated = true;
          }

          const wordCount = md.split(/\s+/).filter(Boolean).length;
          return {
            title: document.title,
            url: location.href,
            markdown: md,
            characterCount: md.length,
            wordCount,
            truncated,
          };
        },
      });

      await injectAgentVisualCue(params.tabId, {
        label: `Markdown Extracted (${result.wordCount} words)`,
      });

      return { success: true, tabId: params.tabId, ...result };
    }

    case "extract_table": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [params.target || null, params.format || "json"],
        func: (target, format) => {
          let tableElements = [];
          if (target) {
            if (typeof target === "string" && target.startsWith("ref_")) {
              const el = document.querySelector(`[data-agent-ref="${target}"]`);
              if (el) tableElements = el.tagName.toLowerCase() === "table" ? [el] : Array.from(el.querySelectorAll("table"));
            } else {
              const el = document.querySelector(target);
              if (el) tableElements = el.tagName.toLowerCase() === "table" ? [el] : Array.from(el.querySelectorAll("table"));
            }
          }
          if (!tableElements.length) {
            tableElements = Array.from(document.querySelectorAll("table, [role='table'], [role='grid']"));
          }

          if (!tableElements.length) {
            return { count: 0, tables: [], message: "No tables found on page." };
          }

          const results = [];
          tableElements.forEach((tbl, tblIdx) => {
            const rows = Array.from(tbl.querySelectorAll("tr"));
            if (!rows.length) return;

            let headerCells = Array.from(rows[0].querySelectorAll("th"));
            let dataRowStart = 1;
            if (!headerCells.length) {
              headerCells = Array.from(rows[0].querySelectorAll("td"));
              dataRowStart = 1;
            }

            const headers = headerCells.map((c, i) => c.textContent.trim().replace(/\s+/g, " ") || `col_${i + 1}`);

            const parsedRows = [];
            for (let r = dataRowStart; r < rows.length; r++) {
              const cells = Array.from(rows[r].querySelectorAll("th, td"));
              if (!cells.length) continue;
              const rowObj = {};
              const rowArr = [];
              cells.forEach((cell, cIdx) => {
                const key = headers[cIdx] || `col_${cIdx + 1}`;
                const text = cell.textContent.trim().replace(/\s+/g, " ");
                const link = cell.querySelector("a[href]");
                const val = link ? { text, href: link.href } : text;
                rowObj[key] = val;
                rowArr.push(text);
              });
              parsedRows.push({ obj: rowObj, raw: rowArr });
            }

            let formattedOutput = null;
            if (format === "csv") {
              const escapeCsv = (val) => {
                const s = typeof val === "object" ? val.text : String(val);
                return `"${s.replace(/"/g, '""')}"`;
              };
              const csvLines = [headers.map(escapeCsv).join(",")];
              parsedRows.forEach((r) => {
                csvLines.push(headers.map((h) => escapeCsv(r.obj[h] || "")).join(","));
              });
              formattedOutput = csvLines.join("\n");
            } else if (format === "markdown") {
              let md = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
              parsedRows.forEach((r) => {
                md += `| ${headers.map((h) => (typeof r.obj[h] === "object" ? r.obj[h].text : r.obj[h] || "").replace(/\|/g, "\\|")).join(" | ")} |\n`;
              });
              formattedOutput = md;
            } else {
              formattedOutput = parsedRows.map((r) => r.obj);
            }

            results.push({
              index: tblIdx,
              id: tbl.id || null,
              caption: tbl.querySelector("caption")?.textContent.trim() || null,
              headers,
              rowCount: parsedRows.length,
              data: formattedOutput,
            });
          });

          return { count: results.length, tables: results };
        },
      });

      await injectAgentVisualCue(params.tabId, {
        label: `Table Extracted (${result.count} table${result.count === 1 ? "" : "s"})`,
      });

      return { success: true, tabId: params.tabId, ...result };
    }

    case "find_in_page": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      if (!params.query) throw new Error("Missing required query parameter");

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [
          params.query,
          params.caseSensitive ?? false,
          params.scrollToIndex !== undefined ? Number(params.scrollToIndex) : null,
        ],
        func: (query, caseSensitive, scrollToIndex) => {
          if (!query) return { totalMatches: 0, matches: [] };

          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const tag = parent.tagName.toLowerCase();
                if (["script", "style", "noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
                if (parent.id && parent.id.startsWith("__agent_")) return NodeFilter.FILTER_REJECT;
                const style = window.getComputedStyle(parent);
                if (style && (style.display === "none" || style.visibility === "hidden")) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
              },
            }
          );

          const q = caseSensitive ? query : query.toLowerCase();
          const matches = [];

          while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.nodeValue;
            const cmp = caseSensitive ? text : text.toLowerCase();
            let idx = cmp.indexOf(q);

            while (idx !== -1) {
              try {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + query.length);
                const rect = range.getBoundingClientRect();

                const snippetStart = Math.max(0, idx - 25);
                const snippetEnd = Math.min(text.length, idx + query.length + 25);
                const snippet =
                  (snippetStart > 0 ? "..." : "") +
                  text.slice(snippetStart, snippetEnd).trim() +
                  (snippetEnd < text.length ? "..." : "");

                matches.push({
                  index: matches.length,
                  snippet,
                  rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  },
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  tagName: node.parentElement ? node.parentElement.tagName.toLowerCase() : "text",
                });
              } catch {}

              idx = cmp.indexOf(q, idx + query.length);
            }
          }

          let scrolledMatch = null;
          if (scrollToIndex !== null && matches[scrollToIndex]) {
            scrolledMatch = matches[scrollToIndex];
            window.scrollTo({
              top: Math.max(0, window.scrollY + scrolledMatch.rect.y - window.innerHeight / 2),
              behavior: "smooth",
            });
          }

          return {
            query,
            totalMatches: matches.length,
            matches: matches.slice(0, 50),
            scrolledTo: scrolledMatch ? scrollToIndex : null,
            scrolledTarget: scrolledMatch || null,
          };
        },
      });

      if (result.scrolledTarget) {
        await injectAgentVisualCue(params.tabId, {
          type: "click",
          x: result.scrolledTarget.x,
          y: result.scrolledTarget.y,
          rect: result.scrolledTarget.rect,
          label: `Found "${params.query}" (${result.totalMatches} matches)`,
        });
      } else {
        await injectAgentVisualCue(params.tabId, {
          type: "scroll",
          label: `Find "${params.query}": ${result.totalMatches} matches`,
        });
      }

      return { success: true, tabId: params.tabId, ...result };
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
      let rect = null;

      if (target) {
        const info = await resolveElementInfo(params.tabId, target);
        if (!info) throw new Error(`Element "${target}" not found.`);
        x = info.x;
        y = info.y;
        rect = info.rect;
      }

      if (x === undefined || y === undefined) {
        throw new Error("Must specify target ref/selector or exact x, y coordinates.");
      }

      // Visual Agent Cursor & HUD cue
      await injectAgentVisualCue(params.tabId, {
        type: params.actionType === "type" ? "type" : "click",
        x,
        y,
        rect,
        label: params.actionType === "type" && params.text
          ? `Type: "${params.text}"`
          : "Click",
      });

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
      let rect = null;
      if (params.target) {
        const info = await resolveElementInfo(params.tabId, params.target);
        if (!info) throw new Error(`Target "${params.target}" not found.`);
        x = info.x;
        y = info.y;
        rect = info.rect;
      }
      if (x !== undefined && y !== undefined) {
        await injectAgentVisualCue(params.tabId, {
          type: "hover",
          x,
          y,
          rect,
          label: "Hover",
        });
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

      await injectAgentVisualCue(params.tabId, {
        type: "drag",
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
        label: "Drag & Drop",
      });

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

      await injectAgentVisualCue(params.tabId, {
        type: "type",
        x: info.x,
        y: info.y,
        rect: info.rect,
        label: `Fill: "${params.value || ""}"`,
      });

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
      const key = params.key;
      const code = params.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key);

      await injectAgentVisualCue(params.tabId, {
        type: "key",
        key,
        label: `Key: ${key}`,
      });

      await attachDebuggerIfNeeded(params.tabId);

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
      let info = null;
      if (params.target) {
        info = await resolveElementInfo(params.tabId, params.target);
      }
      if (info) {
        await injectAgentVisualCue(params.tabId, {
          type: "type",
          x: info.x,
          y: info.y,
          rect: info.rect,
          label: `Type: "${params.text || ""}"`,
        });
      } else {
        await injectAgentVisualCue(params.tabId, {
          type: "type",
          label: `Type: "${params.text || ""}"`,
        });
      }

      await attachDebuggerIfNeeded(params.tabId);
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

    case "select_option": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const target = params.target || params.ref;
      if (!target) throw new Error("Missing required target or ref parameter");

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [target, params.value, params.label, params.index],
        func: (targetSel, val, lbl, idx) => {
          function findEl(root, sel) {
            try {
              if (typeof sel === "string" && (sel.startsWith("ref_") || sel.startsWith("ref-"))) {
                const el = root.querySelector(`[data-agent-ref="${sel}"]`);
                if (el) return el;
              }
              const direct = root.querySelector(sel);
              if (direct) return direct;
              const all = root.querySelectorAll("*");
              for (const node of all) {
                if (node.shadowRoot) {
                  const found = findEl(node.shadowRoot, sel);
                  if (found) return found;
                }
                if (node.tagName && node.tagName.toLowerCase() === "iframe") {
                  try {
                    const found = findEl(node.contentDocument, sel);
                    if (found) return found;
                  } catch {}
                }
              }
            } catch {}
            return null;
          }

          let el = findEl(document, targetSel);
          if (!el) return { error: `Element "${targetSel}" not found.` };
          if (el.tagName.toLowerCase() !== "select") {
            const nested = el.querySelector("select");
            if (nested) el = nested;
            else return { error: `Element is not a <select> element (found <${el.tagName.toLowerCase()}>)` };
          }

          const options = Array.from(el.options);
          let matchedIdx = -1;

          if (val !== undefined && val !== null) {
            matchedIdx = options.findIndex((o) => o.value === String(val));
          }
          if (matchedIdx === -1 && lbl !== undefined && lbl !== null) {
            const queryLbl = String(lbl).trim().toLowerCase();
            matchedIdx = options.findIndex((o) => o.text.trim().toLowerCase() === queryLbl);
            if (matchedIdx === -1) {
              matchedIdx = options.findIndex((o) => o.text.trim().toLowerCase().includes(queryLbl));
            }
          }
          if (matchedIdx === -1 && idx !== undefined && idx !== null) {
            const num = Number(idx);
            if (num >= 0 && num < options.length) matchedIdx = num;
          }

          if (matchedIdx === -1) {
            return {
              error: `No matching option found for value="${val}", label="${lbl}", index=${idx}`,
              availableOptions: options.map((o, i) => ({ index: i, value: o.value, text: o.text.trim() })),
            };
          }

          el.selectedIndex = matchedIdx;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));

          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const rect = el.getBoundingClientRect();

          return {
            success: true,
            selectedIndex: matchedIdx,
            value: options[matchedIdx].value,
            text: options[matchedIdx].text.trim(),
            totalOptions: options.length,
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        },
      });

      if (result.error) throw new Error(result.error);

      await injectAgentVisualCue(params.tabId, {
        type: "click",
        x: result.x,
        y: result.y,
        rect: result.rect,
        label: `Selected: "${result.text}"`,
      });

      return { success: true, tabId: params.tabId, target, ...result };
    }

    case "set_checked": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const target = params.target || params.ref;
      if (!target) throw new Error("Missing required target or ref parameter");
      if (params.checked === undefined) throw new Error("Missing required checked (boolean) parameter");

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [target, Boolean(params.checked)],
        func: (targetSel, shouldCheck) => {
          function findEl(root, sel) {
            try {
              if (typeof sel === "string" && (sel.startsWith("ref_") || sel.startsWith("ref-"))) {
                const el = root.querySelector(`[data-agent-ref="${sel}"]`);
                if (el) return el;
              }
              const direct = root.querySelector(sel);
              if (direct) return direct;
              const all = root.querySelectorAll("*");
              for (const node of all) {
                if (node.shadowRoot) {
                  const found = findEl(node.shadowRoot, sel);
                  if (found) return found;
                }
                if (node.tagName && node.tagName.toLowerCase() === "iframe") {
                  try {
                    const found = findEl(node.contentDocument, sel);
                    if (found) return found;
                  } catch {}
                }
              }
            } catch {}
            return null;
          }

          let el = findEl(document, targetSel);
          if (!el) return { error: `Element "${targetSel}" not found.` };
          if (!("checked" in el)) {
            const nested = el.querySelector("input[type='checkbox'], input[type='radio']");
            if (nested) el = nested;
            else return { error: `Element does not support checked state (<${el.tagName.toLowerCase()}>)` };
          }

          const prev = el.checked;
          el.checked = shouldCheck;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));

          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const rect = el.getBoundingClientRect();

          return {
            success: true,
            checked: el.checked,
            previousState: prev,
            changed: prev !== el.checked,
            type: el.type || "checkbox",
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        },
      });

      if (result.error) throw new Error(result.error);

      await injectAgentVisualCue(params.tabId, {
        type: "check",
        checked: result.checked,
        x: result.x,
        y: result.y,
        rect: result.rect,
        label: `${result.checked ? "Checked" : "Unchecked"} ${result.type}`,
      });

      return { success: true, tabId: params.tabId, target, ...result };
    }

    case "download_file": {
      if (!params.url) throw new Error("Missing required url parameter");
      const options = {
        url: params.url,
        conflictAction: params.conflictAction || "uniquify",
        saveAs: params.saveAs ?? false,
      };
      if (params.filename) options.filename = params.filename;

      const downloadId = await chrome.downloads.download(options);

      if (params.tabId) {
        await injectAgentVisualCue(params.tabId, {
          label: `Downloading: ${params.filename || "file"}`,
        });
      }

      return {
        success: true,
        downloadId,
        url: params.url,
        filename: params.filename || null,
      };
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
      const format = params.format === "jpeg" ? "jpeg" : "png";
      const cmdParams = { format };
      if (format === "jpeg" && params.quality !== undefined) {
        cmdParams.quality = Math.max(0, Math.min(100, params.quality));
      }

      if (params.target) {
        const info = await resolveElementInfo(params.tabId, params.target);
        if (!info || !info.rect) {
          throw new Error(`Target element "${params.target}" not found for screenshot.`);
        }
        cmdParams.clip = {
          x: info.rect.x,
          y: info.rect.y,
          width: Math.max(1, info.rect.width),
          height: Math.max(1, info.rect.height),
          scale: 1,
        };
      } else if (params.fullPage) {
        const metrics = await chrome.debugger.sendCommand(
          { tabId: params.tabId },
          "Page.getLayoutMetrics"
        );
        const width = Math.ceil(metrics.cssContentSize ? metrics.cssContentSize.width : metrics.contentSize.width);
        const height = Math.ceil(metrics.cssContentSize ? metrics.cssContentSize.height : metrics.contentSize.height);
        cmdParams.clip = { x: 0, y: 0, width, height, scale: 1 };
        cmdParams.captureBeyondViewport = true;
      }

      const { data } = await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Page.captureScreenshot",
        cmdParams
      );
      return {
        base64Png: data,
        base64Image: data,
        format,
        mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      };
    }

    case "print_to_pdf": {
      await attachDebuggerIfNeeded(params.tabId);
      const printOptions = {
        landscape: params.landscape ?? false,
        displayHeaderFooter: params.displayHeaderFooter ?? false,
        printBackground: params.printBackground ?? true,
        scale: params.scale ?? 1,
        paperWidth: params.paperWidth ?? 8.5,
        paperHeight: params.paperHeight ?? 11,
        marginTop: params.marginTop ?? 0.4,
        marginBottom: params.marginBottom ?? 0.4,
        marginLeft: params.marginLeft ?? 0.4,
        marginRight: params.marginRight ?? 0.4,
        pageRanges: params.pageRanges || "",
      };
      const { data } = await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Page.printToPDF",
        printOptions
      );
      return {
        success: true,
        tabId: params.tabId,
        base64Pdf: data,
        sizeBytes: Math.round((data.length * 3) / 4),
      };
    }

    case "wait_for_download": {
      const timeoutMs = params.timeoutMs || 30000;
      return new Promise((resolve, reject) => {
        let timer = null;
        let trackedDownloadId = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          chrome.downloads.onCreated.removeListener(createListener);
          chrome.downloads.onChanged.removeListener(changeListener);
        };

        timer = setTimeout(() => {
          cleanup();
          resolve({ timedOut: true, message: `No download completed within ${timeoutMs}ms.` });
        }, timeoutMs);

        function createListener(item) {
          if (!trackedDownloadId) {
            trackedDownloadId = item.id;
          }
        }

        function changeListener(delta) {
          if (trackedDownloadId && delta.id === trackedDownloadId) {
            if (delta.state && delta.state.current === "complete") {
              chrome.downloads.search({ id: trackedDownloadId }).then(([item]) => {
                cleanup();
                resolve({
                  success: true,
                  downloadId: item.id,
                  filename: item.filename,
                  fileSize: item.fileSize,
                  mimeType: item.mime,
                  url: item.url,
                  state: "complete",
                });
              });
            } else if (delta.error) {
              cleanup();
              reject(new Error(`Download failed: ${delta.error.current}`));
            }
          }
        }

        chrome.downloads.onCreated.addListener(createListener);
        chrome.downloads.onChanged.addListener(changeListener);
      });
    }

    case "list_downloads": {
      const limit = params.limit || 10;
      const query = { limit, orderBy: ["-startTime"] };
      if (params.query) query.query = [params.query];
      const items = await chrome.downloads.search(query);
      return {
        count: items.length,
        downloads: items.map((d) => ({
          id: d.id,
          filename: d.filename,
          url: d.url,
          fileSize: d.fileSize,
          mime: d.mime,
          state: d.state,
          startTime: d.startTime,
          endTime: d.endTime,
        })),
      };
    }

    case "request_human_takeover": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const reason = params.reason || "The AI Agent requires your interaction (e.g. 2FA, CAPTCHA, or confirmation).";
      const timeoutMs = params.timeoutMs || 120000;

      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [reason],
        func: (msg) => {
          let banner = document.getElementById("__agent_takeover_banner");
          if (!banner) {
            banner = document.createElement("div");
            banner.id = "__agent_takeover_banner";
            banner.style.cssText = `
              position: fixed;
              top: 16px;
              left: 50%;
              transform: translateX(-50%);
              z-index: 2147483647;
              background: #0f172a;
              color: #f8fafc;
              border: 2px solid #38bdf8;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.4);
              padding: 12px 20px;
              border-radius: 12px;
              display: flex;
              align-items: center;
              gap: 16px;
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 14px;
              font-weight: 500;
              transition: all 0.2s ease;
            `;
            const textSpan = document.createElement("span");
            textSpan.id = "__agent_takeover_text";
            textSpan.style.cssText = "display: flex; align-items: center; gap: 8px;";
            textSpan.innerHTML = `<span style="font-size: 18px;">🤖</span> <strong>Agent Paused:</strong> <span style="color: #cbd5e1;">${msg}</span>`;

            const btn = document.createElement("button");
            btn.id = "__agent_takeover_resume_btn";
            btn.innerText = "Resume Agent ➔";
            btn.style.cssText = `
              background: #0284c7;
              color: white;
              border: none;
              padding: 8px 14px;
              border-radius: 8px;
              font-weight: 600;
              font-size: 13px;
              cursor: pointer;
              box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
            `;
            btn.addEventListener("click", () => {
              window.__agentTakeoverResumed = true;
              if (banner) banner.remove();
            });

            banner.appendChild(textSpan);
            banner.appendChild(btn);
            document.body.appendChild(banner);
          }
          window.__agentTakeoverResumed = false;
        },
      });

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: params.tabId },
          func: () => Boolean(window.__agentTakeoverResumed),
        });

        if (result) {
          return {
            success: true,
            resumed: true,
            elapsedSeconds: Math.round((Date.now() - start) / 1000),
          };
        }
        await new Promise((r) => setTimeout(r, 600));
      }

      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        func: () => {
          const b = document.getElementById("__agent_takeover_banner");
          if (b) b.remove();
        },
      });

      return {
        success: false,
        resumed: false,
        timedOut: true,
        message: `User takeover timed out after ${Math.round(timeoutMs / 1000)}s.`,
      };
    }

    case "clipboard": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const operation = params.operation || "get";
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [operation, params.text || ""],
        func: async (op, textToSet) => {
          if (op === "set") {
            await navigator.clipboard.writeText(textToSet);
            return { operation: "set", success: true, text: textToSet };
          }
          const text = await navigator.clipboard.readText();
          return { operation: "get", success: true, text };
        },
      });
      if (params.operation === "set") {
        await injectAgentVisualCue(params.tabId, {
          type: "type",
          label: `Clipboard Copy: "${(params.text || "").slice(0, 35)}"`,
        });
      }
      return { success: true, tabId: params.tabId, ...result };
    }

    case "manage_tab_group": {
      const { action = "group", tabIds, title, color } = params;
      if (!tabIds || !tabIds.length) throw new Error("Missing tabIds array for tab group operation.");

      if (action === "ungroup") {
        await chrome.tabs.ungroup(tabIds);
        return { success: true, action: "ungroup", tabIds };
      }

      const groupId = await chrome.tabs.group({ tabIds });
      const updateData = {};
      if (title) updateData.title = title;
      if (color) updateData.color = color;
      if (action === "collapse") updateData.collapsed = true;
      if (action === "expand") updateData.collapsed = false;

      if (Object.keys(updateData).length > 0) {
        await chrome.tabGroups.update(groupId, updateData);
      }

      return {
        success: true,
        groupId,
        tabIds,
        title: title || undefined,
        color: color || undefined,
        collapsed: updateData.collapsed ?? false,
      };
    }

    case "block_urls": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      await attachDebuggerIfNeeded(params.tabId);
      const patterns = params.clear
        ? []
        : Array.isArray(params.patterns)
        ? params.patterns
        : [params.patterns].filter(Boolean);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.setBlockedURLs", {
        urls: patterns,
      });
      return { success: true, tabId: params.tabId, blockedPatterns: patterns, count: patterns.length };
    }

    case "set_extra_headers": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      await attachDebuggerIfNeeded(params.tabId);
      const headers = params.clear ? {} : params.headers || {};
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.setExtraHTTPHeaders", {
        headers,
      });
      return { success: true, tabId: params.tabId, headers, count: Object.keys(headers).length };
    }

    case "mock_route": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      await attachDebuggerIfNeeded(params.tabId);
      if (params.clear) {
        tabMockRoutes.delete(params.tabId);
        try {
          await chrome.debugger.sendCommand({ tabId: params.tabId }, "Fetch.disable");
        } catch {}
        return { success: true, tabId: params.tabId, cleared: true };
      }

      if (!params.urlPattern) throw new Error("Missing required urlPattern parameter");

      let bodyStr = "";
      if (typeof params.responseBody === "object") {
        bodyStr = JSON.stringify(params.responseBody);
      } else {
        bodyStr = String(params.responseBody || "");
      }
      const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));

      const current = tabMockRoutes.get(params.tabId) || [];
      current.push({
        urlPattern: params.urlPattern,
        status: params.status || 200,
        headers: params.headers || {},
        bodyBase64,
      });
      tabMockRoutes.set(params.tabId, current);

      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });

      return {
        success: true,
        tabId: params.tabId,
        urlPattern: params.urlPattern,
        status: params.status || 200,
        totalMocks: current.length,
      };
    }

    case "search_bookmarks": {
      const query = params.query || "";
      const results = await chrome.bookmarks.search(query);
      return { success: true, query, count: results.length, bookmarks: results.slice(0, params.limit || 50) };
    }

    case "add_bookmark": {
      if (!params.title || !params.url) throw new Error("Missing required title and url parameters");
      const bookmark = await chrome.bookmarks.create({
        title: params.title,
        url: params.url,
        parentId: params.parentId || undefined,
      });
      return { success: true, bookmark };
    }

    case "search_history": {
      const text = params.query || "";
      const maxResults = params.limit || 50;
      const startTime = params.startTime ? Number(params.startTime) : Date.now() - 7 * 24 * 60 * 60 * 1000;
      const items = await chrome.history.search({
        text,
        startTime,
        maxResults,
      });
      return { success: true, query: text, count: items.length, history: items };
    }

    case "show_notification": {
      const notifId = "agent_notif_" + Date.now();
      await chrome.notifications.create(notifId, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon48.png"),
        title: params.title || "Agent Bridge MCP",
        message: params.message || "Task completed.",
        priority: 2,
      });
      return { success: true, notificationId: notifId, title: params.title, message: params.message };
    }

    case "media_control": {
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
    }

    case "mute_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const muted = Boolean(params.muted);
      await chrome.tabs.update(params.tabId, { muted });
      return { success: true, tabId: params.tabId, muted };
    }

    case "get_subtitles": {
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
    }

    case "duplicate_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const tab = await chrome.tabs.duplicate(params.tabId);
      return { success: true, tabId: tab.id, originalTabId: params.tabId, url: tab.url };
    }

    case "pin_tab": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      const pinned = Boolean(params.pinned);
      await chrome.tabs.update(params.tabId, { pinned });
      return { success: true, tabId: params.tabId, pinned };
    }

    case "set_zoom": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      if (params.zoomFactor !== undefined) {
        await chrome.tabs.setZoom(params.tabId, Number(params.zoomFactor));
      }
      const currentZoom = await chrome.tabs.getZoom(params.tabId);
      return { success: true, tabId: params.tabId, zoomFactor: currentZoom };
    }

    case "emulate_timezone": {
      if (!params.tabId) throw new Error("Missing required tabId parameter");
      if (!params.timezoneId) throw new Error("Missing required timezoneId parameter (e.g. 'America/New_York')");
      let cdpSuccess = false;
      try {
        await attachDebuggerIfNeeded(params.tabId);
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setTimezoneOverride", {
          timezoneId: params.timezoneId,
        });
        cdpSuccess = true;
      } catch {
        // Fall back to script-level Intl.DateTimeFormat override
        await chrome.scripting.executeScript({
          target: { tabId: params.tabId },
          args: [params.timezoneId],
          func: (tz) => {
            try {
              const OrigDateTimeFormat = Intl.DateTimeFormat;
              Intl.DateTimeFormat = function (...args) {
                const instance = new OrigDateTimeFormat(...args);
                const origResolved = instance.resolvedOptions.bind(instance);
                instance.resolvedOptions = () => Object.assign(origResolved(), { timeZone: tz });
                return instance;
              };
              window.__emulatedTimezone = tz;
            } catch {}
          },
        });
      }
      return { success: true, tabId: params.tabId, timezoneId: params.timezoneId, mode: cdpSuccess ? "cdp" : "dom_emulation" };
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
          activeRpcCount++;
          currentExecutingAction = msg.action;
          lastAgentActionTime = Date.now();
          updateBadge();
          try {
            const result = await handleRpc(msg.action, msg.params);
            logAgentAction(msg.action, msg.params, result, null);
            ws.send(JSON.stringify({ id: msg.id, result }));
          } catch (err) {
            logAgentAction(msg.action, msg.params, null, err);
            ws.send(JSON.stringify({ id: msg.id, error: err.message }));
          } finally {
            activeRpcCount = Math.max(0, activeRpcCount - 1);
            if (activeRpcCount === 0) currentExecutingAction = null;
            updateBadge();
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
            debuggerAttached: attachedTabs.has(activeTabs[0].id),
          }
        : null;

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
        isBusy: activeRpcCount > 0,
        currentAction: currentExecutingAction,
        lastActionTime: lastAgentActionTime,
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
