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

## 🛠️ Complete Tool Catalog (68 Tools)

### Multi-Profile & Tab Management
- `browser_list_profiles`: List all connected browser profiles (Work, Personal, Brave, Edge).
- `browser_list_tabs`: List open tabs across all browser windows.
- `browser_switch_tab`: Focus a tab and bring its browser window to the foreground.
- `browser_new_tab`: Open a new tab with an optional URL.
- `browser_close_tab`: Close a tab by tabId.
- `browser_duplicate_tab`: Duplicate an existing tab with its state and history.
- `browser_pin_tab`: Pin or unpin a tab in the browser tab strip.
- `browser_set_zoom`: Get or set zoom factor (1.0, 1.25, 0.8).
- `browser_navigate`: Navigate an existing tab or open a new URL.
- `browser_go_back`: Navigate back in history.
- `browser_go_forward`: Navigate forward in history.
- `browser_reload`: Reload tab with optional cache bypass.
- `browser_scroll`: Scroll viewport or container in any direction with velocity HUD.
- `browser_read_all_tabs`: Extract visible text and metadata from every open tab at once.
- `browser_manage_tab_group`: Group, ungroup, colorize, collapse, or expand tabs.

### Smart Content & Table Extraction
- `browser_get_markdown`: Clean Markdown conversion stripping boilerplate/ads.
- `browser_extract_table`: Structured table extraction to JSON, Markdown, or CSV.
- `browser_find_in_page`: In-page search (Ctrl+F) with smooth scrolling and match highlighting.

### DOM, Visual Refs & CSS Styling
- `browser_get_interactive_snapshot`: Map interactive elements with deterministic `data-agent-ref` IDs (`ref_1`, `ref_2`...) and coordinates.
- `browser_take_snapshot`: Accessibility (a11y) tree text snapshot matching `chrome-devtools-mcp`.
- `browser_get_css_styles`: Inspect computed CSS styles for any element by ref or selector.
- `browser_wait_for`: Wait for specific text or CSS selector to appear on the page.

### Precision Hardware-Level Input
- `browser_act_on_ref`: Visual highlight overlay + click or text input on a `data-agent-ref`.
- `browser_click`: Hardware CDP mouse click (by ref, selector, or x/y coordinates).
- `browser_hover`: Trigger mouse hover states.
- `browser_drag`: Drag and drop with animated laser trajectory.
- `browser_fill`: Clear and fill an input or textarea with text.
- `browser_fill_form`: Fill multiple form fields simultaneously.
- `browser_press_key`: Physical keyboard key press with 3D mechanical keycap popovers.
- `browser_type_text`: Type text into current focus or target element.
- `browser_select_option`: Select dropdown option by value, visible text, or index.
- `browser_set_checked`: Toggle checkbox or radio button with spring bloom animation.
- `browser_upload_file`: Upload local file(s) into file input elements (`DOM.setFileInputFiles`).
- `browser_handle_dialog`: Accept or dismiss JavaScript `alert()`, `confirm()`, or `prompt()` dialogs.

### User Context, Bookmarks & Desktop Notifications
- `browser_search_bookmarks`: Search bookmarks by keyword or folder.
- `browser_add_bookmark`: Create a new bookmark.
- `browser_search_history`: Search browsing history by query and time range.
- `browser_show_notification`: Display native OS desktop notifications.
- `browser_clipboard`: Read or copy text to/from system clipboard.
- `browser_download_file`: Trigger file download from URL.
- `browser_wait_for_download`: Track active downloads until completion.
- `browser_list_downloads`: List recent downloads in profile.

### Media Controls (Audio & Video)
- `browser_media_control`: Play, pause, seek, mute, volume, playback speed.
- `browser_mute_tab`: Mute/unmute all audio output for a tab.
- `browser_get_subtitles`: Extract live captions or video subtitles.

### Network Interception, Ad-Blocking & Routing
- `browser_block_urls`: Wildcard URL pattern blocking (`Network.setBlockedURLs`).
- `browser_set_extra_headers`: Custom HTTP header injection on outgoing requests.
- `browser_mock_route`: Real-time CDP Fetch route interception and custom response mocking.
- `browser_list_network_requests`: List recorded network requests for a tab.
- `browser_get_network_request`: Get full details and headers for a requestId.
- `browser_get_network_body`: Fetch raw response body for any recorded request.
- `browser_get_cookies`: Retrieve cookies for a tab's URL.
- `browser_set_cookie`: Set a cookie.
- `browser_clear_cookies`: Clear all cookies for the profile.
- `browser_storage`: Read, write, or clear `localStorage` / `sessionStorage`.

### Device & Network Emulation
- `browser_resize_page`: Set viewport dimensions (width, height, deviceScaleFactor, mobile).
- `browser_emulate`: Emulate dark/light mode, CPU throttling, network throttling, geolocation, user-agent.
- `browser_emulate_timezone`: Override timezone and locale.

### Diagnostics, Performance & Raw CDP
- `browser_screenshot`: Capture high-resolution PNG or JPEG tab screenshot.
- `browser_print_to_pdf`: Generate PDF document via `Page.printToPDF`.
- `browser_list_console_messages`: List captured console logs, warnings, errors, and stack traces.
- `browser_get_telemetry`: Combined telemetry snapshot (console, network, dialogs).
- `browser_take_heapsnapshot`: V8 heap snapshot for memory leak analysis.
- `browser_performance_trace`: Start or stop Chrome performance timeline trace.
- `browser_performance_analyze_insight`: Extract Core Web Vitals (TTFB, FCP, DOMContentLoaded, LoadTime).
- `browser_eval_js`: Evaluate arbitrary JavaScript in tab context with async/await.
- `browser_raw_cdp`: Execute ANY raw Chrome DevTools Protocol command.
- `browser_request_human_takeover`: Pause agent and display takeover banner for manual 2FA/CAPTCHA.
- `browser_reload_extension`: Hot reload the extension service worker.

---

## 🔒 Security & Privacy

- **Local-Only**: Only binds to `127.0.0.1:18922` by default. Never exposes ports to external networks.
- **Instant Killswitch**: Toggle "Allow Agent Control" off anytime in the extension popup to instantly freeze agent access.
- **Visual Action Overlay**: Every click and keystroke displays a glowing cyan overlay on your screen so you can clearly see what the agent is doing.

---

## 📄 License

Apache-2.0
