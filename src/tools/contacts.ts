/**
 * Registers MCP tools for SimpleLogin contact and reverse-alias operations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { contactCreateInputSchema, contactIdInputSchema } from "../schemas/contacts.js";

export function registerContactTools(server: McpServer, client: ToolClient): void {
  server.registerTool("contact_create", { description: "Create a SimpleLogin contact and reverse alias for a specific alias id and external contact address.", inputSchema: contactCreateInputSchema.shape }, (input: unknown) => runTool(contactCreateInputSchema, input, (args) => client.createContact(args)));
  server.registerTool("contact_delete", { description: "Delete one SimpleLogin contact by numeric contact id.", inputSchema: contactIdInputSchema.shape }, (input: unknown) => runTool(contactIdInputSchema, input, (args) => client.deleteContact(args.id)));
  server.registerTool("contact_toggle_block", { description: "Toggle whether a SimpleLogin contact is blocked from forwarding messages.", inputSchema: contactIdInputSchema.shape }, (input: unknown) => runTool(contactIdInputSchema, input, (args) => client.toggleContactBlock(args.id)));
}
