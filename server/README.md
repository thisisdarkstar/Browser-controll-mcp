# agent-browser-bridge

> **Live multi-tab, multi-profile Chrome DevTools Protocol (CDP) Model Context Protocol (MCP) server for AI coding agents.**

Works with **Antigravity**, **Claude Desktop / Claude Code**, **Cursor**, **Windsurf**, and any MCP client.

Unlike standard `chrome-devtools-mcp` (which requires launching a fresh, isolated Chrome instance without your logins or extensions), **`agent-browser-bridge` connects directly to your everyday browser profile** (Chrome, Edge, Brave) with all your active sessions, cookies, open tabs, and logged-in web apps intact.

---

## 🚀 Quick Start (Zero Install)

Add `agent-browser-bridge` to your agent's MCP configuration:

### 1. Google Antigravity
In your workspace `.agents/mcp_config.json` or global config:
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

### 2. Claude Desktop
In `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
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

### 3. Cursor & Windsurf
Add a new MCP server in settings:
- **Type**: `command`
- **Command**: `npx -y agent-browser-bridge`

---

## 🧩 Browser Extension Setup

1. Install the companion extension from the Chrome Web Store (or load unpacked from source).
2. Open the extension popup in your browser — ensure it shows **"Connected"** (port `18922`).
3. Your AI agent now has full, real-time control over the browser profile!

---

## 🛠️ Complete Tool Catalog (39 Tools)

### Multi-Profile & Tab Management
- `browser_list_profiles`: List all connected browser profiles (Work, Personal, Brave, Edge).
- `browser_list_tabs`: List open tabs across all browser windows.
- `browser_switch_tab`: Focus a tab and bring its browser window to the foreground.
- `browser_new_tab`: Open a new tab with an optional URL.
- `browser_close_tab`: Close a tab by tabId.
- `browser_navigate`: Navigate an existing tab or open a new URL.
- `browser_reload`: Reload tab with optional cache bypass.
- `browser_read_all_tabs`: Extract visible text and metadata from every open tab at once.

### DOM, Visual Refs & CSS Styling
- `browser_get_interactive_snapshot`: Map interactive elements with deterministic `data-agent-ref` IDs (`ref_1`, `ref_2`...) and coordinates.
- `browser_take_snapshot`: Accessibility (a11y) tree text snapshot matching `chrome-devtools-mcp`.
- `browser_get_css_styles`: Inspect computed CSS styles for any element by ref or selector.
- `browser_wait_for`: Wait for specific text or CSS selector to appear on the page.

### Precision Hardware-Level Input
- `browser_act_on_ref`: Visual highlight overlay + click or text input on a `data-agent-ref`.
- `browser_click`: Hardware CDP mouse click (by ref, selector, or x/y coordinates).
- `browser_hover`: Trigger mouse hover states.
- `browser_drag`: Drag and drop from source element/coords to destination element/coords.
- `browser_fill`: Clear and fill an input or textarea with text.
- `browser_fill_form`: Fill multiple form fields simultaneously given a map of `{ selector_or_ref: value }`.
- `browser_press_key`: Press keyboard keys or shortcuts (`Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`).
- `browser_type_text`: Type text into current focus or target element.
- `browser_upload_file`: Upload local file(s) into file input elements (`DOM.setFileInputFiles`).
- `browser_handle_dialog`: Accept or dismiss JavaScript `alert()`, `confirm()`, or `prompt()` dialogs.

### Device & Network Emulation
- `browser_resize_page`: Set viewport dimensions (width, height, deviceScaleFactor, mobile).
- `browser_emulate`: Emulate dark/light color scheme, CPU throttling, network conditions, Geolocation, or User Agent.

### Network, Cookies & Local Storage
- `browser_list_network_requests`: List recorded network requests for a tab.
- `browser_get_network_request`: Get full details and headers for a specific requestId.
- `browser_get_network_body`: Fetch raw response body for any recorded network request.
- `browser_get_cookies`: Retrieve cookies for a tab's URL.
- `browser_set_cookie`: Set a cookie (name, value, domain, path, secure, httpOnly).
- `browser_clear_cookies`: Clear all cookies for the profile.
- `browser_storage`: Read, write, or clear `localStorage` / `sessionStorage`.

### Console, Telemetry & Diagnostics
- `browser_list_console_messages`: List captured console logs, warnings, errors, and uncaught exceptions with stack traces.
- `browser_get_telemetry`: Combined telemetry snapshot (console logs, network requests, dialog events).

### Performance, Memory & Screenshots
- `browser_screenshot`: Capture high-resolution PNG tab screenshot.
- `browser_take_heapsnapshot`: V8 heap snapshot for memory leak analysis.
- `browser_performance_trace`: Start or stop Chrome performance timeline trace.
- `browser_performance_analyze_insight`: Extract Core Web Vitals (TTFB, FCP, DOMContentLoaded, LoadTime).

### JavaScript Execution & Raw CDP Escape Hatch
- `browser_eval_js`: Evaluate arbitrary JavaScript in the tab context with async/await.
- `browser_raw_cdp`: Execute ANY Chrome DevTools Protocol command with custom parameters.

---

## 🔒 Security & Privacy

- **Local-Only**: Only binds to `127.0.0.1:18922` by default. Never exposes ports to external networks.
- **Instant Killswitch**: Toggle "Allow Agent Control" off anytime in the extension popup to instantly freeze agent access.
- **Visual Action Overlay**: Every click and keystroke displays a glowing cyan overlay on your screen so you can clearly see what the agent is doing.

---

## 📄 License

Apache-2.0
