// Agent Bridge MCP - Core State & Profile Management (ES Module)

export const state = {
  wsSocket: null,
  currentPort: 18922,
  profileId: null,
  profileName: "Default Profile",
  agentControlEnabled: true,
  reconnectTimer: null,
  reconnectDelay: 2000,

  attachedTabs: new Set(),
  tabTelemetry: new Map(), // tabId -> { console: [], network: Map(), dialogs: [] }
  tabMockRoutes: new Map(), // tabId -> Array<{ urlPattern, status, headers, bodyBase64 }>
  activeTracingTab: null,
  activeTraceEvents: [],

  // Real-time Agent Action Audit Log & State
  recentActions: [], // Rolling buffer of last 30 actions
  totalActionCount: 0,
  activeRpcCount: 0,
  currentExecutingAction: null,
  lastAgentActionTime: null,
};

export function logAgentAction(action, params, result, error) {
  state.totalActionCount++;
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
  state.recentActions.unshift(item);
  if (state.recentActions.length > 30) state.recentActions.pop();
}

export function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Microsoft Edge";
  if (navigator.brave && typeof navigator.brave.isBrave === "function") return "Brave";
  if (ua.includes("Chrome/")) return "Google Chrome";
  return "Chromium Browser";
}

export async function initProfile() {
  const stored = await chrome.storage.local.get([
    "profileId",
    "profileName",
    "wsPort",
    "agentControlEnabled",
  ]);

  if (stored.profileId) {
    state.profileId = stored.profileId;
  } else {
    state.profileId = "profile_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    await chrome.storage.local.set({ profileId: state.profileId });
  }

  if (stored.profileName) {
    state.profileName = stored.profileName;
  } else {
    state.profileName = `${detectBrowser()} (${state.profileId.slice(-4)})`;
    await chrome.storage.local.set({ profileName: state.profileName });
  }

  if (stored.wsPort) {
    state.currentPort = Number(stored.wsPort) || 18922;
  }

  if (stored.agentControlEnabled !== undefined) {
    state.agentControlEnabled = Boolean(stored.agentControlEnabled);
  }

  updateBadge();
}

export function updateBadge() {
  if (!state.agentControlEnabled) {
    chrome.action.setBadgeText({ text: "PAUSE" });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    chrome.action.setTitle({ title: `Agent Bridge: Control Disabled (${state.profileName})` });
    return;
  }

  if (state.activeRpcCount > 0) {
    chrome.action.setBadgeText({ text: "RUN" });
    chrome.action.setBadgeBackgroundColor({ color: "#00e5ff" });
    chrome.action.setTitle({ title: `Agent Bridge: Executing ${state.currentExecutingAction || "action"}...` });
    return;
  }

  if (state.wsSocket && state.wsSocket.readyState === WebSocket.OPEN) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    chrome.action.setTitle({ title: `Agent Bridge: Connected to MCP (${state.profileName})` });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
    chrome.action.setTitle({ title: `Agent Bridge: Disconnected (Port ${state.currentPort})` });
  }
}

export function ensureTabStore(tabId) {
  if (!state.tabTelemetry.has(tabId)) {
    state.tabTelemetry.set(tabId, { console: [], network: new Map(), dialogs: [] });
  }
  return state.tabTelemetry.get(tabId);
}

