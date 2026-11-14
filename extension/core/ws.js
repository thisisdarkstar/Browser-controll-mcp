// Agent Bridge MCP - WebSocket Client & Reconnect Loop (ES Module)
import { state, updateBadge, detectBrowser, logAgentAction } from "./state.js";

let rpcHandler = null;

export async function isServerReady() {
  try {
    const res = await fetch(`http://127.0.0.1:${state.currentPort}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function connectWebSocket(handleRpc) {
  if (handleRpc) rpcHandler = handleRpc;

  if (
    state.wsSocket &&
    (state.wsSocket.readyState === WebSocket.OPEN || state.wsSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  // Probe server before creating WebSocket
  const ready = await isServerReady();
  if (!ready) {
    updateBadge();
    scheduleReconnect();
    return;
  }

  const url = `ws://127.0.0.1:${state.currentPort}`;

  try {
    const ws = new WebSocket(url);
    state.wsSocket = ws;

    ws.onopen = () => {
      state.reconnectDelay = 2000;
      console.log(`%c[Agent Bridge] Successfully connected to MCP server at ${url}!`, "color: #10b981; font-weight: bold;");
      updateBadge();
      ws.send(
        JSON.stringify({
          type: "register",
          profileId: state.profileId,
          profileName: state.profileName,
          browser: detectBrowser(),
          timestamp: Date.now(),
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (msg.id && msg.action && rpcHandler) {
          state.activeRpcCount++;
          state.currentExecutingAction = msg.action;
          state.lastAgentActionTime = Date.now();
          updateBadge();
          try {
            const result = await rpcHandler(msg.action, msg.params);
            logAgentAction(msg.action, msg.params, result, null);
            ws.send(JSON.stringify({ id: msg.id, result }));
          } catch (err) {
            logAgentAction(msg.action, msg.params, null, err);
            ws.send(JSON.stringify({ id: msg.id, error: err.message }));
          } finally {
            state.activeRpcCount = Math.max(0, state.activeRpcCount - 1);
            if (state.activeRpcCount === 0) state.currentExecutingAction = null;
            updateBadge();
          }
        }
      } catch (parseErr) {
        console.warn("[Agent Bridge] Failed to parse message:", parseErr);
      }
    };

    ws.onclose = () => {
      state.wsSocket = null;
      updateBadge();
      scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {}
    };
  } catch (err) {
    scheduleReconnect();
  }
}

export function scheduleReconnect() {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    connectWebSocket(rpcHandler);
  }, state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, 10000);
}

export function initKeepalive(handleRpc) {
  if (handleRpc) rpcHandler = handleRpc;
  chrome.alarms.create("agent-bridge-keepalive", { periodInMinutes: 0.4 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "agent-bridge-keepalive") {
      if (!state.wsSocket || state.wsSocket.readyState !== WebSocket.OPEN) {
        connectWebSocket(rpcHandler);
      } else {
        state.wsSocket.send(
          JSON.stringify({
            type: "heartbeat",
            profileId: state.profileId,
            profileName: state.profileName,
            ts: Date.now(),
          })
        );
      }
    }
  });
}

