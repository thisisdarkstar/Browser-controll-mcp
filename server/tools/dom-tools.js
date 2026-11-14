// Agent Bridge MCP - DOM Snapshots & Element Interaction Tools (ES Module)
import { z } from "zod";
import { jsonResult } from "../core/state.js";
import { callProfileExtension } from "../core/bridge.js";

export function registerDomTools(server) {
  server.registerTool(
    "browser_get_interactive_snapshot",
    {
      description: "Maps all interactive elements on the page (buttons, links, inputs, selects, tabs, clickable elements, shadow roots), assigning deterministic 'ref_1', 'ref_2' IDs with coordinates and bounding boxes. Supports viewportOnly filtering for token efficiency.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        viewportOnly: z.boolean().optional().describe("If true, only returns elements visible within the current viewport (default false)"),
      },
    },
    async ({ profile, tabId, viewportOnly }) => {
      const res = await callProfileExtension(profile, "get_interactive_snapshot", { tabId, viewportOnly });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_take_snapshot",
    {
      description: "Accessibility (a11y) tree text snapshot of the page matching standard Chrome DevTools MCP.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        verbose: z.boolean().optional().describe("Include deeper accessibility details"),
      },
    },
    async ({ profile, tabId, verbose }) => {
      const res = await callProfileExtension(profile, "take_snapshot", { tabId, verbose });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_get_css_styles",
    {
      description: "Inspect computed CSS styling for any element ref or CSS selector (display, visibility, opacity, colors, fonts, geometry, z-index).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().describe("Target element data-agent-ref (e.g. 'ref_1') or CSS selector"),
        properties: z.array(z.string()).optional().describe("Array of specific CSS property names (e.g. ['color', 'font-size']). Omit for essential styling."),
      },
    },
    async ({ profile, tabId, target, properties }) => {
      const res = await callProfileExtension(profile, "get_css_styles", { tabId, target, properties });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_act_on_ref",
    {
      description: "Perform precision interaction on a data-agent-ref target or coordinates with visible virtual cursor and action HUD animations.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        ref: z.string().optional().describe("The data-agent-ref ID (e.g. 'ref_1')"),
        actionType: z.enum(["click", "type"]).optional().describe("Action to perform (default 'click')"),
        text: z.string().optional().describe("Text to insert if actionType is 'type'"),
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default 'left')"),
        clickCount: z.number().optional().describe("Number of clicks (default 1, 2 for double click)"),
        clearFirst: z.boolean().optional().describe("Clear input field before typing (default false)"),
        pressEnter: z.boolean().optional().describe("Press Enter after typing text (default false)"),
        x: z.number().optional().describe("Direct X coordinate"),
        y: z.number().optional().describe("Direct Y coordinate"),
      },
    },
    async ({ profile, tabId, ref, actionType, text, button, clickCount, clearFirst, pressEnter, x, y }) => {
      const res = await callProfileExtension(profile, "act_on_ref", {
        tabId,
        ref,
        actionType,
        text,
        button,
        clickCount,
        clearFirst,
        pressEnter,
        x,
        y,
      });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_click",
    {
      description: "Click an element by ref or CSS selector, or click exact screen coordinates (matching chrome-devtools click).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().optional().describe("Target ref (e.g. 'ref_1') or CSS selector"),
        x: z.number().optional().describe("Direct X coordinate"),
        y: z.number().optional().describe("Direct Y coordinate"),
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default 'left')"),
        clickCount: z.number().optional().describe("1 for single click, 2 for double click"),
      },
    },
    async ({ profile, tabId, target, x, y, button, clickCount }) => {
      const res = await callProfileExtension(profile, "act_on_ref", {
        tabId,
        ref: target,
        actionType: "click",
        x,
        y,
        button,
        clickCount,
      });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_hover",
    {
      description: "Hover over an element by ref or CSS selector, or move mouse to coordinates.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().optional().describe("Target ref (e.g. 'ref_1') or CSS selector"),
        x: z.number().optional().describe("Direct X coordinate"),
        y: z.number().optional().describe("Direct Y coordinate"),
      },
    },
    async ({ profile, tabId, target, x, y }) => {
      const res = await callProfileExtension(profile, "hover", { tabId, target, x, y });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_drag",
    {
      description: "Drag and drop from one element/coordinate to another with visual laser trajectory.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        fromTarget: z.string().optional().describe("Source element ref or selector"),
        toTarget: z.string().optional().describe("Destination element ref or selector"),
        fromX: z.number().optional().describe("Source X coordinate"),
        fromY: z.number().optional().describe("Source Y coordinate"),
        toX: z.number().optional().describe("Destination X coordinate"),
        toY: z.number().optional().describe("Destination Y coordinate"),
      },
    },
    async ({ profile, tabId, fromTarget, toTarget, fromX, fromY, toX, toY }) => {
      const res = await callProfileExtension(profile, "drag", { tabId, fromTarget, toTarget, fromX, fromY, toX, toY });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_fill",
    {
      description: "Focus an input/textarea and fill its value (matching chrome-devtools fill).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().describe("Target ref (e.g. 'ref_1') or CSS selector"),
        value: z.string().describe("Value to fill"),
      },
    },
    async ({ profile, tabId, target, value }) => {
      const res = await callProfileExtension(profile, "fill", { tabId, target, value });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_fill_form",
    {
      description: "Fill multiple form fields in one batch call (e.g. { '#username': 'alice', '#password': 'secret' }).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        fields: z.record(z.string()).describe("Key-value mapping of selector/ref to input string values"),
      },
    },
    async ({ profile, tabId, fields }) => {
      const res = await callProfileExtension(profile, "fill_form", { tabId, fields });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_press_key",
    {
      description: "Dispatch a physical keyboard key press (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Backspace', 'a', '1') with 3D mechanical keycap HUD animation.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        key: z.string().describe("Key identifier (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Space')"),
        code: z.string().optional().describe("Optional DOM code (e.g. 'KeyA', 'Enter')"),
      },
    },
    async ({ profile, tabId, key, code }) => {
      const res = await callProfileExtension(profile, "press_key", { tabId, key, code });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_type_text",
    {
      description: "Type raw text into the currently focused element or specified target.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        text: z.string().describe("Text string to type"),
        target: z.string().optional().describe("Optional ref or selector to click/focus before typing"),
      },
    },
    async ({ profile, tabId, text, target }) => {
      const res = await callProfileExtension(profile, "type_text", { tabId, text, target });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_upload_file",
    {
      description: "Set files on an HTML file input element (<input type='file'>) via DevTools DOM.setFileInputFiles.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().describe("Target input[type='file'] ref or selector"),
        filePaths: z.union([z.string(), z.array(z.string())]).describe("Absolute local file path(s) to attach"),
      },
    },
    async ({ profile, tabId, target, filePaths }) => {
      const res = await callProfileExtension(profile, "upload_file", { tabId, target, filePaths });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_handle_dialog",
    {
      description: "Accept or dismiss active JavaScript dialogs (alert, confirm, prompt, beforeunload).",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        action: z.enum(["accept", "dismiss"]).describe("Whether to accept or dismiss the dialog"),
        promptText: z.string().optional().describe("Text response if the dialog is a prompt"),
      },
    },
    async ({ profile, tabId, action, promptText }) => {
      const res = await callProfileExtension(profile, "handle_dialog", { tabId, action, promptText });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_select_option",
    {
      description: "Select an option from a dropdown (<select>) element by value, visible label text, or index. Handles shadow DOM & iframes.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().describe("Target <select> ref (e.g. 'ref_1') or CSS selector"),
        value: z.string().optional().describe("The option value attribute to select"),
        label: z.string().optional().describe("The visible option text to select"),
        index: z.number().optional().describe("The zero-based option index to select"),
      },
    },
    async ({ profile, tabId, target, value, label, index }) => {
      const res = await callProfileExtension(profile, "select_option", { tabId, target, value, label, index });
      return jsonResult(res);
    }
  );

  server.registerTool(
    "browser_set_checked",
    {
      description: "Set the checked state of a checkbox or radio button element (true or false) with spring bloom visual animation.",
      inputSchema: {
        profile: z.string().optional().describe("Target browser profile"),
        tabId: z.number().describe("Target tabId"),
        target: z.string().describe("Target checkbox or radio ref (e.g. 'ref_1') or CSS selector"),
        checked: z.boolean().describe("Whether the checkbox/radio should be checked (true) or unchecked (false)"),
      },
    },
    async ({ profile, tabId, target, checked }) => {
      const res = await callProfileExtension(profile, "set_checked", { tabId, target, checked });
      return jsonResult(res);
    }
  );
}

