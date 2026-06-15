/**
 * @module tools/domains
 * Custom-domain workflow tools: list domains, update the supported per-domain
 * settings, and inspect a domain's trash (deleted aliases). The SimpleLogin API
 * exposes no domain create/delete or DNS verification endpoints, so those
 * account-level operations stay in the web UI by design; the mutation here is
 * narrowly scoped to catch-all, prefix generation, display name, and mailboxes.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import {
  CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT,
  CUSTOM_DOMAIN_TRASH_MAX_LIMIT,
  toolAnnotations,
} from './catalog.js';
import { runTool } from './helpers.js';

export function registerCustomDomainTools(server: McpServer, client: SimpleLoginClient): void {
  server.registerTool(
    'custom_domain_list',
    {
      title: 'List custom domains',
      description:
        "List the account's custom domains, each with its id, domain name, verification " +
        'status, alias count, catch-all and random-prefix-generation flags, display name, ' +
        'and the mailboxes that receive its mail. Use the returned ids with ' +
        'custom_domain_update and custom_domain_trash_list.',
      annotations: toolAnnotations('custom_domain_list'),
    },
    () => runTool(() => client.listCustomDomains()),
  );

  server.registerTool(
    'custom_domain_update',
    {
      title: 'Update custom domain',
      description:
        'Update a custom domain. Provide at least one change: catch_all toggles whether mail ' +
        'to any unknown address on the domain auto-creates an alias; random_prefix_generation ' +
        'toggles random prefixes for on-the-fly aliases; name sets the display name used as the ' +
        'From name on the domain (null clears it); mailbox_ids replaces the full set of ' +
        "mailboxes receiving the domain's mail (1 to 20 ids from mailbox_list). Only the " +
        'provided fields change, a call that changes nothing is rejected without contacting ' +
        'SimpleLogin, and the updated domain is returned.',
      inputSchema: {
        custom_domain_id: z.number().int().describe('Numeric id of the custom domain to update.'),
        catch_all: z
          .boolean()
          .optional()
          .describe('Auto-create an alias when mail arrives for an unknown address on the domain.'),
        random_prefix_generation: z
          .boolean()
          .optional()
          .describe('Use a random prefix instead of the address when auto-creating aliases.'),
        name: z
          .string()
          .nullable()
          .optional()
          .describe("Display name used as the From name for the domain's aliases; null clears it."),
        mailbox_ids: z
          .array(z.number().int())
          .min(1)
          .max(20)
          .optional()
          .describe("Replace the full set of mailboxes that receive the domain's mail, by id."),
      },
      annotations: toolAnnotations('custom_domain_update'),
    },
    (args) =>
      runTool(() =>
        client.updateCustomDomain(args.custom_domain_id, {
          catchAll: args.catch_all,
          randomPrefixGeneration: args.random_prefix_generation,
          name: args.name,
          mailboxIds: args.mailbox_ids,
        }),
      ),
  );

  server.registerTool(
    'custom_domain_trash_list',
    {
      title: 'List custom domain trash',
      description:
        "List a custom domain's deleted aliases (its trash), each with the alias address and " +
        'a Unix deletion timestamp. Deleted addresses on a custom domain are remembered so ' +
        'they are not silently recreated by catch-all; use this to audit what was removed or ' +
        'to check whether an address is in the trash before reusing it. SimpleLogin exposes ' +
        'this endpoint without server-side pagination, so the MCP result is locally paged with ' +
        'page_id (starts at 0) and limit (defaults to ' +
        `${CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT}, max ${CUSTOM_DOMAIN_TRASH_MAX_LIMIT}).`,
      inputSchema: {
        custom_domain_id: z
          .number()
          .int()
          .describe('Numeric id of the custom domain whose trash to list.'),
        page_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page number; defaults to 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CUSTOM_DOMAIN_TRASH_MAX_LIMIT)
          .optional()
          .describe(
            `Maximum deleted aliases to return; defaults to ${CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT}.`,
          ),
      },
      annotations: toolAnnotations('custom_domain_trash_list'),
    },
    (args) =>
      runTool(async () => {
        const pageId = args.page_id ?? 0;
        const limit = args.limit ?? CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT;
        const trash = await client.getCustomDomainTrash(args.custom_domain_id);
        const offset = pageId * limit;
        const aliases = trash.aliases.slice(offset, offset + limit);
        return {
          aliases,
          page_id: pageId,
          limit,
          returned: aliases.length,
          total: trash.aliases.length,
          more: offset + aliases.length < trash.aliases.length,
        };
      }),
  );
}
