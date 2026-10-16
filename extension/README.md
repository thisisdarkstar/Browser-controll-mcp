# Agent Bridge MCP — Chrome Extension

> **Manifest V3 browser extension that bridges your live browser profile (Chrome, Edge, Brave) directly to AI coding assistants via the Model Context Protocol (MCP).**

Supported Agents: **Google Antigravity**, **Claude Desktop / Claude Code**, **Cursor**, **Windsurf**, and any MCP client.

---

## 🌟 Overview

Standard browser automation tools (like default `chrome-devtools-mcp` or Puppeteer) launch an **isolated, empty browser window** with `--remote-debugging-port`. You lose all your saved logins, cookies, session history, bookmarks, and open tabs.

**Agent Bridge MCP** solves this by running as a lightweight Manifest V3 extension inside your **everyday browser**:
- **Full Active Sessions**: Control tabs where you are already logged into GitHub, Jira, AWS, Slack, email, or internal company portals.
- **Visual Action Overlay**: Every click, scroll, and keystroke made by the agent highlights with a glowing cyan indicator on your screen.
- **Privacy Killswitch**: Instantly toggle agent control ON or OFF at any moment directly from the extension popup.
- **Deterministic `ref` Targeting**: Assigns persistent `data-agent-ref` IDs (`ref_1`, `ref_2`...) to visible interactive elements so agents never misclick.
- **Audit Log**: Review a real-time rolling log of every action taken by the AI in the popup.

---

## 🚀 Installation

### Option 1: Load Unpacked (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/browser-control-extension.git
   ```
2. Open your browser and navigate to the extensions page:
   - **Google Chrome**: `chrome://extensions/`
   - **Microsoft Edge**: `edge://extensions/`
   - **Brave Browser**: `brave://extensions/`
3. Toggle **Developer mode** ON (top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the **`extension/`** directory in this repository.
6. Pin the **Agent Bridge MCP** extension icon to your browser toolbar.

---

## ⚙️ Connecting to Your AI Agent

1. Make sure your MCP server is configured in your AI agent using the published npm package:
   ```json
   {
     "mcpServers": {
       "agent-browser-bridge": {
         "command": "npx",
         "args": ["-y", "agent-browser-bridge"]
       }
     }
   }
   ```
2. Open the extension popup by clicking its icon in the browser toolbar.
3. The badge will show **`ON`** (green) when connected to the local MCP bridge on `127.0.0.1:18922`.

---

## 🖥️ Extension Popup Interface (5 Tabs)

Click the extension icon in your browser toolbar to open the control panel:

| Tab | Purpose |
|---|---|
| **⚡ Control** | Main dashboard with the **Allow Agent Control** killswitch, port selector, active profile badge, and real-time telemetry counters. |
| **📑 Tabs** | Live list of all open browser tabs across windows. Search tabs, focus any tab, or close tabs with a single click. |
| **⏱️ Activity** | Real-time audit log of the last 30 actions executed by the agent (click, type, navigate, screenshot) with exact timestamps and success/failure indicators. |
| **📋 Setup** | Copy-paste ready configuration snippets for **Antigravity**, **Claude Desktop**, **Cursor**, and **Windsurf** (supports both `npx` and local paths). |
| **🩺 Doctor** | Built-in connection diagnostic runner. Tests WebSocket connectivity, port status, and agent readiness. |

---

## 🔒 Permissions & Security

We believe in complete transparency regarding extension permissions:

| Permission | Why It's Needed |
|---|---|
| `debugger` | Attaches Chrome DevTools Protocol (CDP) to individual tabs to dispatch trusted hardware-level mouse/keyboard events, capture screenshots, and read performance metrics. |
| `tabs` | Lists, focuses, opens, reloads, and closes tabs requested by the AI assistant. |
| `scripting` | Extracts structured accessibility snapshots, reads page text, and renders the visual action highlight overlay. |
| `storage` | Saves your local settings (profile name, custom port, killswitch state) across browser restarts. |
| `cookies` | Allows the agent to inspect or clear cookies when debugging authentication workflows. |
| `<all_urls>` | Required so the agent can interact with pages across different domains you ask it to inspect. |

### Privacy Commitments
- **100% Local**: Communicates exclusively over `127.0.0.1` (localhost). No data is ever sent to external cloud servers or analytics services.
- **User First**: You can disable agent control instantly with one toggle in the popup or close tabs anytime.

---

## 📄 License

Apache-2.0
