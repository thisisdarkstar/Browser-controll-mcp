// Agent Bridge MCP - Tool Registry Aggregator (ES Module)
import { registerTabTools } from "./tab-tools.js";
import { registerNavigationTools } from "./navigation-tools.js";
import { registerDomTools } from "./dom-tools.js";
import { registerExtractionTools } from "./extraction-tools.js";
import { registerNetworkTools } from "./network-tools.js";
import { registerBrowserDataTools } from "./browser-data-tools.js";
import { registerMediaTools } from "./media-tools.js";
import { registerEmulationTools } from "./emulation-tools.js";
import { registerDiagnosticTools } from "./diagnostic-tools.js";

export function registerAllTools(server) {
  registerTabTools(server);
  registerNavigationTools(server);
  registerDomTools(server);
  registerExtractionTools(server);
  registerNetworkTools(server);
  registerBrowserDataTools(server);
  registerMediaTools(server);
  registerEmulationTools(server);
  registerDiagnosticTools(server);
}
