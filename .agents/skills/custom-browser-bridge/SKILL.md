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
  version: v2.0
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
* **Multi-Profile Support**: Work, Personal, Brave, or Edge profiles can connect simultaneously. You can route any tool call to a specific profile with `profile: "Google Chrome (mercor)"` or profile ID.

---

## 🧰 Core Tool Reference (34 Tools)

### 1. Tab & Profile Management
* **`browser_list_profiles`**: List all connected browser profiles, their IDs, names, and active status.
* **`browser_list_tabs`**: List all open tabs across windows (`id`, `title`, `url`, `active`, `windowId`, `debuggerAttached`).
* **`browser_switch_tab`**: Focus a tab by `tabId` and bring its browser window to the foreground.
* **`browser_new_tab`**: Open a new tab with an optional `url`.
* **`browser_close_tab`**: Close a tab by `tabId`.
* **`browser_navigate`**: Navigate an existing tab to a `url` or open a new one.
* **`browser_reload`**: Reload a tab with optional `ignoreCache: true`.
* **`browser_read_all_tabs`**: Extract readable text and metadata from all open tabs in a single call.

### 2. Snapshots & Precision Element Interaction
* **`browser_get_interactive_snapshot`**: Maps all interactive elements on the page and assigns deterministic `data-agent-ref` IDs (`ref_1`, `ref_2`...) with coordinates, bounding boxes, tags, text, and roles.
* **`browser_take_snapshot`**: Accessibility (a11y) tree snapshot matching standard CDP.
* **`browser_act_on_ref`**: Dispatches `click` or `type` on a `data-agent-ref`. Renders a glowing cyan action ring on the user's screen confirming the exact target.
* **`browser_click`**: Hardware-level click by `selectorOrRef` or `(x, y)` coordinates, supporting `button: 'left' | 'right' | 'middle'` and `clickCount`.
* **`browser_fill`**: Clears and fills an input or textarea with `value`.
* **`browser_fill_form`**: Fills multiple form fields in one call using a `{ selector_or_ref: value }` map.
* **`browser_hover`**: Dispatches mouse hover over an element or coordinates to trigger dropdowns/tooltips.
* **`browser_drag`**: Drag-and-drop from source to destination.
* **`browser_press_key`**: Dispatches keyboard keys (`Enter`, `Tab`, `Escape`, `Backspace`, `ArrowDown`, etc.).
* **`browser_type_text`**: Types text into currently focused element or specified selector/ref.
* **`browser_wait_for`**: Waits for specific text or CSS selector to appear with `timeoutMs`.
* **`browser_handle_dialog`**: Accepts or dismisses JavaScript `alert()`, `confirm()`, `prompt()`, or `beforeunload` dialogs.

### 3. Execution & Escape Hatches (Most Versatile)
* **`browser_eval_js`**: **Primary workhorse for rich DOM extraction**. Evaluates arbitrary JavaScript inside the tab context with `awaitPromise: true` and `returnByValue: true`.
  * *Example*: Extract Slack channel messages, scrape dashboard cards, check unread indicators, or trigger SPA client-side actions.
* **`browser_raw_cdp`**: Absolute escape hatch to run any Chrome DevTools Protocol method (e.g. `DOM.getOuterHTML`, `Fetch.enable`, `Storage.getStorageKey`).

### 4. Network, Storage, Cookies & Telemetry
* **`browser_list_network_requests`**: List captured network requests for a tab (`requestId`, `url`, `method`, `status`, `mimeType`, `timestamp`).
* **`browser_get_network_request`**: Full request/response headers and timing for a `requestId`.
* **`browser_get_network_body`**: Fetches raw response body (JSON, text) for an API request.
* **`browser_get_cookies`** / **`browser_set_cookie`** / **`browser_clear_cookies`**: Manage browser cookies.
* **`browser_storage`**: Read, write, or clear `localStorage` / `sessionStorage`.
* **`browser_list_console_messages`**: Captures logs, warnings, errors, and uncaught exceptions with full stack traces.
* **`browser_get_telemetry`**: Combined telemetry snapshot (console logs, network requests, dialog events).

### 5. Visuals & Performance
* **`browser_screenshot`**: Captures high-res PNG screenshot of the tab.
* **`browser_resize_page`**: Resizes viewport dimensions.
* **`browser_emulate`**: Emulates dark/light color scheme, CPU throttling, network throttling (Offline, 3G, 4G), geolocation, or User-Agent.
* **`browser_take_heapsnapshot`**: V8 heap snapshot for debugging memory leaks.
* **`browser_performance_analyze_insight`**: Analyzes Core Web Vitals (TTFB, FCP, DOMContentLoaded, LoadTime).

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
