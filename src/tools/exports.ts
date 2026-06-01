/**
 * Registers MCP tools for SimpleLogin data export APIs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";

export function registerExportTools(server: McpServer, client: ToolClient): void {
  server.registerTool("export_data", { description: "Export full SimpleLogin user data including aliases, custom domains, and app metadata.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.exportData()));
  server.registerTool("export_aliases_csv", { description: "Export SimpleLogin aliases as importable CSV text.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.exportAliasesCsv()));
}
