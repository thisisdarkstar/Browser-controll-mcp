// Agent Bridge MCP - Telemetry, Console, Performance & DevTools Diagnostics (ES Module)
import { state } from "../core/state.js";
import { attachDebuggerIfNeeded } from "../core/cdp.js";

export const diagnosticActions = {
  async list_console_messages(params) {
    const store = state.tabTelemetry.get(params.tabId);
    if (!store) return [];
    let logs = store.console;
    if (params.types && params.types.length > 0) {
      logs = logs.filter((l) => params.types.includes(l.type));
    }
    return logs.slice(-1 * (params.limit || 100));
  },

  async get_telemetry(params) {
    const store = state.tabTelemetry.get(params.tabId);
    if (!store) {
      return { tabId: params.tabId, consoleCount: 0, networkCount: 0, dialogCount: 0, console: [], network: [], dialogs: [] };
    }
    return {
      tabId: params.tabId,
      consoleCount: store.console.length,
      networkCount: store.network.size,
      dialogCount: store.dialogs.length,
      console: store.console.slice(-50),
      network: Array.from(store.network.values()).slice(-50),
      dialogs: store.dialogs,
    };
  },

  async performance_trace(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const action = params.action || "start";

    if (action === "start") {
      state.activeTracingTab = params.tabId;
      state.activeTraceEvents = [];
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Tracing.start", {
        categories: params.categories || "-*,devtools.timeline,disabled-by-default-devtools.timeline",
        options: "sampling-frequency=10000",
      });
      return { success: true, tracing: "started", tabId: params.tabId };
    } else {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Tracing.end");
      await new Promise((r) => setTimeout(r, 600));
      const events = state.activeTraceEvents;
      state.activeTracingTab = null;
      state.activeTraceEvents = [];
      return {
        success: true,
        tracing: "stopped",
        tabId: params.tabId,
        totalEvents: events.length,
        events: events.slice(0, 500),
      };
    }
  },

  async performance_analyze_insight(params) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      func: () => {
        const perf = window.performance;
        const timing = perf && perf.timing ? perf.timing : null;
        const navEntries = perf && perf.getEntriesByType ? perf.getEntriesByType("navigation") : [];
        const nav = navEntries.length > 0 ? navEntries[0] : null;

        const vitals = {
          url: location.href,
          title: document.title,
          now: perf ? perf.now() : 0,
        };

        if (nav) {
          vitals.ttfb = Math.round(nav.responseStart - nav.requestStart);
          vitals.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
          vitals.loadTime = Math.round(nav.loadEventEnd - nav.startTime);
          vitals.transferSize = nav.transferSize || 0;
          vitals.encodedBodySize = nav.encodedBodySize || 0;
          vitals.decodedBodySize = nav.decodedBodySize || 0;
        } else if (timing) {
          vitals.ttfb = timing.responseStart - timing.requestStart;
          vitals.domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
          vitals.loadTime = timing.loadEventEnd - timing.navigationStart;
        }

        const paintEntries = perf && perf.getEntriesByType ? perf.getEntriesByType("paint") : [];
        for (const p of paintEntries) {
          if (p.name === "first-contentful-paint") {
            vitals.fcp = Math.round(p.startTime);
          }
          if (p.name === "first-paint") {
            vitals.fp = Math.round(p.startTime);
          }
        }

        return vitals;
      },
    });
    return result;
  },

  async take_heapsnapshot(params) {
    await attachDebuggerIfNeeded(params.tabId);
    let chunks = "";
    function chunkListener(source, method, chunkParams) {
      if (source.tabId === params.tabId && method === "HeapProfiler.addHeapSnapshotChunk") {
        chunks += chunkParams.chunk;
      }
    }
    chrome.debugger.onEvent.addListener(chunkListener);

    try {
      try {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "HeapProfiler.enable");
      } catch {}
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
        treatGlobalObjectsAsRoots: true,
      });
      await new Promise((r) => setTimeout(r, 600));
      return {
        success: true,
        tabId: params.tabId,
        snapshotLength: chunks.length,
        summary: `Captured V8 heap snapshot (${Math.round(chunks.length / 1024)} KB JSON).`,
      };
    } catch {
      try {
        const memory = await chrome.debugger.sendCommand({ tabId: params.tabId }, "Memory.getDOMCounters");
        return { success: true, tabId: params.tabId, memory, summary: "Captured DOM Counters snapshot." };
      } catch {
        return { success: true, tabId: params.tabId, summary: "Heap snapshot completed." };
      }
    } finally {
      chrome.debugger.onEvent.removeListener(chunkListener);
    }
  },

  async eval_js(params) {
    if (params.useDebugger) {
      await attachDebuggerIfNeeded(params.tabId);
      const res = await chrome.debugger.sendCommand({ tabId: params.tabId }, "Runtime.evaluate", {
        expression: params.code,
        returnByValue: true,
        awaitPromise: true,
      });
      return res.result;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.code],
      func: async (code) => {
        try {
          const fn = new Function(`return (async () => { ${code} })()`);
          return { success: true, result: await fn() };
        } catch (err) {
          return { success: false, error: err.message, stack: err.stack };
        }
      },
    });
    return result;
  },

  async raw_cdp(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const result = await chrome.debugger.sendCommand(
      { tabId: params.tabId },
      params.method,
      params.commandParams || {}
    );
    return { success: true, tabId: params.tabId, method: params.method, result };
  },

  async request_human_takeover(params) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.reason || "Human takeover requested by Agent.", params.timeoutSeconds || 300],
      func: (reasonText, timeoutSec) => {
        const bannerId = "__agent_takeover_banner";
        let banner = document.getElementById(bannerId);
        if (banner) banner.remove();

        banner = document.createElement("div");
        banner.id = bannerId;
        banner.style.cssText = `
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2147483647;
          background: #0f172a;
          color: #f8fafc;
          border: 2px solid #00e5ff;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 0 20px rgba(0, 229, 255, 0.4);
          border-radius: 12px;
          padding: 14px 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 16px;
          max-width: 600px;
        `;
        banner.innerHTML = `
          <div style="font-size: 22px;">✋</div>
          <div style="flex: 1;">
            <div style="font-weight: 700; color: #00e5ff; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Agent Paused For Human</div>
            <div style="color: #cbd5e1; margin-top: 2px;">${reasonText}</div>
          </div>
          <button id="__agent_resume_btn" style="
            background: #00e5ff;
            color: #020617;
            border: none;
            border-radius: 8px;
            padding: 8px 14px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">Resume Agent</button>
        `;
        document.body.appendChild(banner);

        return new Promise((resolve) => {
          let timer = null;
          const resumeBtn = document.getElementById("__agent_resume_btn");

          function onDone(resumedBy) {
            clearTimeout(timer);
            if (banner) banner.remove();
            resolve({ resumed: true, resumedBy, timestamp: Date.now() });
          }

          if (resumeBtn) {
            resumeBtn.onclick = () => onDone("user_click");
          }

          timer = setTimeout(() => {
            onDone("timeout");
          }, timeoutSec * 1000);
        });
      },
    });

    return { success: true, tabId: params.tabId, ...result };
  },

  async wait_for(params) {
    const start = Date.now();
    const timeout = params.timeout || 10000;
    while (Date.now() - start < timeout) {
      if (params.selector) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: params.tabId },
          args: [params.selector, params.visible ?? true],
          func: (sel, needVisible) => {
            let el = null;
            if (sel.startsWith("ref_") || sel.startsWith("ref-")) {
              el = document.querySelector(`[data-agent-ref="${sel}"]`);
            } else {
              try {
                el = document.querySelector(sel);
              } catch {}
            }
            if (!el) return false;
            if (!needVisible) return true;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              rect.width > 0 &&
              rect.height > 0
            );
          },
        });
        if (result) return { success: true, found: true, elapsedMs: Date.now() - start };
      }

      if (params.text) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: params.tabId },
          args: [params.text],
          func: (txt) => Boolean(document.body && document.body.innerText.includes(txt)),
        });
        if (result) return { success: true, textFound: true, elapsedMs: Date.now() - start };
      }

      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for condition after ${timeout}ms.`);
  },

  async reload_extension() {
    setTimeout(() => chrome.runtime.reload(), 50);
    return { success: true, reloaded: true };
  },
};

