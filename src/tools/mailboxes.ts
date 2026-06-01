/**
 * Registers MCP tools for SimpleLogin mailbox management.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { mailboxCreateInputSchema, mailboxDeleteInputSchema, mailboxUpdateInputSchema } from "../schemas/mailboxes.js";

export function registerMailboxTools(server: McpServer, client: ToolClient): void {
  server.registerTool("mailbox_list", { description: "List all SimpleLogin mailboxes, including default, verification, and alias-count metadata.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.listMailboxes()));
  server.registerTool("mailbox_create", { description: "Create a new SimpleLogin mailbox address and send its verification email.", inputSchema: mailboxCreateInputSchema.shape }, (input: unknown) => runTool(mailboxCreateInputSchema, input, (args) => client.createMailbox(args)));
  server.registerTool("mailbox_delete", { description: "Delete a SimpleLogin mailbox, optionally transferring owned aliases to another mailbox id.", inputSchema: mailboxDeleteInputSchema.shape }, (input: unknown) => runTool(mailboxDeleteInputSchema, input, (args) => client.deleteMailbox(args)));
  server.registerTool("mailbox_update", { description: "Update a SimpleLogin mailbox email address, make it default, or cancel a pending email change.", inputSchema: mailboxUpdateInputSchema.shape }, (input: unknown) => runTool(mailboxUpdateInputSchema, input, (args) => client.updateMailbox(args)));
}
