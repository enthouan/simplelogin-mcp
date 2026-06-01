/**
 * Registers MCP tools for SimpleLogin custom domain operations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { customDomainUpdateInputSchema, domainIdInputSchema } from "../schemas/domains.js";

export function registerDomainTools(server: McpServer, client: ToolClient): void {
  server.registerTool("domain_list", { description: "List all SimpleLogin custom domains with verification, catch-all, mailbox, and alias-count details.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.listCustomDomains()));
  server.registerTool("domain_update", { description: "Update a SimpleLogin custom domain catch-all setting, random-prefix generation, name, or mailbox ids.", inputSchema: customDomainUpdateInputSchema.shape }, (input: unknown) => runTool(customDomainUpdateInputSchema, input, (args) => client.updateCustomDomain(args)));
  server.registerTool("domain_delete", { description: "Delete a SimpleLogin custom domain by numeric custom domain id.", inputSchema: domainIdInputSchema.shape }, (input: unknown) => runTool(domainIdInputSchema, input, (args) => client.deleteCustomDomain(args.id)));
  server.registerTool("domain_list_deleted_aliases", { description: "List deleted aliases in the trash for a SimpleLogin custom domain.", inputSchema: domainIdInputSchema.shape }, (input: unknown) => runTool(domainIdInputSchema, input, (args) => client.listDeletedAliasesForCustomDomain(args.id)));
}
