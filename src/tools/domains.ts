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
        'this endpoint without pagination, so the MCP result is capped by limit (defaults to ' +
        `${CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT}, max ${CUSTOM_DOMAIN_TRASH_MAX_LIMIT}).`,
      inputSchema: {
        custom_domain_id: z
          .number()
          .int()
          .describe('Numeric id of the custom domain whose trash to list.'),
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
        const limit = args.limit ?? CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT;
        const trash = await client.getCustomDomainTrash(args.custom_domain_id);
        return {
          aliases: trash.aliases.slice(0, limit),
          returned: Math.min(trash.aliases.length, limit),
          total: trash.aliases.length,
          truncated: trash.aliases.length > limit,
        };
      }),
  );
}
