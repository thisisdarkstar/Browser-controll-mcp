// Agent Bridge MCP - Precision Element & Input Interaction Actions (ES Module)
import { injectAgentVisualCue } from "../ui/hud.js";
import { resolveElementInfo } from "../ui/dom.js";
import { attachDebuggerIfNeeded } from "../core/cdp.js";

export const interactionActions = {
  async act_on_ref(params, handleRpcInternal) {
    let x = params.x;
    let y = params.y;
    let rect = null;
    const target = params.ref || params.target;

    if (target) {
      const info = await resolveElementInfo(params.tabId, target);
      if (!info) throw new Error(`Element "${target}" not found.`);
      x = info.x;
      y = info.y;
      rect = info.rect;
    }

    if (x === undefined || y === undefined) {
      throw new Error("Must specify target ref/selector or exact x, y coordinates.");
    }

    // Visual Agent Cursor & HUD cue (clean labels without ref IDs)
    await injectAgentVisualCue(params.tabId, {
      type: params.actionType === "type" ? "type" : "click",
      x,
      y,
      rect,
      label: params.actionType === "type" && params.text
        ? `Type: "${params.text}"`
        : "Click",
    });

    await attachDebuggerIfNeeded(params.tabId);
    const button = params.button || "left";
    const clickCount = params.clickCount || 1;

    // Dispatch mouse click
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount,
    });
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount,
    });

    // If text typing was also passed in act_on_ref
    if (params.actionType === "type" && params.text) {
      if (params.clearFirst) {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "a",
          code: "KeyA",
          modifiers: 2, // Control
        });
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "a",
          code: "KeyA",
        });
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
      }

      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
        text: params.text,
      });

      if (params.pressEnter) {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      }
    }

    return { success: true, clicked: true, coordinates: { x, y } };
  },

  async hover(params) {
    let x = params.x;
    let y = params.y;
    let rect = null;
    if (params.target) {
      const info = await resolveElementInfo(params.tabId, params.target);
      if (!info) throw new Error(`Target "${params.target}" not found.`);
      x = info.x;
      y = info.y;
      rect = info.rect;
    }
    if (x !== undefined && y !== undefined) {
      await injectAgentVisualCue(params.tabId, {
        type: "hover",
        x,
        y,
        rect,
        label: "Hover",
      });
    }
    await attachDebuggerIfNeeded(params.tabId);
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    return { success: true, hovered: true, x, y, coordinates: { x, y } };
  },

  async drag(params) {
    let fromX = params.fromX;
    let fromY = params.fromY;
    let toX = params.toX;
    let toY = params.toY;

    if (params.fromTarget) {
      const fromInfo = await resolveElementInfo(params.tabId, params.fromTarget);
      if (!fromInfo) throw new Error(`Source "${params.fromTarget}" not found.`);
      fromX = fromInfo.x;
      fromY = fromInfo.y;
    }
    if (params.toTarget) {
      const toInfo = await resolveElementInfo(params.tabId, params.toTarget);
      if (!toInfo) throw new Error(`Destination "${params.toTarget}" not found.`);
      toX = toInfo.x;
      toY = toInfo.y;
    }

    await injectAgentVisualCue(params.tabId, {
      type: "drag",
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      label: "Drag & Drop",
    });

    await attachDebuggerIfNeeded(params.tabId);

    // Mouse down at start
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: fromX,
      y: fromY,
      button: "left",
      clickCount: 1,
    });

    // Move in increments
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(fromX + ((toX - fromX) * i) / steps);
      const curY = Math.round(fromY + ((toY - fromY) * i) / steps);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: curX,
        y: curY,
        button: "left",
      });
      await new Promise((r) => setTimeout(r, 20));
    }

    // Mouse release
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: toX,
      y: toY,
      button: "left",
      clickCount: 1,
    });

    return { success: true, dragged: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
  },

  async fill(params) {
    const target = params.target || params.ref;
    const info = await resolveElementInfo(params.tabId, target);
    if (!info) throw new Error(`Element "${target}" not found.`);

    await injectAgentVisualCue(params.tabId, {
      type: "type",
      x: info.x,
      y: info.y,
      rect: info.rect,
      label: `Fill: "${params.value || ""}"`,
    });

    await attachDebuggerIfNeeded(params.tabId);

    // Click to focus
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: info.x,
      y: info.y,
      button: "left",
      clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: info.x,
      y: info.y,
      button: "left",
      clickCount: 1,
    });

    // Clear existing content if needed
    await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [target],
      func: (sel) => {
        let el = sel.startsWith("ref_") ? document.querySelector(`[data-agent-ref="${sel}"]`) : document.querySelector(sel);
        if (el) {
          el.value = "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
    });

    // Insert text
    if (params.value) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
        text: params.value,
      });
    }

    return { success: true, filled: true, target, value: params.value };
  },

  async fill_form(params, handleRpcInternal) {
    const entries = Object.entries(params.fields || {});
    const filled = [];
    for (const [target, value] of entries) {
      await interactionActions.fill({ tabId: params.tabId, target, value });
      filled.push({ target, value });
    }
    return { success: true, count: filled.length, filledCount: filled.length, fields: filled };
  },

  async press_key(params) {
    const key = params.key;
    const code = params.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key);

    await injectAgentVisualCue(params.tabId, {
      type: "key",
      key,
      label: `Key: ${key}`,
    });

    await attachDebuggerIfNeeded(params.tabId);

    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
    });
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
    });
    return { success: true, pressed: true, key, code };
  },

  async type_text(params) {
    let info = null;
    if (params.target) {
      info = await resolveElementInfo(params.tabId, params.target);
    }
    if (info) {
      await injectAgentVisualCue(params.tabId, {
        type: "type",
        x: info.x,
        y: info.y,
        rect: info.rect,
        label: `Type: "${params.text || ""}"`,
      });
    } else {
      await injectAgentVisualCue(params.tabId, {
        type: "type",
        label: `Type: "${params.text || ""}"`,
      });
    }

    await attachDebuggerIfNeeded(params.tabId);
    if (info) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: info.x,
        y: info.y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: info.x,
        y: info.y,
        button: "left",
        clickCount: 1,
      });
    }
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Input.insertText", {
      text: params.text,
    });
    return { success: true, typed: true, text: params.text };
  },

  async upload_file(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const { root } = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.getDocument");
    const target = params.target || params.ref;
    let nodeId = null;

    if (target.startsWith("ref_")) {
      const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-agent-ref="${target}"]`,
      });
      nodeId = res.nodeId;
    } else {
      const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.querySelector", {
        nodeId: root.nodeId,
        selector: target,
      });
      nodeId = res.nodeId;
    }

    if (!nodeId) throw new Error(`Could not find DOM nodeId for target "${target}".`);

    const files = Array.isArray(params.filePaths) ? params.filePaths : [params.filePaths];
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "DOM.setFileInputFiles", {
      nodeId,
      files,
    });

    return { success: true, target, files };
  },

  async handle_dialog(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const accept = params.action === "accept";
    let activeDialog = true;
    try {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Page.handleJavaScriptDialog", {
        accept,
        promptText: params.promptText || "",
      });
    } catch {
      activeDialog = false;
    }
    return { success: true, handled: activeDialog, action: params.action, promptText: params.promptText };
  },

  async select_option(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const target = params.target || params.ref;
    if (!target) throw new Error("Missing required target or ref parameter");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [target, params.value ?? null, params.label ?? null, params.index ?? null],
      func: (targetSel, val, lbl, idx) => {
        function findEl(root, sel) {
          try {
            if (typeof sel === "string" && (sel.startsWith("ref_") || sel.startsWith("ref-"))) {
              const el = root.querySelector(`[data-agent-ref="${sel}"]`);
              if (el) return el;
            }
            const direct = root.querySelector(sel);
            if (direct) return direct;
            const all = root.querySelectorAll("*");
            for (const node of all) {
              if (node.shadowRoot) {
                const found = findEl(node.shadowRoot, sel);
                if (found) return found;
              }
              if (node.tagName && node.tagName.toLowerCase() === "iframe") {
                try {
                  const found = findEl(node.contentDocument, sel);
                  if (found) return found;
                } catch {}
              }
            }
          } catch {}
          return null;
        }

        let el = findEl(document, targetSel);
        if (!el) return { error: `Element "${targetSel}" not found.` };
        if (el.tagName.toLowerCase() !== "select") {
          const nested = el.querySelector("select");
          if (nested) el = nested;
          else return { error: `Target element is not a <select> tag (<${el.tagName.toLowerCase()}>)` };
        }

        const options = Array.from(el.options);
        let selectedOption = null;

        if (idx !== undefined && idx !== null && options[idx]) {
          selectedOption = options[idx];
        } else if (val !== undefined && val !== null) {
          selectedOption = options.find((o) => o.value === String(val) || o.value.toLowerCase() === String(val).toLowerCase());
        } else if (lbl !== undefined && lbl !== null) {
          selectedOption = options.find((o) => o.text.trim().toLowerCase() === String(lbl).trim().toLowerCase() || o.text.includes(String(lbl)));
        }

        if (!selectedOption) {
          return {
            error: `Matching option not found in <select>. Available options: ${options.map((o) => `"${o.text.trim()}" (val: "${o.value}")`).slice(0, 15).join(", ")}`,
          };
        }

        el.value = selectedOption.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const rect = el.getBoundingClientRect();

        return {
          success: true,
          value: selectedOption.value,
          text: selectedOption.text.trim(),
          index: selectedOption.index,
          totalOptions: options.length,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      },
    });

    if (result.error) throw new Error(result.error);

    await injectAgentVisualCue(params.tabId, {
      type: "click",
      x: result.x,
      y: result.y,
      rect: result.rect,
      label: `Selected: "${result.text}"`,
    });

    return { success: true, tabId: params.tabId, target, ...result };
  },

  async set_checked(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const target = params.target || params.ref;
    if (!target) throw new Error("Missing required target or ref parameter");
    if (params.checked === undefined) throw new Error("Missing required checked (boolean) parameter");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [target, Boolean(params.checked)],
      func: (targetSel, shouldCheck) => {
        function findEl(root, sel) {
          try {
            if (typeof sel === "string" && (sel.startsWith("ref_") || sel.startsWith("ref-"))) {
              const el = root.querySelector(`[data-agent-ref="${sel}"]`);
              if (el) return el;
            }
            const direct = root.querySelector(sel);
            if (direct) return direct;
            const all = root.querySelectorAll("*");
            for (const node of all) {
              if (node.shadowRoot) {
                const found = findEl(node.shadowRoot, sel);
                if (found) return found;
              }
              if (node.tagName && node.tagName.toLowerCase() === "iframe") {
                try {
                  const found = findEl(node.contentDocument, sel);
                  if (found) return found;
                } catch {}
              }
            }
          } catch {}
          return null;
        }

        let el = findEl(document, targetSel);
        if (!el) return { error: `Element "${targetSel}" not found.` };
        if (!("checked" in el)) {
          const nested = el.querySelector("input[type='checkbox'], input[type='radio']");
          if (nested) el = nested;
          else return { error: `Element does not support checked state (<${el.tagName.toLowerCase()}>)` };
        }

        const prev = el.checked;
        el.checked = shouldCheck;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const rect = el.getBoundingClientRect();

        return {
          success: true,
          checked: el.checked,
          previousState: prev,
          changed: prev !== el.checked,
          type: el.type || "checkbox",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      },
    });

    if (result.error) throw new Error(result.error);

    await injectAgentVisualCue(params.tabId, {
      type: "check",
      checked: result.checked,
      x: result.x,
      y: result.y,
      rect: result.rect,
      label: `${result.checked ? "Checked" : "Unchecked"} ${result.type}`,
    });

    return { success: true, tabId: params.tabId, target, ...result };
  },
};

