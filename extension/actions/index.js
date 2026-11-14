// Agent Bridge MCP - Central Action Registry & Router (ES Module)
import { state } from "../core/state.js";
import { tabActions } from "./tabs.js";
import { navigationActions } from "./navigation.js";
import { snapshotActions } from "./snapshots.js";
import { extractionActions } from "./extraction.js";
import { interactionActions } from "./interaction.js";
import { networkActions } from "./network.js";
import { browserDataActions } from "./browser_data.js";
import { mediaActions } from "./media.js";
import { emulationActions } from "./emulation.js";
import { diagnosticActions } from "./diagnostics.js";

const actionRegistry = {
  ...tabActions,
  ...navigationActions,
  ...snapshotActions,
  ...extractionActions,
  ...interactionActions,
  ...networkActions,
  ...browserDataActions,
  ...mediaActions,
  ...emulationActions,
  ...diagnosticActions,
};

export async function handleRpc(action, params = {}) {
  if (!state.agentControlEnabled) {
    throw new Error(
      `Agent control is currently DISABLED by user in profile "${state.profileName}". Toggle 'Allow Agent Control' ON in the extension popup.`
    );
  }

  const handler = actionRegistry[action];
  if (!handler) {
    throw new Error(`Unknown action: "${action}". Supported actions: ${Object.keys(actionRegistry).length}`);
  }

  return await handler(params, handleRpc);
}

export { actionRegistry };

