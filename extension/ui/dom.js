// Agent Bridge MCP - DOM & Element Resolution Helper (ES Module)

export async function resolveElementInfo(tabId, selectorOrRef) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selectorOrRef],
    func: (target) => {
      function findInShadow(root, sel) {
        try {
          const direct = root.querySelector(sel);
          if (direct) return direct;
          const all = root.querySelectorAll("*");
          for (const node of all) {
            if (node.shadowRoot) {
              const found = findInShadow(node.shadowRoot, sel);
              if (found) return found;
            }
          }
        } catch {}
        return null;
      }

      let el = null;
      if (typeof target === "string" && (target.startsWith("ref_") || target.startsWith("ref-"))) {
        el = findInShadow(document, `[data-agent-ref="${target}"]`);
      }
      if (!el) {
        try {
          el = findInShadow(document, target);
        } catch {
          el = findInShadow(document, `[data-agent-ref="${target}"]`);
        }
      }
      if (!el && typeof target === "string") {
        try {
          el = findInShadow(document, target.toLowerCase());
        } catch {}
      }
      if (!el) return null;

      el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();

      // Render glowing visual highlight overlay
      let overlay = document.getElementById("__agent_action_overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "__agent_action_overlay";
        overlay.style.cssText = `
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
          border: 2px solid #00e5ff;
          background: rgba(0, 229, 255, 0.16);
          border-radius: 6px;
          box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4);
          transition: all 0.15s ease-out;
        `;
        document.body.appendChild(overlay);
      }
      overlay.style.left = `${rect.left - 4}px`;
      overlay.style.top = `${rect.top - 4}px`;
      overlay.style.width = `${rect.width + 8}px`;
      overlay.style.height = `${rect.height + 8}px`;
      overlay.style.opacity = "1";
      setTimeout(() => {
        if (overlay) overlay.style.opacity = "0";
      }, 1400);

      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        tagName: el.tagName ? el.tagName.toLowerCase() : "element",
        id: el.id || null,
        className: el.className || null,
      };
    },
  });

  return result;
}
