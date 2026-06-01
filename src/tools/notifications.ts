/**
 * Registers MCP tools for SimpleLogin notification APIs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { notificationIdInputSchema, notificationListInputSchema } from "../schemas/notifications.js";

export function registerNotificationTools(server: McpServer, client: ToolClient): void {
  server.registerTool("notification_list", { description: "List SimpleLogin notifications with optional zero-based page pagination.", inputSchema: notificationListInputSchema.shape }, (input: unknown) => runTool(notificationListInputSchema, input, (args) => client.listNotifications(args.page)));
  server.registerTool("notification_mark_read", { description: "Mark a SimpleLogin notification as read by numeric notification id.", inputSchema: notificationIdInputSchema.shape }, (input: unknown) => runTool(notificationIdInputSchema, input, (args) => client.markNotificationRead(args.id)));
}
