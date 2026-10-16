// Agent Bridge MCP - Ultra-Refined Popup Controller v2.0

// DOM Elements - Status & Navigation
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const detectedProfileHeader = document.getElementById("detectedProfileHeader");
const privacyBadge = document.getElementById("privacyBadge");
const notification = document.getElementById("notification");

// Navigation Tabs
const navTabs = document.querySelectorAll(".nav-tab");
const tabPanels = document.querySelectorAll(".tab-panel");
const tabCountBadge = document.getElementById("tabCountBadge");
const activityCountBadge = document.getElementById("activityCountBadge");

// Control Panel Elements
const agentControlToggle = document.getElementById("agentControlToggle");
const toggleDescription = document.getElementById("toggleDescription");
const profileNameInput = document.getElementById("profileNameInput");
const wsPortInput = document.getElementById("wsPortInput");
const browserTypeDisplay = document.getElementById("browserTypeDisplay");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const openTabsCount = document.getElementById("openTabsCount");
const cdpSessionsCount = document.getElementById("cdpSessionsCount");
const totalActionsCount = document.getElementById("totalActionsCount");

// Tabs Manager Elements
const tabSearchInput = document.getElementById("tabSearchInput");
const tabsListContainer = document.getElementById("tabsListContainer");
const newTabBtn = document.getElementById("newTabBtn");

// Activity Feed Elements
const activityFeedContainer = document.getElementById("activityFeedContainer");
const clearActivityBtn = document.getElementById("clearActivityBtn");

// Setup Panel Elements
const agentPills = document.querySelectorAll(".agent-pill");
const modeNpxBtn = document.getElementById("modeNpxBtn");
const modeLocalBtn = document.getElementById("modeLocalBtn");
const configFilename = document.getElementById("configFilename");
const mcpConfigCodeBlock = document.getElementById("mcpConfigCodeBlock");
const copyMcpConfigBtn = document.getElementById("copyMcpConfigBtn");
const copyIcon = document.getElementById("copyIcon");
const copyBtnText = document.getElementById("copyBtnText");
const configHelpText = document.getElementById("configHelpText");

// Doctor Panel Elements
const runDiagnosticsBtn = document.getElementById("runDiagnosticsBtn");
const forceReconnectBtn = document.getElementById("forceReconnectBtn");
const diagWsStatus = document.getElementById("diagWsStatus");
const diagHttpHealth = document.getElementById("diagHttpHealth");
const diagLatency = document.getElementById("diagLatency");
const diagPid = document.getElementById("diagPid");
const diagProfiles = document.getElementById("diagProfiles");

// State
let currentAgent = "antigravity";
let currentPackageMode = "npx"; // "npx" or "local"
let cachedTabs = [];
let pollInterval = null;

// ---------------------------------------------------------------------------
// Toast Notification
// ---------------------------------------------------------------------------
function showToast(message, duration = 2400) {
  notification.textContent = message;
  notification.classList.remove("hidden");
  setTimeout(() => {
    notification.classList.add("hidden");
  }, duration);
}

// ---------------------------------------------------------------------------
// Tab Navigation Switching
// ---------------------------------------------------------------------------
function switchTab(tabId) {
  navTabs.forEach((tab) => {
    if (tab.dataset.tab === tabId) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  tabPanels.forEach((panel) => {
    if (panel.id === `panel${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`) {
      panel.classList.add("active");
    } else {
      panel.classList.remove("active");
    }
  });

  sessionStorage.setItem("active_popup_tab", tabId);

  // Lazy-load panel data
  if (tabId === "tabs") renderTabsList();
  if (tabId === "activity") renderActivityFeed();
  if (tabId === "setup") updateSnippet();
  if (tabId === "doctor") runDiagnostics();
}

navTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// ---------------------------------------------------------------------------
// Core Status & Control Panel
// ---------------------------------------------------------------------------
function updateUI(status) {
  if (!status) return;

  // Master Toggle & Privacy Badge
  agentControlToggle.checked = status.agentControlEnabled;
  if (!status.agentControlEnabled) {
    statusBadge.className = "status-pill disabled";
    statusText.textContent = "Control Paused";
    privacyBadge.className = "secure-badge";
    privacyBadge.style.color = "#fbbf24";
    privacyBadge.style.borderColor = "rgba(245, 158, 11, 0.4)";
    privacyBadge.textContent = "Paused";
    toggleDescription.textContent = "Agent control is paused for user privacy.";
  } else if (status.connected) {
    statusBadge.className = "status-pill connected";
    statusText.textContent = "Connected";
    privacyBadge.className = "secure-badge";
    privacyBadge.style.color = "#34d399";
    privacyBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
    privacyBadge.textContent = "Active";
    toggleDescription.textContent = `Bridge active on port ${status.wsPort}. Agents can inspect & control tabs.`;
  } else {
    statusBadge.className = "status-pill disconnected";
    statusText.textContent = "Disconnected";
    privacyBadge.className = "secure-badge";
    privacyBadge.style.color = "#f87171";
    privacyBadge.style.borderColor = "rgba(239, 68, 68, 0.4)";
    privacyBadge.textContent = "Waiting";
    toggleDescription.textContent = `Waiting for MCP server on http://127.0.0.1:${status.wsPort}`;
  }

  // Profile Header & Inputs
  if (status.profileName) {
    detectedProfileHeader.textContent = `${status.profileName} (${status.browser || "Chromium"})`;
    if (document.activeElement !== profileNameInput && profileNameInput.value === "") {
      profileNameInput.value = status.profileName;
    }
  }

  if (document.activeElement !== wsPortInput && (wsPortInput.value === "" || wsPortInput.value === "18922")) {
    wsPortInput.value = status.wsPort || 18922;
  }

  browserTypeDisplay.textContent = status.browser || "Chromium";

  // Metrics
  openTabsCount.textContent = status.tabCount ?? 0;
  tabCountBadge.textContent = status.tabCount ?? 0;
  cdpSessionsCount.textContent = status.debuggerAttachedCount ?? 0;
  totalActionsCount.textContent = status.totalActions ?? 0;
  activityCountBadge.textContent = status.totalActions ?? 0;

  // Diagnostics sync
  diagWsStatus.textContent = status.connected ? "🟢 Connected (Ready)" : "🔴 Not Connected";
  diagWsStatus.style.color = status.connected ? "#34d399" : "#fb7185";
}

function refreshStatus() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
    if (chrome.runtime.lastError) {
      statusBadge.className = "status-pill disconnected";
      statusText.textContent = "Offline";
      return;
    }
    updateUI(response);
  });
}

// Toggle master privacy switch
agentControlToggle.addEventListener("change", () => {
  const newEnabled = agentControlToggle.checked;
  chrome.runtime.sendMessage(
    {
      action: "updateConfig",
      newEnabled,
    },
    () => {
      showToast(newEnabled ? "Agent control enabled 🟢" : "Agent control paused ⏸️");
      refreshStatus();
    }
  );
});

// Save Profile Name & Port
saveConfigBtn.addEventListener("click", () => {
  const newProfileName = profileNameInput.value.trim();
  const newPort = Number(wsPortInput.value) || 18922;

  chrome.runtime.sendMessage(
    {
      action: "updateConfig",
      newProfileName,
      newPort,
      newEnabled: agentControlToggle.checked,
    },
    () => {
      showToast("Settings saved! Reconnecting...");
      setTimeout(refreshStatus, 800);
    }
  );
});

// ---------------------------------------------------------------------------
// Tabs Manager Panel
// ---------------------------------------------------------------------------
function renderTabsList() {
  chrome.runtime.sendMessage({ action: "getTabs" }, (tabs) => {
    if (chrome.runtime.lastError || !Array.isArray(tabs)) {
      tabsListContainer.innerHTML = '<div class="empty-feed"><p>Could not load tabs.</p></div>';
      return;
    }

    cachedTabs = tabs;
    tabCountBadge.textContent = tabs.length;
    filterAndDisplayTabs();
  });
}

function filterAndDisplayTabs() {
  const query = tabSearchInput.value.toLowerCase().trim();
  const filtered = cachedTabs.filter(
    (t) => (t.title && t.title.toLowerCase().includes(query)) || (t.url && t.url.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    tabsListContainer.innerHTML = `
      <div class="empty-feed">
        <p>${query ? "No tabs match search." : "No open tabs found."}</p>
      </div>`;
    return;
  }

  tabsListContainer.innerHTML = filtered
    .map((tab) => {
      const hostname = (() => {
        try {
          return new URL(tab.url).hostname;
        } catch {
          return tab.url;
        }
      })();

      const favSrc =
        tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")
          ? tab.favIconUrl
          : "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'><circle cx='12' cy='12' r='10'/></svg>";

      return `
      <div class="tab-item-card ${tab.active ? "is-active" : ""}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}">
        <img class="tab-fav" src="${favSrc}" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'%2364748b\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/></svg>'">
        <div class="tab-details">
          <div class="tab-title" title="${tab.title || "Untitled"}">${escapeHtml(tab.title || "Untitled")}</div>
          <div class="tab-url" title="${tab.url}">${escapeHtml(hostname)}</div>
        </div>
        <div class="tab-badges-row">
          ${tab.active ? '<span class="tab-pill active-pill">Active</span>' : ""}
          ${tab.debuggerAttached ? '<span class="tab-pill cdp-pill">CDP Attached</span>' : ""}
        </div>
        <button class="btn-tab-close" data-close-tab="${tab.id}" title="Close tab">✕</button>
      </div>
    `;
    })
    .join("");

  // Attach click listeners to cards & close buttons
  tabsListContainer.querySelectorAll(".tab-item-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-tab-close")) return;
      const tabId = Number(card.dataset.tabId);
      const windowId = Number(card.dataset.windowId);
      chrome.runtime.sendMessage({ action: "focusTab", tabId, windowId }, () => {
        showToast("Switched tab!");
        renderTabsList();
      });
    });
  });

  tabsListContainer.querySelectorAll(".btn-tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = Number(btn.dataset.closeTab);
      chrome.runtime.sendMessage({ action: "closeTab", tabId }, () => {
        renderTabsList();
      });
    });
  });
}

tabSearchInput.addEventListener("input", filterAndDisplayTabs);

newTabBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "createTab", url: "about:blank" }, () => {
    renderTabsList();
  });
});

// ---------------------------------------------------------------------------
// Activity Feed Panel
// ---------------------------------------------------------------------------
function renderActivityFeed() {
  chrome.runtime.sendMessage({ action: "getRecentActions" }, (response) => {
    if (chrome.runtime.lastError || !response || !Array.isArray(response.actions)) {
      return;
    }

    const actions = response.actions;
    activityCountBadge.textContent = response.totalCount ?? actions.length;

    if (actions.length === 0) {
      activityFeedContainer.innerHTML = `
        <div class="empty-feed">
          <div class="empty-icon">🤖</div>
          <p>No agent actions recorded yet.</p>
          <span>When Antigravity or another agent interacts with tabs, clicks buttons, or inspects DOM, live audit logs will stream here.</span>
        </div>`;
      return;
    }

    activityFeedContainer.innerHTML = actions
      .map((item) => {
        const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour12: false });
        const isSuccess = item.success !== false;
        return `
        <div class="activity-item">
          <div class="activity-top-row">
            <span class="action-pill">${escapeHtml(item.action)}</span>
            <span class="activity-time">${timeStr}</span>
          </div>
          <div class="activity-detail">
            ${isSuccess ? "🟢" : "🔴"} 
            ${item.target ? `<strong>${escapeHtml(String(item.target))}</strong> ` : ""}
            ${item.error ? `<span style="color:#fb7185">${escapeHtml(item.error)}</span>` : escapeHtml(item.details)}
          </div>
        </div>
      `;
      })
      .join("");
  });
}

clearActivityBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "clearRecentActions" }, () => {
    renderActivityFeed();
    showToast("Activity log cleared.");
  });
});

// ---------------------------------------------------------------------------
// Setup & Snippet Generator Panel
// ---------------------------------------------------------------------------
agentPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    agentPills.forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    currentAgent = pill.dataset.agent;
    updateSnippet();
  });
});

modeNpxBtn.addEventListener("click", () => {
  modeNpxBtn.classList.add("active");
  modeLocalBtn.classList.remove("active");
  currentPackageMode = "npx";
  updateSnippet();
});

modeLocalBtn.addEventListener("click", () => {
  modeLocalBtn.classList.add("active");
  modeNpxBtn.classList.remove("active");
  currentPackageMode = "local";
  updateSnippet();
});

function updateSnippet() {
  const isNpx = currentPackageMode === "npx";
  let snippet = "";
  let filename = "mcp_config.json";
  let help = "";

  const command = isNpx ? "npx" : "node";
  const args = isNpx ? ["-y", "agent-browser-bridge"] : ["d:/Projects/browser-control-extension/server/index.js"];

  if (currentAgent === "antigravity") {
    filename = "mcp_config.json";
    help = "Add to your Antigravity MCP settings (`mcp_config.json`) or Installed MCP Servers panel.";
    snippet = JSON.stringify(
      {
        "custom-browser-bridge": {
          command,
          args,
        },
      },
      null,
      2
    );
  } else if (currentAgent === "claude") {
    filename = "claude_desktop_config.json";
    help = "Add under 'mcpServers' in your Claude Desktop configuration file.";
    snippet = JSON.stringify(
      {
        mcpServers: {
          "agent-browser-bridge": {
            command,
            args,
          },
        },
      },
      null,
      2
    );
  } else if (currentAgent === "cursor") {
    filename = ".cursor/mcp.json";
    help = "Add under 'mcpServers' in Cursor Settings > MCP Servers or `.cursor/mcp.json`.";
    snippet = JSON.stringify(
      {
        mcpServers: {
          "agent-browser-bridge": {
            command,
            args,
          },
        },
      },
      null,
      2
    );
  } else if (currentAgent === "windsurf") {
    filename = "mcp_config.json";
    help = "Add under 'mcpServers' in Windsurf / Cascade MCP configuration.";
    snippet = JSON.stringify(
      {
        mcpServers: {
          "agent-browser-bridge": {
            command,
            args,
          },
        },
      },
      null,
      2
    );
  } else if (currentAgent === "http") {
    filename = "PowerShell / Terminal";
    help = "Control your browser profile directly via HTTP without MCP using any terminal or script.";
    snippet = `# 1. Test bridge health\nInvoke-RestMethod -Uri "http://127.0.0.1:18922/health"\n\n# 2. Query open tabs\n$body = '{"action":"list_tabs"}'\n(Invoke-RestMethod -Uri "http://127.0.0.1:18922/rpc" -Method Post -Body $body -ContentType "application/json").result`;
  }

  configFilename.textContent = filename;
  configHelpText.textContent = help;
  mcpConfigCodeBlock.textContent = snippet;
}

copyMcpConfigBtn.addEventListener("click", () => {
  const text = mcpConfigCodeBlock.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyIcon.textContent = "✅";
    copyBtnText.textContent = "Copied!";
    showToast("MCP configuration copied to clipboard!");
    setTimeout(() => {
      copyIcon.textContent = "📋";
      copyBtnText.textContent = "Copy Config";
    }, 2000);
  });
});

// ---------------------------------------------------------------------------
// Doctor & Diagnostics Panel
// ---------------------------------------------------------------------------
function runDiagnostics() {
  const port = Number(wsPortInput.value) || 18922;
  diagHttpHealth.textContent = "Testing...";
  diagLatency.textContent = "Measuring...";
  diagPid.textContent = "Querying...";
  diagProfiles.textContent = "Checking...";

  const startTime = performance.now();
  chrome.runtime.sendMessage({ action: "pingMaster" }, (res) => {
    const latency = Math.round(performance.now() - startTime);

    if (res && res.ok && res.data) {
      diagHttpHealth.textContent = `🟢 200 OK (${res.data.status || "healthy"})`;
      diagHttpHealth.style.color = "#34d399";
      diagLatency.textContent = `${latency} ms`;
      diagLatency.style.color = latency < 50 ? "#34d399" : "#fbbf24";
      diagPid.textContent = res.data.pid ? String(res.data.pid) : "Active";
      diagProfiles.textContent = `${res.data.profiles ?? 1} profile(s) connected`;
    } else {
      diagHttpHealth.textContent = "🔴 Server not reachable on " + port;
      diagHttpHealth.style.color = "#fb7185";
      diagLatency.textContent = "Timeout / Refused";
      diagLatency.style.color = "#fb7185";
      diagPid.textContent = "—";
      diagProfiles.textContent = "0";
    }
  });
}

runDiagnosticsBtn.addEventListener("click", runDiagnostics);

forceReconnectBtn.addEventListener("click", () => {
  showToast("Reconnecting WebSocket bridge...");
  chrome.runtime.sendMessage({ action: "reconnect" }, () => {
    setTimeout(() => {
      refreshStatus();
      runDiagnostics();
    }, 1000);
  });
});

// ---------------------------------------------------------------------------
// Helper Utilities & Initialization
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initial setup
const savedTab = sessionStorage.getItem("active_popup_tab") || "control";
switchTab(savedTab);
refreshStatus();
updateSnippet();

// Poll status while popup is open
pollInterval = setInterval(() => {
  refreshStatus();
  const currentTab = sessionStorage.getItem("active_popup_tab") || "control";
  if (currentTab === "tabs") renderTabsList();
  if (currentTab === "activity") renderActivityFeed();
}, 2000);

window.addEventListener("unload", () => {
  if (pollInterval) clearInterval(pollInterval);
});
