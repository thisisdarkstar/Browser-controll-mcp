# Agent Bridge MCP: Full-Spectrum Browser Control for AI Agents

> **Connect Google Antigravity, Claude Desktop, Cursor, and Windsurf directly to your everyday browser profile with active logins, cookies, and open tabs via the Model Context Protocol (MCP).**

[![npm version](https://img.shields.io/npm/v/agent-browser-bridge.svg)](https://www.npmjs.com/package/agent-browser-bridge)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/)

---

## 🌟 Compared to Standard `chrome-devtools-mcp`

| Feature | Standard `chrome-devtools-mcp` | Agent Bridge MCP |
|---|---|---|
| **Runs on Any User Profile** | ❌ Requires launching a fresh instance with `--remote-debugging-port` | ✅ **Yes!** Controls your active personal, work, or dev profiles with logins & sessions intact |
| **Multi-Profile Awareness** | ❌ Single browser instance only | ✅ **Yes!** Connects multiple profiles concurrently (Work, Personal) with dynamic routing |
| **Zero Installation Needed** | ❌ Requires local clones / setup | ✅ **Yes!** Run anywhere via `npx -y agent-browser-bridge` |
| **Deterministic `ref` Targeting** | ❌ Vision coordinate guessing or basic a11y | ✅ **Yes!** Assigns `data-agent-ref` IDs (`ref_1`, `ref_2`...) with visual highlight ring |
| **Visual Action Ring** | ❌ Invisible | ✅ **Yes!** Shows a glowing cyan action overlay on the page during clicks & typing |
| **All-Tab Visibility** | ❌ One tab at a time | ✅ **Yes!** `browser_read_all_tabs` reads text across all open tabs simultaneously |
| **Killswitch Privacy Toggle** | ❌ None | ✅ **Yes!** Instant "Allow Agent Control" switch in the extension popup |
| **Full CDP Coverage** | ⚠️ 30 tools | ✅ **39 tools** (includes all DevTools tools + cookies + storage + multi-profile + heap profiler) |

---

## 🚀 Quick Start (Zero Install)

### 1. Add to your AI Agent

#### Google Antigravity
Add to your global `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json`:
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

#### Claude Desktop
Add under `mcpServers` in `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
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

#### Cursor & Windsurf
Add a new MCP server in Settings:
- **Type**: `command`
- **Command**: `npx -y agent-browser-bridge`

---

### 2. Install the Browser Extension

1. Open Chrome/Edge/Brave and navigate to `chrome://extensions/`
2. Turn ON **Developer mode** (top-right).
3. Click **Load unpacked** and select the [`extension/`](./extension) folder from this repository.
4. Pin the extension to your toolbar. The badge will show **`ON`** (green) once connected!

---

## 🛠️ Complete Tool Catalog (39 Tools)

### 1. Multi-Profile & Tab Management
- `browser_list_profiles`: List all connected browser profiles (e.g. Work, Personal), IDs, and active status.
- `browser_list_tabs`: List open tabs across all browser windows (URL, title, ID, active state, debugger status).
- `browser_switch_tab`: Focus a tab and bring its browser window to the foreground.
- `browser_new_tab`: Open a new tab with an optional URL.
- `browser_close_tab`: Close a tab by tabId.
- `browser_navigate`: Navigate an existing tab or open a new URL.
- `browser_reload`: Reload tab with optional cache bypass.
- `browser_read_all_tabs`: Extract text and metadata from all open tabs in one shot.

### 2. Snapshots, DOM & CSS Styling
- `browser_get_interactive_snapshot`: Map interactive elements with `data-agent-ref` IDs (`ref_1`, `ref_2`...), coordinates, tag, text, and roles.
- `browser_take_snapshot`: Accessibility (a11y) tree snapshot matching `chrome-devtools-mcp`.
- `browser_get_css_styles`: Inspect computed CSS styles (display, color, font, box-shadow, z-index, etc.) for any element by ref or selector.
- `browser_wait_for`: Wait for specific text or CSS selector to appear on the page with a timeout.

### 3. Precision Hardware-Level Input
- `browser_act_on_ref`: Visual highlight overlay + click or text input on a `data-agent-ref`.
- `browser_click`: Click element (by ref, selector, or x/y coordinates) with button selection ('left', 'right', 'middle') and clickCount.
- `browser_hover`: Hover over element or coordinates triggering hover states.
- `browser_drag`: Drag and drop from source element/coords to destination element/coords.
- `browser_fill`: Clear and fill an input or textarea with text.
- `browser_fill_form`: Fill multiple form fields simultaneously given a map of `{ selector_or_ref: value }`.
- `browser_press_key`: Press keyboard keys or shortcuts (`Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`).
- `browser_type_text`: Type text into current focus or target element.
- `browser_upload_file`: Upload local file(s) into file input elements (`DOM.setFileInputFiles`).
- `browser_handle_dialog`: Accept or dismiss JavaScript `alert()`, `confirm()`, `prompt()`, or `beforeunload` dialogs.

### 4. Device & Network Emulation
- `browser_resize_page`: Emulate viewport dimensions (width, height, deviceScaleFactor, mobile).
- `browser_emulate`: Emulate dark/light color scheme, CPU throttling (1x-20x), network throttling (Offline, Slow 3G, Fast 3G, 4G), Geolocation (`lat,lng`), or User Agent.

### 5. Network, Cookies & Local Storage
- `browser_list_network_requests`: List recorded network requests for a tab (status, method, url, resourceType, mimeType, timestamp).
- `browser_get_network_request`: Get full details and headers for a specific requestId.
- `browser_get_network_body`: Fetch raw response body for any recorded network request.
- `browser_get_cookies`: Retrieve cookies for a tab's URL.
- `browser_set_cookie`: Set a cookie (name, value, domain, path, secure, httpOnly).
- `browser_clear_cookies`: Clear all cookies for the profile.
- `browser_storage`: Read, write, or clear `localStorage` / `sessionStorage`.

### 6. Console, Telemetry & Diagnostics
- `browser_list_console_messages`: List captured console logs, warnings, errors, and uncaught exceptions with stack traces.
- `browser_get_telemetry`: Combined telemetry snapshot (console logs, network requests, dialog events).

### 7. Performance & Screenshots
- `browser_screenshot`: Capture high-resolution PNG tab screenshot.
- `browser_take_heapsnapshot`: Capture V8 heap snapshot for memory leak analysis.
- `browser_performance_trace`: Start or stop Chrome performance timeline trace.
- `browser_performance_analyze_insight`: Extract Core Web Vitals (TTFB, FCP, DOMContentLoaded, LoadTime).

### 8. JavaScript Execution & Raw CDP Escape Hatch
- `browser_eval_js`: Evaluate arbitrary JavaScript in the tab context with async/await and return serialized values.
- `browser_raw_cdp`: Absolute escape hatch: execute ANY Chrome DevTools Protocol command with custom parameters.

---

## 🔒 Security & Privacy

- **Localhost Only**: Only communicates via `127.0.0.1:18922`. Never exposes ports or traffic outside your machine.
- **Instant Killswitch**: Toggle "Allow Agent Control" off anytime in the extension popup to immediately freeze all agent actions.
- **Visual Action Overlay**: Every click and keystroke displays a glowing cyan overlay on your screen so you can see what the agent is doing in real time.

---

## 📂 Project Structure

```
browser-control-extension/
├── extension/          # Manifest V3 browser extension (Chrome, Edge, Brave)
│   ├── background.js   # Service worker with multi-tab CDP dispatcher
│   ├── manifest.json   # Extension manifest V3
│   ├── popup/          # 5-tab control panel UI (Control, Tabs, Activity, Setup, Doctor)
│   └── README.md       # Extension setup and permissions documentation
├── server/             # MCP server (published as agent-browser-bridge on npm)
│   ├── bin/cli.js      # CLI executable for npx execution
│   ├── index.js        # Master/Relay MCP server with 39 tools
│   ├── package.json    # Package definition and npm metadata
│   └── README.md       # npm package documentation
└── .agents/            # Agent skills and guidelines
    └── skills/
        └── custom-browser-bridge/SKILL.md
```

---

## 📄 License

Apache-2.0
