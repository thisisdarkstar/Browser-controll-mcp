// Agent Bridge MCP - Tab, Window & Scroll Actions (ES Module)
import { state } from "../core/state.js";
import { injectAgentVisualCue } from "../ui/hud.js";

export const tabActions = {
  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      index: t.index,
      title: t.title || "Untitled",
      url: t.url || "about:blank",
      active: t.active,
      status: t.status,
      debuggerAttached: state.attachedTabs.has(t.id),
    }));
  },

  async switch_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const tab = await chrome.tabs.update(params.tabId, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await injectAgentVisualCue(params.tabId, {
      type: "tab_focus",
      label: "Tab Focused",
    });
    return { success: true, tabId: params.tabId, active: true };
  },

  async new_tab(params) {
    const tab = await chrome.tabs.create({
      url: params.url || "about:blank",
      active: params.active ?? true,
    });
    return { success: true, tabId: tab.id, id: tab.id, url: tab.url };
  },

  async close_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    await chrome.tabs.remove(params.tabId);
    return { success: true, closed: true, closedTabId: params.tabId, tabId: params.tabId };
  },

  async duplicate_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const tab = await chrome.tabs.duplicate(params.tabId);
    return { success: true, tabId: tab.id, originalTabId: params.tabId, url: tab.url };
  },

  async pin_tab(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const pinned = Boolean(params.pinned);
    await chrome.tabs.update(params.tabId, { pinned });
    return { success: true, tabId: params.tabId, pinned };
  },

  async set_zoom(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    if (params.zoomFactor !== undefined) {
      await chrome.tabs.setZoom(params.tabId, Number(params.zoomFactor));
    }
    const currentZoom = await chrome.tabs.getZoom(params.tabId);
    return { success: true, tabId: params.tabId, zoomFactor: currentZoom };
  },

  async manage_tab_group(params) {
    const { action = "group", tabIds, title, color } = params;
    if (!tabIds || !tabIds.length) throw new Error("Missing tabIds array for tab group operation.");

    if (action === "ungroup") {
      await chrome.tabs.ungroup(tabIds);
      return { success: true, action: "ungroup", tabIds };
    }

    const groupId = await chrome.tabs.group({ tabIds });
    const updateData = {};
    if (title) updateData.title = title;
    if (color) updateData.color = color;
    if (action === "collapse") updateData.collapsed = true;
    if (action === "expand") updateData.collapsed = false;

    if (Object.keys(updateData).length > 0) {
      await chrome.tabGroups.update(groupId, updateData);
    }

    return {
      success: true,
      groupId,
      tabIds,
      title: title || undefined,
      color: color || undefined,
      collapsed: updateData.collapsed ?? false,
    };
  },

  async read_all_tabs(params) {
    const tabs = await chrome.tabs.query({});
    const results = [];
    for (const tab of tabs) {
      if (
        !tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("brave://") ||
        tab.url.startsWith("about:")
      ) {
        results.push({ id: tab.id, title: tab.title, url: tab.url, skipped: true });
        continue;
      }
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (maxLen) => ({
            title: document.title,
            url: location.href,
            text: document.body ? document.body.innerText.slice(0, maxLen) : "",
          }),
          args: [params.maxLength || 4000],
        });
        results.push({ id: tab.id, ...result });
      } catch (err) {
        results.push({ id: tab.id, title: tab.title, url: tab.url, error: err.message });
      }
    }
    return results;
  },

  async scroll(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [
        params.direction || "down",
        params.distance ?? 500,
        params.target || null,
        params.smooth ?? false,
        params.x ?? null,
        params.y ?? null,
      ],
      func: (direction, distance, target, smooth, directX, directY) => {
        const behavior = smooth ? "smooth" : "instant";

        if (directX !== null || directY !== null) {
          window.scrollTo({
            left: directX ?? window.scrollX,
            top: directY ?? window.scrollY,
            behavior,
          });
          return {
            scrolled: true,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            scrollHeight: document.body ? document.body.scrollHeight : 0,
          };
        }

        let container = null;
        if (target) {
          if (target.startsWith("ref_") || target.startsWith("ref-")) {
            container = document.querySelector(`[data-agent-ref="${target}"]`);
          }
          if (!container) {
            try {
              container = document.querySelector(target);
            } catch {}
          }
        }

        if (container) {
          const overflowY = window.getComputedStyle(container).overflowY;
          const isScrollable =
            (overflowY === "auto" || overflowY === "scroll") && container.scrollHeight > container.clientHeight;

          if (isScrollable) {
            if (direction === "top") container.scrollTo({ top: 0, behavior });
            else if (direction === "bottom") container.scrollTo({ top: container.scrollHeight, behavior });
            else if (direction === "up") container.scrollBy({ top: -distance, behavior });
            else if (direction === "down") container.scrollBy({ top: distance, behavior });
            else if (direction === "left") container.scrollBy({ left: -distance, behavior });
            else if (direction === "right") container.scrollBy({ left: distance, behavior });
            return {
              scrolled: true,
              target,
              scrollTop: container.scrollTop,
              scrollLeft: container.scrollLeft,
              scrollHeight: container.scrollHeight,
            };
          } else {
            container.scrollIntoView({ behavior, block: "center", inline: "center" });
            return {
              scrolled: true,
              target,
              scrolledIntoView: true,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
            };
          }
        }

        if (direction === "top") {
          window.scrollTo({ top: 0, behavior });
        } else if (direction === "bottom") {
          window.scrollTo({
            top: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
            behavior,
          });
        } else if (direction === "up") {
          window.scrollBy({ top: -distance, behavior });
        } else if (direction === "down") {
          window.scrollBy({ top: distance, behavior });
        } else if (direction === "left") {
          window.scrollBy({ left: -distance, behavior });
        } else if (direction === "right") {
          window.scrollBy({ left: distance, behavior });
        }

        return {
          scrolled: true,
          direction,
          distance,
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
          viewportHeight: window.innerHeight,
          pageHeight: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
        };
      },
    });

    await injectAgentVisualCue(params.tabId, {
      type: "scroll",
      direction: result.direction,
      distance: result.distance,
      scrollY: result.scrollY,
      pageHeight: result.pageHeight,
      label: `Scroll ${result.direction || "down"} (${result.distance ?? 500}px)`,
    });

    return { success: true, tabId: params.tabId, ...result };
  },
};

