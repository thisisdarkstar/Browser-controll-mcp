#!/usr/bin/env node
// Agent Bridge MCP Server - Main Entrypoint (ES Module)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureMasterOrRelay, initMasterRelayWatchdog } from "./core/bridge.js";
import { registerAllTools } from "./tools/registry.js";

// 1. Initialize Master Server or Relay Client
await ensureMasterOrRelay();
initMasterRelayWatchdog();

// 2. Initialize MCP Server
const server = new McpServer({
  name: "custom-browser-bridge",
  version: "2.2.0",
});

// 3. Register All 68 Tools Across Modules
registerAllTools(server);

// 4. Start Transport
const transport = new StdioServerTransport();
await server.connect(transport);
