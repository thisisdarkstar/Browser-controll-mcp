---
name: custom-browser-bridge
description: >-
  Full-spectrum browser control and automation over the user's live browser profile
  (Chrome, Edge, Brave) with active logins, cookies, and open tabs via the Agent Bridge MCP
  extension (custom-browser-bridge). Use whenever inspecting or interacting with live web apps
  (Slack, Mercor Studio, Jira, GitHub, dashboards), reading open tabs, clicking elements,
  filling forms, capturing screenshots, debugging console/network, or running browser automation.
license: Apache-2.0
metadata:
  version: v2.2.0
  publisher: local
---

# Custom Browser Bridge (`custom-browser-bridge`) Skill

This skill guides agents in controlling the user's real, active browser profile (Chrome, Edge, Brave) through the **Agent Bridge MCP** server (`custom-browser-bridge`) located at `D:\Projects\browser-control-extension`.

---

## 🚨 Cardinal Rules & Tool Hierarchy

> [!IMPORTANT]
> **Core Tool Rule (from `.agents/rules/browser_control.md`)**:
> 
> 1. **ALWAYS prioritize `custom-browser-bridge` tools (`browser_*`)** over `chrome-devtools-mcp` tools (`list_pages`, `new_page`, `navigate_page`).
>    * `custom-browser-bridge` connects directly to the user's **real browser profile** where the **Agent Bridge MCP** extension is loaded. This retains all active user logins, cookies, sessions, and open tabs (Slack, Mercor Studio, AWS, GitHub, Jira, email, Google accounts, etc.).
> 2. **DO NOT call `new_page`, `navigate_page`, or `list_pages` from `chrome-devtools-mcp`**:
>    * `chrome-devtools-mcp` launches a detached, isolated Chrome instance without user cookies or extension bridges, which opens an unwanted blank browser tab/window (`about:blank`).
> 3. **Exception**: Only use `chrome-devtools-mcp` if the user explicitly asks for a standalone Lighthouse performance audit (`lighthouse_audit`).

---

## 🏗️ Architecture & How It Works

* **Chrome Extension (MV3)**: `D:\Projects\browser-control-extension\extension`. Loaded in the user's browser. Attached via `chrome.debugger` (CDP 1.3).
* **MCP Server**: `D:\Projects\browser-control-extension\server\index.js`.
  * **Master Server**: Binds `http://127.0.0.1:18922` and `ws://127.0.0.1:18922`. Extension connects over WebSocket and registers active profiles.
  * **Relay Client**: If port 18922 is already in use by another Antigravity instance/window, subsequent instances seamlessly act as Relay Clients forwarding calls to `http://127.0.0.1:18922/rpc`.
* **Multi-Profile Support**: Work, Personal, Brave, or Edge profiles can connect simultaneously. You can route any tool call to a specific profile with `profile: "Google Chrome (arnab)"` or profile ID.

---

## 🧰 Core Tool Reference (68 Tools)

### 1. Tab, Window & Navigation Management
* **`browser_list_profiles`**: List all connected browser profiles, their IDs, names, and active status.
* **`browser_list_tabs`**: List all open tabs across windows (`id`, `title`, `url`, `active`, `windowId`, `debuggerAttached`).
* **`browser_switch_tab`**: Focus a tab by `tabId` and bring its browser window to the foreground.
* **`browser_new_tab`**: Open a new tab with an optional `url`.
* **`browser_close_tab`**: Close a tab by `tabId`.
* **`browser_duplicate_tab`**: Duplicates an existing tab with its state and history.
* **`browser_pin_tab`**: Pin or unpin a tab to dock it in the browser tab strip.
* **`browser_set_zoom`**: Get or set tab zoom level (e.g. `1.0`, `1.25`, `0.8`).
* **`browser_navigate`**: Navigate an existing tab to a `url` or open a new one with optional `waitFor: "load" | "domcontentloaded" | "none"` and `timeoutMs`.
* **`browser_go_back`**: Navigate back in browser history.
* **`browser_go_forward`**: Navigate forward in browser history.
* **`browser_scroll`**: Scroll page or specific scrollable container by direction (`up`, `down`, `top`, `bottom`, `left`, `right`), `distance` (px), or scroll an element into view (`target`).
* **`browser_manage_tab_group`**: Group agent-opened tabs into named and colored tab groups (`group`, `ungroup`, `collapse`, `expand`).
* **`browser_reload`**: Reload a tab with optional `ignoreCache: true`.
* **`browser_read_all_tabs`**: Extract readable text and metadata from all open tabs in a single call.

### 2. Smart Content & Table Extraction (LLM Token Optimizers)
* **`browser_get_markdown`**: Converts full page or specific container into clean GitHub-flavored Markdown (stripping navbars, ads, scripts) for massive LLM token savings.
* **`browser_extract_table`**: Automatically detects and parses `<table>` elements or repeating data grids into clean structured JSON, CSV, or Markdown tables.
* **`browser_find_in_page`**: Programmatic in-page text search (Ctrl+F). Returns total matches, surrounding snippets, coordinates, and smoothly scrolls to match $N$ with glowing highlight.

### 3. Precision DOM & Form Interaction
* **`browser_get_interactive_snapshot`**: Maps all interactive elements on the page (including Web Components & open Shadow DOM), returning `data-agent-ref` IDs (`ref_1`, `ref_2`...) with coordinates, bounding boxes, tags, text, form context (`formId`), and optional `viewportOnly: true` filtering.
* **`browser_take_snapshot`**: Accessibility (a11y) tree snapshot matching standard CDP.
* **`browser_get_css_styles`**: Inspect computed CSS styling for any ref or selector.
* **`browser_act_on_ref`**: Dispatches `click` or `type` on a `data-agent-ref`. Renders a live virtual cyan cursor, action tooltip pill (`🤖`), expanding shockwave ripple, and glowing cyan bounding box.
* **`browser_click`**: Hardware-level click by `selectorOrRef` or `(x, y)` coordinates, supporting `button: 'left' | 'right' | 'middle'` and `clickCount` with live cursor and shockwave ripple visual cues.
* **`browser_fill`**: Clears and fills an input or textarea with `value` with live typing HUD tooltip.
* **`browser_fill_form`**: Fills multiple form fields in one call using a `{ selector_or_ref: value }` map.
* **`browser_select_option`**: Deterministically picks an option from a `<select>` dropdown by value, label, or index.
* **`browser_set_checked`**: Explicitly sets checkboxes or radio buttons to `checked: true | false`.
* **`browser_hover`**: Dispatches mouse hover over an element or coordinates to trigger dropdowns/tooltips with smooth virtual cursor movement.
* **`browser_drag`**: Drag-and-drop from source to destination with smooth animated cursor trajectory.
* **`browser_press_key`**: Dispatches keyboard keys (`Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`, etc.).
* **`browser_type_text`**: Types text into currently focused element or specified selector/ref.
* **`browser_upload_file`**: Uploads local files to file input elements.
* **`browser_wait_for`**: Waits for specific text or CSS selector to appear with `timeoutMs`.
* **`browser_handle_dialog`**: Accepts or dismisses JavaScript `alert()`, `confirm()`, `prompt()`, or `beforeunload` dialogs.

### 4. User Context (Bookmarks, History & Desktop Alerts)
* **`browser_search_bookmarks`**: Searches user's browser bookmarks by keyword or folder name.
* **`browser_add_bookmark`**: Creates a new browser bookmark with title and URL.
* **`browser_search_history`**: Searches the user's browsing history by keyword and time range.
* **`browser_show_notification`**: Dispatches a native OS desktop alert notification.

### 5. Network Interception, Ad-Blocking & Routing
* **`browser_block_urls`**: Block specific URL patterns (e.g. `*analytics*`, `*ads*`, `*.gif`) via CDP `Network.setBlockedURLs` for 3x–5x faster browsing.
* **`browser_set_extra_headers`**: Injects custom HTTP headers across all outgoing tab requests (e.g. Authorization, X-Custom-Header).
* **`browser_mock_route`**: Intercepts HTTP requests matching a URL pattern and fulfills them with custom mock status, headers, and response body.

### 6. Media Controls (Audio & Video)
* **`browser_media_control`**: Full control over `<video>` and `<audio>` players (`play`, `pause`, `toggle`, `mute`, `unmute`, `seek`, `set_volume`, `set_speed`).
* **`browser_mute_tab`**: Mutes or unmutes audio on any tab.
* **`browser_get_subtitles`**: Extracts live captions or subtitles from active video players (YouTube, video tracks).

### 7. File Downloads & Human-in-the-Loop
* **`browser_download_file`**: Programmatically triggers a file download from a direct URL with custom filename.
* **`browser_wait_for_download`**: Tracks active downloads triggered on the page, returning the saved file path, size, and status.
* **`browser_list_downloads`**: Lists recent browser profile downloads with metadata.
* **`browser_request_human_takeover`**: Displays an interactive top banner asking the user to solve a CAPTCHA, 2FA prompt, or manual confirmation, pausing the agent until the user clicks "Resume Agent ➔".
* **`browser_clipboard`**: Read or copy text directly to/from the system clipboard.

### 8. Visuals, Screenshots & PDF Printing
* **`browser_screenshot`**: High-resolution screenshot supporting visible viewport, full scrollable page (`fullPage: true`), or clipped to a specific element (`target: "ref_5"`), with format options (`png` or compressed `jpeg` with `quality`).
* **`browser_print_to_pdf`**: Direct PDF generation via CDP `Page.printToPDF` with custom paper size, margins, and orientation.
* **`browser_resize_page`**: Resizes viewport dimensions.
* **`browser_emulate`**: Emulates dark/light color scheme, CPU throttling, network throttling (Offline, 3G, 4G), geolocation, or User-Agent.
* **`browser_emulate_timezone`**: Overrides browser timezone & locale.

### 9. Execution, Diagnostics & Escape Hatches
* **`browser_eval_js`**: Evaluates arbitrary JavaScript inside the tab context with `awaitPromise: true` and `returnByValue: true`.
* **`browser_raw_cdp`**: Absolute escape hatch to run any Chrome DevTools Protocol method.
* **`browser_list_network_requests`** / **`browser_get_network_request`** / **`browser_get_network_body`**: Inspect network traffic.
* **`browser_get_cookies`** / **`browser_set_cookie`** / **`browser_clear_cookies`**: Manage browser cookies.
* **`browser_storage`**: Read, write, or clear `localStorage` / `sessionStorage`.
* **`browser_list_console_messages`**: Captures logs, warnings, errors, and uncaught exceptions.
* **`browser_get_telemetry`**: Combined telemetry snapshot (console logs, network requests, dialog events).
* **`browser_take_heapsnapshot`**: V8 heap snapshot for debugging memory leaks.
* **`browser_performance_trace`** / **`browser_performance_analyze_insight`**: Performance and Core Web Vitals profiling.

---

## ⚡ Direct HTTP RPC Fallback (Instant PowerShell / Bash Access)

The Master Server runs a lightweight HTTP JSON-RPC endpoint at `http://127.0.0.1:18922`:

```powershell
# 1. Health check & profile list
Invoke-RestMethod -Uri "http://127.0.0.1:18922/health" -Method Get
Invoke-RestMethod -Uri "http://127.0.0.1:18922/profiles" -Method Get

# 2. List all open tabs
$body = '{"action":"list_tabs","params":{}}'
(Invoke-RestMethod -Uri "http://127.0.0.1:18922/rpc" -Method Post -ContentType "application/json" -Body $body).result

# 3. Evaluate JavaScript on any tab
$script = '(() => ({ title: document.title, url: window.location.href }))()'
$body = @{ action = "eval_js"; params = @{ tabId = <TAB_ID>; expression = $script } } | ConvertTo-Json
(Invoke-RestMethod -Uri "http://127.0.0.1:18922/rpc" -Method Post -ContentType "application/json" -Body $body).result.result.value
```

---

## ⚡ Direct HTTP RPC Fallback (Instant PowerShell / Bash Access)

The Master Server runs a lightweight HTTP JSON-RPC endpoint at `http://127.0.0.1:18922`:

```powershell
# 1. Health check & profile list
Invoke-RestMethod -Uri "http://127.0.0.1:18922/health" -Method Get
Invoke-RestMethod -Uri "http://127.0.0.1:18922/profiles" -Method Get

# 2. List all open tabs
$body = '{"action":"list_tabs","params":{}}'
(Invoke-RestMethod -Uri "http://127.0.0.1:18922/rpc" -Method Post -ContentType "application/json" -Body $body).result

# 3. Evaluate JavaScript on any tab
$script = '(() => ({ title: document.title, url: window.location.href }))()'
$body = @{ action = "eval_js"; params = @{ tabId = <TAB_ID>; expression = $script } } | ConvertTo-Json
(Invoke-RestMethod -Uri "http://127.0.0.1:18922/rpc" -Method Post -ContentType "application/json" -Body $body).result.result.value
```

---

## 📋 Standard Workflows & Recipes

### Recipe 1: Inspecting Logged-in Web Apps (Slack, Studio, GitHub)
1. Call `browser_list_tabs` to find the target tab ID and URL.
2. Call `browser_eval_js` with a self-contained IIFE `(() => { ... })()` to query elements, text, or states.
   * *Example*: Extract unread badges, channel titles, messages, or task statuses.
3. If clicking sidebar items or tabs, either trigger `.click()` in JS via `browser_eval_js` or use `browser_click`.

### Recipe 2: Deterministic Click & Form Fill
1. Call `browser_get_interactive_snapshot(tabId: <id>)`.
2. Locate the desired button or input by its label/role and note its ref (e.g. `ref_12`).
3. Call `browser_act_on_ref(tabId: <id>, ref: "ref_12", action: "click")` or `action: "type", text: "..."`.
4. A cyan action ring highlights the element on the user's screen.

### Recipe 3: Troubleshooting Connection & Port 18922
* If `browser_list_profiles` returns 0 profiles or fails:
  1. Check port 18922: `Get-NetTCPConnection -LocalPort 18922`.
  2. If an orphaned zombie node process is holding port 18922, terminate it.
  3. The extension has automatic reconnect logic (`scheduleReconnect()`) and will connect within 2 seconds.
