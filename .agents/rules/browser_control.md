# Browser Control & Automation Rule

When interacting with the browser, automating tasks, inspecting web pages, clicking elements, reading tabs, or debugging:

1. **ALWAYS prioritize `custom-browser-bridge` tools (`browser_*`)**:
   - `custom-browser-bridge` connects directly to the user's live browser profile where the **Agent Bridge** extension is installed (retaining all active logins, cookies, and open tabs).
   - Use `browser_list_tabs` to find existing open tabs.
   - Use `browser_get_interactive_snapshot` to assign deterministic `data-agent-ref` IDs (`ref_1`, `ref_2`...) to clickable buttons, inputs, and links.
   - Use `browser_act_on_ref` to interact with elements (this renders a glowing visual ring on the user's screen and dispatches trusted hardware CDP events).
   - Use `browser_read_all_tabs` to read text across all open tabs simultaneously.
   - Use `browser_navigate` to open new URLs in the user's active browser.

2. **DO NOT call `new_page`, `navigate_page`, or `list_pages` from `chrome-devtools-mcp`**:
   - `chrome-devtools-mcp` spawns a detached, isolated Chrome instance without user cookies or extension bridges, which opens an unwanted blank browser tab/window.
   - Only use `chrome-devtools-mcp` if the user explicitly asks for a standalone Lighthouse audit (`lighthouse_audit`).
