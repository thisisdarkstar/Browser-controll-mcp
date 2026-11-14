// Agent Bridge MCP - Snapshots & Style Inspection (ES Module)
import { attachDebuggerIfNeeded } from "../core/cdp.js";

export const snapshotActions = {
  async get_interactive_snapshot(params) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.viewportOnly ?? false],
      func: (viewportOnly) => {
        const selectors = [
          "a[href]",
          "button",
          "input",
          "select",
          "textarea",
          "[role='button']",
          "[role='link']",
          "[role='tab']",
          "[role='menuitem']",
          "[role='checkbox']",
          "[role='combobox']",
          "[role='radio']",
          "[role='switch']",
          "[contenteditable='true']",
          "[onclick]",
        ].join(",");

        function queryElementsWithShadow(root) {
          const list = [];
          try {
            list.push(...root.querySelectorAll(selectors));
            const all = root.querySelectorAll("*");
            for (const el of all) {
              if (el.shadowRoot) {
                list.push(...queryElementsWithShadow(el.shadowRoot));
              }
            }
          } catch {}
          return list;
        }

        const elements = queryElementsWithShadow(document);
        const map = [];
        const elementsObj = {};
        let refCounter = 1;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width === 0 ||
            rect.height === 0 ||
            style.visibility === "hidden" ||
            style.display === "none"
          ) {
            continue;
          }

          if (viewportOnly) {
            if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
              continue;
            }
          }

          const ref = `ref_${refCounter++}`;
          el.setAttribute("data-agent-ref", ref);

          const form = el.closest ? el.closest("form") : null;
          const formId = form ? form.id || form.name || "form" : null;

          const item = {
            ref,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute("type") || null,
            role: el.getAttribute("role") || null,
            text: (
              el.innerText ||
              el.value ||
              el.getAttribute("aria-label") ||
              el.getAttribute("placeholder") ||
              el.getAttribute("title") ||
              ""
            )
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 120),
            href: el.getAttribute("href") || null,
            disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
            formId,
            bounds: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            },
          };
          map.push(item);
          elementsObj[ref] = item;
        }

        return {
          count: map.length,
          elements: elementsObj,
          interactiveElements: map,
          list: map,
          title: document.title,
          url: location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          viewportOnly: Boolean(viewportOnly),
        };
      },
    });
    return result;
  },

  async take_snapshot(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const { nodes } = await chrome.debugger.sendCommand(
      { tabId: params.tabId },
      "Accessibility.getFullAXTree"
    );

    const formatted = (nodes || [])
      .filter((n) => !n.ignored && n.role?.value && n.role.value !== "none")
      .map((n) => {
        const role = n.role.value;
        const name = n.name?.value || "";
        const desc = n.description?.value || "";
        const val = n.value?.value || "";
        return `[${n.backendDOMNodeId || n.nodeId}] ${role} ${name ? `"${name}"` : ""} ${val ? `val="${val}"` : ""} ${desc ? `(${desc})` : ""}`.trim();
      })
      .slice(0, params.verbose ? 1500 : 350)
      .join("\n");

    return {
      tabId: params.tabId,
      snapshot: formatted,
      tree: formatted,
    };
  },

  async get_css_styles(params) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.target, params.properties || []],
      func: (target, filterProps) => {
        let el = null;
        if (typeof target === "string" && target.startsWith("ref_")) {
          el = document.querySelector(`[data-agent-ref="${target}"]`);
        } else {
          try {
            el = document.querySelector(target);
          } catch {
            el = document.querySelector(`[data-agent-ref="${target}"]`);
          }
        }
        if (!el && typeof target === "string") {
          try {
            el = document.querySelector(target.toLowerCase());
          } catch {}
        }
        if (!el) return { error: `Element not found: ${target}` };

        const computed = window.getComputedStyle(el);
        const styles = {};
        if (filterProps && filterProps.length > 0) {
          for (const p of filterProps) {
            styles[p] = computed.getPropertyValue(p);
          }
        } else {
          const essentials = [
            "display",
            "visibility",
            "opacity",
            "color",
            "background-color",
            "font-size",
            "font-family",
            "font-weight",
            "width",
            "height",
            "margin",
            "padding",
            "border",
            "position",
            "z-index",
            "box-shadow",
          ];
          for (const p of essentials) {
            styles[p] = computed.getPropertyValue(p);
          }
        }
        return { target, styles, computed: styles };
      },
    });
    return result;
  },
};
