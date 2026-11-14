// Agent Bridge MCP - Network, Cookies, Storage & Mock Routing Actions (ES Module)
import { state } from "../core/state.js";
import { attachDebuggerIfNeeded } from "../core/cdp.js";

export const networkActions = {
  async list_network_requests(params) {
    const store = state.tabTelemetry.get(params.tabId);
    if (!store) return [];
    const requests = Array.from(store.network.values());
    return requests.slice(-1 * (params.limit || 50));
  },

  async get_network_request(params) {
    const store = state.tabTelemetry.get(params.tabId);
    if (!store) return null;
    return store.network.get(params.requestId) || null;
  },

  async get_network_body(params) {
    await attachDebuggerIfNeeded(params.tabId);
    try {
      const res = await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
      return res;
    } catch (err) {
      return { error: err.message };
    }
  },

  async get_cookies(params) {
    if (params.urls) {
      const allCookies = [];
      const urls = Array.isArray(params.urls) ? params.urls : [params.urls];
      for (const u of urls) {
        const cookies = await chrome.cookies.getAll({ url: u });
        allCookies.push(...cookies);
      }
      return allCookies;
    }
    return await chrome.cookies.getAll({});
  },

  async set_cookie(params) {
    const cookie = await chrome.cookies.set({
      url: params.url,
      name: params.name,
      value: params.value,
      domain: params.domain,
      path: params.path,
      secure: params.secure,
      httpOnly: params.httpOnly,
      sameSite: params.sameSite,
      expirationDate: params.expirationDate,
    });
    return { success: Boolean(cookie), cookie };
  },

  async clear_cookies() {
    const all = await chrome.cookies.getAll({});
    let count = 0;
    for (const c of all) {
      const protocol = c.secure ? "https:" : "http:";
      const url = `${protocol}//${c.domain.startsWith(".") ? c.domain.slice(1) : c.domain}${c.path}`;
      await chrome.cookies.remove({ url, name: c.name });
      count++;
    }
    return { success: true, clearedCount: count };
  },

  async storage(params) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.type || "local", params.action || "get", params.key, params.value],
      func: (type, act, k, v) => {
        const store = type === "session" ? window.sessionStorage : window.localStorage;
        if (act === "get") {
          if (k) return { [k]: store.getItem(k) };
          return { ...store };
        }
        if (act === "set") {
          store.setItem(k, typeof v === "object" ? JSON.stringify(v) : String(v));
          return { success: true, key: k, value: store.getItem(k) };
        }
        if (act === "remove") {
          store.removeItem(k);
          return { success: true, removed: k };
        }
        if (act === "clear") {
          store.clear();
          return { success: true, cleared: true };
        }
      },
    });
    return result;
  },

  async block_urls(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    await attachDebuggerIfNeeded(params.tabId);
    const patterns = params.clear
      ? []
      : Array.isArray(params.patterns)
      ? params.patterns
      : [params.patterns].filter(Boolean);
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.setBlockedURLs", {
      urls: patterns,
    });
    return { success: true, tabId: params.tabId, blockedPatterns: patterns, count: patterns.length };
  },

  async set_extra_headers(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    await attachDebuggerIfNeeded(params.tabId);
    const headers = params.clear ? {} : params.headers || {};
    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.setExtraHTTPHeaders", {
      headers,
    });
    return { success: true, tabId: params.tabId, headers, count: Object.keys(headers).length };
  },

  async mock_route(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    await attachDebuggerIfNeeded(params.tabId);
    if (params.clear) {
      state.tabMockRoutes.delete(params.tabId);
      try {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Fetch.disable");
      } catch {}
      return { success: true, tabId: params.tabId, cleared: true };
    }

    if (!params.urlPattern) throw new Error("Missing required urlPattern parameter");

    let bodyStr = "";
    if (typeof params.responseBody === "object") {
      bodyStr = JSON.stringify(params.responseBody);
    } else {
      bodyStr = String(params.responseBody || "");
    }
    const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));

    const current = state.tabMockRoutes.get(params.tabId) || [];
    current.push({
      urlPattern: params.urlPattern,
      status: params.status || 200,
      headers: params.headers || {},
      bodyBase64,
    });
    state.tabMockRoutes.set(params.tabId, current);

    await chrome.debugger.sendCommand({ tabId: params.tabId }, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });

    return {
      success: true,
      tabId: params.tabId,
      urlPattern: params.urlPattern,
      status: params.status || 200,
      totalMocks: current.length,
    };
  },
};

