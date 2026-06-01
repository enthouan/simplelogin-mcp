/**
 * Registers MCP tools for SimpleLogin alias and alias option operations.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClient } from "./types.js";
import { runTool } from "./types.js";
import { aliasIdInputSchema, aliasListInputSchema, aliasOptionsInputSchema, aliasPagedInputSchema, aliasUpdateInputSchema, createCustomAliasInputSchema, createRandomAliasInputSchema } from "../schemas/aliases.js";

export function registerAliasTools(server: McpServer, client: ToolClient): void {
  server.registerTool("alias_list", { description: "List SimpleLogin aliases with optional pagination, enabled/disabled/pinned filter, sort, and search query.", inputSchema: aliasListInputSchema.shape }, (input: unknown) => runTool(aliasListInputSchema, input, (args) => client.listAliases(args)));
  server.registerTool("alias_get", { description: "Get detailed information for one SimpleLogin alias by numeric alias id.", inputSchema: aliasIdInputSchema.shape }, (input: unknown) => runTool(aliasIdInputSchema, input, (args) => client.getAlias(args.id)));
  server.registerTool("alias_create_random", { description: "Create a new random SimpleLogin alias, optionally tied to a hostname, generation mode, note, and mailbox.", inputSchema: createRandomAliasInputSchema.shape }, (input: unknown) => runTool(createRandomAliasInputSchema, input, (args) => client.createRandomAlias(args)));
  server.registerTool("alias_create_custom", { description: "Create a custom SimpleLogin alias using an alias prefix, signed suffix from alias_options_get, mailbox ids, optional note, and optional display name.", inputSchema: createCustomAliasInputSchema.shape }, (input: unknown) => runTool(createCustomAliasInputSchema, input, (args) => client.createCustomAlias(args)));
  server.registerTool("alias_delete", { description: "Delete one SimpleLogin alias permanently by numeric alias id.", inputSchema: aliasIdInputSchema.shape }, (input: unknown) => runTool(aliasIdInputSchema, input, (args) => client.deleteAlias(args.id)));
  server.registerTool("alias_update", { description: "Update a SimpleLogin alias note, display name, mailbox ownership, PGP disabled state, or pinned state.", inputSchema: aliasUpdateInputSchema.shape }, (input: unknown) => runTool(aliasUpdateInputSchema, input, (args) => client.updateAlias(args)));
  server.registerTool("alias_toggle", { description: "Toggle a SimpleLogin alias between enabled and disabled status by alias id.", inputSchema: aliasIdInputSchema.shape }, (input: unknown) => runTool(aliasIdInputSchema, input, (args) => client.toggleAlias(args.id)));
  server.registerTool("alias_list_contacts", { description: "List contacts and reverse aliases for a SimpleLogin alias with optional pagination.", inputSchema: z.object({ alias_id: z.number().int().nonnegative(), page_id: z.number().int().nonnegative().optional() }).shape }, (input: unknown) => runTool(z.object({ alias_id: z.number().int().nonnegative(), page_id: z.number().int().nonnegative().optional() }), input, (args) => client.listAliasContacts(args)));
  server.registerTool("alias_list_activities", { description: "List forwarding, reply, block, or bounce activities for a SimpleLogin alias with optional pagination.", inputSchema: aliasPagedInputSchema.shape }, (input: unknown) => runTool(aliasPagedInputSchema, input, (args) => client.listAliasActivities(args.id, args.page_id)));
  server.registerTool("alias_options_get", { description: "Get alias creation options including signed suffixes and prefix suggestions, optionally for a hostname.", inputSchema: aliasOptionsInputSchema.shape }, (input: unknown) => runTool(aliasOptionsInputSchema, input, (args) => client.getAliasOptions(args)));
  server.registerTool("alias_domains_list", { description: "List domains available for SimpleLogin random alias creation, including custom-domain flags.", inputSchema: {} }, (input: unknown) => runTool(z.object({}), input, () => client.listAliasDomains()));
}
