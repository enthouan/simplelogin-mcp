/**
 * Creates a configured MCP server instance with all SimpleLogin tools registered.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { SimpleLoginClient } from "./client/simplelogin.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = "simplelogin-mcp";

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: process.env.npm_package_version ?? "0.1.0" });
  const client = new SimpleLoginClient({ baseUrl: config.SL_API_URL, apiKey: config.SL_API_KEY });
  registerTools(server, client);
  return server;
}
