/**
 * Registers MCP tools for SimpleLogin account and settings operations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { settingsUpdateInputSchema } from "../schemas/settings.js";

export function registerAccountTools(server: McpServer, client: ToolClient): void {
  server.registerTool("account_get_info", { description: "Get SimpleLogin account information including email, display name, premium status, and trial details.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.getUserInfo()));
  server.registerTool("account_get_settings", { description: "Get current SimpleLogin settings for alias generation, notifications, sender format, and default random alias domain.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.getSettings()));
  server.registerTool("account_update_settings", { description: "Update SimpleLogin account settings such as notifications, alias generator, sender format, random alias domain, or suffix type.", inputSchema: settingsUpdateInputSchema.shape }, (input: unknown) => runTool(settingsUpdateInputSchema, input, (args) => client.updateSettings(args)));
}
