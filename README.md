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
| **Virtual Agent Cursor & Live HUD** | ❌ Invisible headless actions | ✅ **Yes!** Live cyan cursor gliding across elements, floating action tooltip (`🤖`), shockwave click ripples, scroll banners, & bounding box overlays |
| **All-Tab Visibility** | ❌ One tab at a time | ✅ **Yes!** `browser_read_all_tabs` reads text across all open tabs simultaneously |
| **Killswitch Privacy Toggle** | ❌ None | ✅ **Yes!** Instant "Allow Agent Control" switch in the extension popup |
| **Full CDP Coverage** | ⚠️ 30 tools | ✅ **68 tools** (DevTools tools + Markdown/Table extract + Ad-blocking + Bookmarks + History + Media + Desktop Alerts + Downloads + Groups) |

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

## 🛠️ Complete Tool Catalog (68 Tools)

### 1. Multi-Profile, Tab & Window Management
- `browser_list_profiles`: List all connected browser profiles (e.g. Work, Personal), IDs, and active status.
- `browser_list_tabs`: List open tabs across all browser windows (URL, title, ID, active state, debugger status).
- `browser_switch_tab`: Focus a tab and bring its browser window to the foreground.
- `browser_new_tab`: Open a new tab with an optional URL.
- `browser_close_tab`: Close a tab by tabId.
- `browser_duplicate_tab`: Duplicate any tab with its history and state intact.
- `browser_pin_tab`: Pin or unpin a tab to dock it in the browser tab bar.
- `browser_set_zoom`: Read or set page zoom level (e.g. 80%, 100%, 125%).
- `browser_navigate`: Navigate an existing tab or open a new URL with navigation lifecycle waiting (`load`, `domcontentloaded`, `none`).
- `browser_go_back`: Navigate back in history.
- `browser_go_forward`: Navigate forward in history.
- `browser_scroll`: Scroll page or scrollable containers (`up`, `down`, `top`, `bottom`, `left`, `right`, distance, or scroll element into view).
- `browser_manage_tab_group`: Organize, group, ungroup, collapse, or expand browser tabs with titles and colors.
- `browser_reload`: Reload tab with optional cache bypass.
- `browser_read_all_tabs`: Extract text and metadata from all open tabs in one shot.

### 2. Smart Content & Table Extraction (LLM Token Optimizers)
- `browser_get_markdown`: Extract clean GitHub-flavored Markdown from the active or specified tab, stripping navbars, ads, scripts, and clutter to maximize LLM token efficiency.
- `browser_extract_table`: Automatically detect and parse HTML `<table>` elements or repetitive data grids on the page into structured JSON, CSV, or Markdown tables.
- `browser_find_in_page`: Fast in-page text search (equivalent to Chrome Ctrl+F). Returns match count, surrounding snippets, coordinates, and can smoothly scroll to match #N with visual highlight.

### 3. Snapshots, DOM & CSS Styling
- `browser_get_interactive_snapshot`: Map interactive elements with `data-agent-ref` IDs (`ref_1`, `ref_2`...) with Shadow DOM traversal, form context (`formId`), and `viewportOnly` filtering.
- `browser_take_snapshot`: Accessibility (a11y) tree snapshot matching `chrome-devtools-mcp`.
- `browser_get_css_styles`: Inspect computed CSS styles (display, color, font, box-shadow, z-index, etc.) for any element by ref or selector.
- `browser_wait_for`: Wait for specific text or CSS selector to appear on the page with a timeout.

### 4. Precision Hardware-Level Input & Forms
- `browser_act_on_ref`: Visual highlight overlay + click or text input on a `data-agent-ref`.
- `browser_click`: Click element (by ref, selector, or x/y coordinates) with button selection ('left', 'right', 'middle') and clickCount.
- `browser_hover`: Hover over element or coordinates triggering hover states and smooth cursor glide.
- `browser_drag`: Drag and drop from source element/coords to destination element/coords.
- `browser_fill`: Clear and fill an input or textarea with text.
- `browser_fill_form`: Fill multiple form fields simultaneously given a map of `{ selector_or_ref: value }`.
- `browser_select_option`: Deterministically pick an option from a `<select>` dropdown by value, label, or index.
- `browser_set_checked`: Explicitly set checkboxes or radio buttons to `checked: true | false`.
- `browser_press_key`: Press keyboard keys or shortcuts (`Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`).
- `browser_type_text`: Type text into current focus or target element.
- `browser_upload_file`: Upload local file(s) into file input elements (`DOM.setFileInputFiles`).
- `browser_handle_dialog`: Accept or dismiss JavaScript `alert()`, `confirm()`, `prompt()`, or `beforeunload` dialogs.

### 5. User Context & Desktop Integration
- `browser_search_bookmarks`: Search personal browser bookmarks by query keyword or folder name.
- `browser_add_bookmark`: Create a new bookmark in the user's browser with title and URL.
- `browser_search_history`: Search user's browsing history by query keyword and time range.
- `browser_show_notification`: Display a native OS desktop notification from the browser (ideal for alerting user when a background agent task finishes).

### 6. Network Interception, Ad-Blocking & Routing
- `browser_block_urls`: Block specific URL patterns (e.g. `*analytics*`, `*ads*`, `*.gif`) via CDP `Network.setBlockedURLs` for 3x–5x faster browsing.
- `browser_set_extra_headers`: Inject custom HTTP headers into all outgoing requests in a tab (e.g. Authorization, X-Custom-Header, staging cookies).
- `browser_mock_route`: Intercept HTTP requests matching a URL pattern and return custom mock status, headers, and response body via CDP Fetch.
- `browser_list_network_requests`: List recorded network requests for a tab (status, method, url, resourceType, mimeType, timestamp).
- `browser_get_network_request`: Get full details and headers for a specific requestId.
- `browser_get_network_body`: Fetch raw response body for any recorded network request.
- `browser_get_cookies`: Retrieve cookies for a tab's URL.
- `browser_set_cookie`: Set a cookie (name, value, domain, path, secure, httpOnly).
- `browser_clear_cookies`: Clear all cookies for the profile.
- `browser_storage`: Read, write, or clear `localStorage` / `sessionStorage`.

### 7. Media Controls (Audio & Video)
- `browser_media_control`: Full control over `<video>` and `<audio>` players (`play`, `pause`, `toggle`, `mute`, `unmute`, `seek`, `set_volume`, `set_speed`).
- `browser_mute_tab`: Mute or unmute audio on any open browser tab.
- `browser_get_subtitles`: Extract live captions, subtitles, or text tracks from active video players on the page.

### 8. File Downloads & Human-in-the-Loop
- `browser_download_file`: Programmatically trigger a file download from a direct URL with custom filename.
- `browser_wait_for_download`: Track active downloads triggered by clicking "Export" or "Download", returning the saved file path, size, and status.
- `browser_list_downloads`: List recent downloads in the browser profile.
- `browser_request_human_takeover`: Display an interactive banner requesting user takeover (2FA, CAPTCHA, payment confirmation) and pause until resumed.
- `browser_clipboard`: Read or copy text directly to/from the system clipboard in the tab context.

### 9. Device & Network Emulation
- `browser_resize_page`: Emulate viewport dimensions (width, height, deviceScaleFactor, mobile).
- `browser_emulate`: Emulate dark/light color scheme, CPU throttling (1x-20x), network throttling (Offline, Slow 3G, Fast 3G, 4G), Geolocation (`lat,lng`), or User Agent.
- `browser_emulate_timezone`: Override browser timezone & locale using CDP Emulation or script fallback.

### 10. Visuals, Screenshots & Diagnostics
- `browser_screenshot`: Capture high-resolution PNG or compressed JPEG screenshot, full-page, or clipped to an element ref/selector.
- `browser_print_to_pdf`: Generate a PDF of the current webpage via Chrome DevTools `Page.printToPDF`.
- `browser_list_console_messages`: List captured console logs, warnings, errors, and uncaught exceptions with stack traces.
- `browser_get_telemetry`: Combined telemetry snapshot (console logs, network requests, dialog events).
- `browser_take_heapsnapshot`: Capture V8 heap snapshot for memory leak analysis.
- `browser_performance_trace`: Start or stop Chrome performance timeline trace.
- `browser_performance_analyze_insight`: Extract Core Web Vitals (TTFB, FCP, DOMContentLoaded, LoadTime).

### 11. JavaScript Execution & Raw CDP Escape Hatch
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
