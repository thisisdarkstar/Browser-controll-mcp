// Agent Bridge MCP - Bookmarks, History, Notifications, Clipboard & Downloads (ES Module)
import { injectAgentVisualCue } from "../ui/hud.js";

export const browserDataActions = {
  async search_bookmarks(params) {
    const query = params.query || "";
    const results = await chrome.bookmarks.search(query);
    return { success: true, query, count: results.length, bookmarks: results.slice(0, params.limit || 50) };
  },

  async add_bookmark(params) {
    if (!params.title || !params.url) throw new Error("Missing required title and url parameters");
    const bookmark = await chrome.bookmarks.create({
      title: params.title,
      url: params.url,
      parentId: params.parentId || undefined,
    });
    return { success: true, bookmark };
  },

  async search_history(params) {
    const text = params.query || "";
    const maxResults = params.limit || 50;
    const startTime = params.startTime ? Number(params.startTime) : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const items = await chrome.history.search({
      text,
      startTime,
      maxResults,
    });
    return { success: true, query: text, count: items.length, history: items };
  },

  async show_notification(params) {
    const notifId = "agent_notif_" + Date.now();
    await chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon48.png"),
      title: params.title || "Agent Bridge MCP",
      message: params.message || "Task completed.",
      priority: 2,
    });
    return { success: true, notificationId: notifId, title: params.title, message: params.message };
  },

  async clipboard(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const operation = params.operation || "get";
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [operation, params.text || ""],
      func: async (op, textToSet) => {
        if (op === "set") {
          await navigator.clipboard.writeText(textToSet);
          return { operation: "set", success: true, text: textToSet };
        }
        const text = await navigator.clipboard.readText();
        return { operation: "get", success: true, text };
      },
    });
    if (params.operation === "set") {
      await injectAgentVisualCue(params.tabId, {
        type: "type",
        label: `Clipboard Copy: "${(params.text || "").slice(0, 35)}"`,
      });
    }
    return { success: true, tabId: params.tabId, ...result };
  },

  async download_file(params) {
    if (!params.url) throw new Error("Missing required url parameter");
    const options = {
      url: params.url,
      conflictAction: params.conflictAction || "uniquify",
      saveAs: params.saveAs ?? false,
    };
    if (params.filename) options.filename = params.filename;

    const downloadId = await chrome.downloads.download(options);

    if (params.tabId) {
      await injectAgentVisualCue(params.tabId, {
        label: `Downloading: ${params.filename || "file"}`,
      });
    }

    return {
      success: true,
      downloadId,
      url: params.url,
      filename: params.filename || null,
    };
  },

  async wait_for_download(params) {
    const timeoutMs = params.timeoutMs || 30000;
    return new Promise((resolve, reject) => {
      let timer = null;
      function listener(delta) {
        if (params.downloadId && delta.id !== params.downloadId) return;
        if (delta.state && delta.state.current === "complete") {
          chrome.downloads.onChanged.removeListener(listener);
          clearTimeout(timer);
          chrome.downloads.search({ id: delta.id }, ([item]) => {
            resolve({
              success: true,
              completed: true,
              downloadId: delta.id,
              filename: item ? item.filename : null,
              fileSize: item ? item.fileSize : null,
            });
          });
        } else if (delta.error) {
          chrome.downloads.onChanged.removeListener(listener);
          clearTimeout(timer);
          reject(new Error(`Download failed: ${delta.error.current}`));
        }
      }

      chrome.downloads.onChanged.addListener(listener);

      timer = setTimeout(() => {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(`Timed out waiting for download to finish after ${timeoutMs}ms.`));
      }, timeoutMs);
    });
  },

  async list_downloads(params) {
    const query = {
      limit: params.limit || 20,
      orderBy: ["-startTime"],
    };
    if (params.state) query.state = params.state;
    const items = await chrome.downloads.search(query);
    return {
      count: items.length,
      downloads: items.map((i) => ({
        id: i.id,
        url: i.url,
        filename: i.filename,
        state: i.state,
        bytesReceived: i.bytesReceived,
        totalBytes: i.totalBytes,
        fileSize: i.fileSize,
        startTime: i.startTime,
        endTime: i.endTime,
        exists: i.exists,
      })),
    };
  },
};

