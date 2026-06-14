/**
 * @module tools/aliases
 * Alias workflow tools: list, get, create (random/custom), update, delete,
 * set-enabled, plus the supporting options/domains lookups needed to drive custom
 * creation.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { toolAnnotations } from './catalog.js';
import { runTool } from './helpers.js';

export function registerAliasTools(server: McpServer, client: SimpleLoginClient): void {
  server.registerTool(
    'alias_list',
    {
      title: 'List aliases',
      description:
        "List the user's SimpleLogin email aliases, 20 per page. Use page_id for " +
        'pagination (starts at 0). Optionally filter to only enabled, only disabled, or ' +
        'only pinned aliases, and/or search by a free-text query matching the alias email, ' +
        'note, or name.',
      inputSchema: {
        page_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page number; 20 aliases per page. Defaults to 0.'),
        filter: z
          .enum(['enabled', 'disabled', 'pinned'])
          .optional()
          .describe('Return only aliases in this state. Mutually exclusive.'),
        query: z.string().optional().describe('Free-text search over alias email, note, and name.'),
      },
      annotations: toolAnnotations('alias_list'),
    },
    (args) =>
      runTool(() =>
        client.listAliases({ pageId: args.page_id ?? 0, filter: args.filter, query: args.query }),
      ),
  );

  server.registerTool(
    'alias_get',
    {
      title: 'Get alias',
      description:
        'Get full details of a single SimpleLogin alias by its numeric id, including note, ' +
        'mailboxes, enabled/pinned state, PGP status, and activity counters.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias to fetch.'),
      },
      annotations: toolAnnotations('alias_get'),
    },
    (args) => runTool(() => client.getAlias(args.alias_id)),
  );

  server.registerTool(
    'alias_activity_list',
    {
      title: 'List alias activity',
      description:
        'List the forward/reply/block activity history for a single SimpleLogin alias, 20 ' +
        'entries per page (most recent first). Each entry has an action (forward, reply, block, ' +
        'or bounced), the from/to addresses, a Unix timestamp, and the reverse-alias address for ' +
        'replies. Use page_id for pagination (starts at 0); the per-page cap keeps responses ' +
        'bounded, so page through rather than expecting the full history in one call.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias whose activity to list.'),
        page_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page number; 20 entries per page. Defaults to 0.'),
      },
      annotations: toolAnnotations('alias_activity_list'),
    },
    (args) =>
      runTool(() =>
        client.listAliasActivities({ aliasId: args.alias_id, pageId: args.page_id ?? 0 }),
      ),
  );

  server.registerTool(
    'alias_create_random',
    {
      title: 'Create random alias',
      description:
        'Create a new random SimpleLogin alias with a system-generated address. mode "uuid" ' +
        'produces a random-string address; "word" produces a word-based one; omit to use the ' +
        'account default. Optionally attach a note and the website hostname the alias is for.',
      inputSchema: {
        mode: z
          .enum(['uuid', 'word'])
          .optional()
          .describe('Address style: "uuid" or "word". Defaults to the account setting.'),
        note: z.string().optional().describe('Optional note stored on the alias.'),
        hostname: z
          .string()
          .optional()
          .describe('Website hostname this alias is created for (context only).'),
      },
      annotations: toolAnnotations('alias_create_random'),
    },
    (args) =>
      runTool(() =>
        client.createRandomAlias({ mode: args.mode, note: args.note, hostname: args.hostname }),
      ),
  );

  server.registerTool(
    'alias_create_custom',
    {
      title: 'Create custom alias',
      description:
        'Create a custom SimpleLogin alias with a chosen prefix and suffix. First call ' +
        'alias_options_get to obtain a valid signed_suffix and confirm can_create is true, ' +
        'then pass that exact signed_suffix here with the desired alias_prefix and the ' +
        'mailbox_ids (from mailbox_list) that should receive mail. note and name are optional.',
      inputSchema: {
        alias_prefix: z
          .string()
          .min(1)
          .describe('The local part chosen by the user (text before the suffix).'),
        signed_suffix: z
          .string()
          .min(1)
          .describe('A signed_suffix value returned verbatim by alias_options_get.'),
        mailbox_ids: z
          .array(z.number().int())
          .min(1)
          .describe('Ids of mailboxes that will own and receive mail for this alias.'),
        note: z.string().optional().describe('Optional note stored on the alias.'),
        name: z.string().optional().describe('Optional display name for the alias.'),
        hostname: z
          .string()
          .optional()
          .describe('Website hostname this alias is created for (context only).'),
      },
      annotations: toolAnnotations('alias_create_custom'),
    },
    (args) =>
      runTool(() =>
        client.createCustomAlias({
          aliasPrefix: args.alias_prefix,
          signedSuffix: args.signed_suffix,
          mailboxIds: args.mailbox_ids,
          note: args.note,
          name: args.name,
          hostname: args.hostname,
        }),
      ),
  );

  server.registerTool(
    'alias_update',
    {
      title: 'Update alias',
      description:
        'Update an existing alias. Provide at least one field to change: note, display name, ' +
        'the owning mailbox (mailbox_id) or full mailbox set (mailbox_ids), whether PGP is ' +
        'disabled, and whether the alias is pinned. Only the provided fields change. ' +
        'mailbox_id and mailbox_ids are mutually exclusive, and a call that changes nothing ' +
        'is rejected without contacting SimpleLogin.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias to update.'),
        note: z.string().optional().describe('Replace the alias note.'),
        name: z.string().optional().describe('Replace the alias display name.'),
        mailbox_id: z.number().int().optional().describe('Set a single owning mailbox by id.'),
        mailbox_ids: z
          .array(z.number().int())
          .optional()
          .describe('Replace the full set of owning mailboxes by id.'),
        disable_pgp: z
          .boolean()
          .optional()
          .describe('Disable PGP on this alias even if a mailbox supports it.'),
        pinned: z.boolean().optional().describe('Pin or unpin the alias.'),
      },
      annotations: toolAnnotations('alias_update'),
    },
    (args) =>
      runTool(() =>
        client.updateAlias(args.alias_id, {
          note: args.note,
          name: args.name,
          mailboxId: args.mailbox_id,
          mailboxIds: args.mailbox_ids,
          disablePgp: args.disable_pgp,
          pinned: args.pinned,
        }),
      ),
  );

  server.registerTool(
    'alias_delete',
    {
      title: 'Delete alias',
      description:
        'Permanently delete a SimpleLogin alias by id. This cannot be undone; mail sent to the ' +
        'address afterwards is rejected. Prefer alias_set_enabled with enabled=false to merely ' +
        'disable an alias. Requires confirm=true as an explicit acknowledgement of the deletion.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias to delete.'),
        confirm: z
          .literal(true)
          .describe('Must be set to true to confirm this permanent, irreversible deletion.'),
      },
      annotations: toolAnnotations('alias_delete'),
    },
    (args) => runTool(() => client.deleteAlias(args.alias_id)),
  );

  server.registerTool(
    'alias_set_enabled',
    {
      title: 'Enable/disable alias',
      description:
        'Set a SimpleLogin alias to a specific enabled state. Pass enabled=true to enable or ' +
        'enabled=false to disable. A disabled alias silently blocks incoming mail without being ' +
        'deleted. Idempotent: setting the state it is already in changes nothing. Returns the ' +
        'resulting enabled state.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias to update.'),
        enabled: z
          .boolean()
          .describe('Desired state: true to enable the alias, false to disable it.'),
      },
      annotations: toolAnnotations('alias_set_enabled'),
    },
    (args) => runTool(() => client.setAliasEnabled(args.alias_id, args.enabled)),
  );

  server.registerTool(
    'alias_options_get',
    {
      title: 'Get alias creation options',
      description:
        'Fetch the options needed to create a custom alias: whether the user can create more ' +
        'aliases (can_create), a prefix suggestion, and the list of available suffixes — each ' +
        'with the signed_suffix required by alias_create_custom. Pass the target website ' +
        'hostname to tailor the suggestion.',
      inputSchema: {
        hostname: z
          .string()
          .optional()
          .describe('Website hostname to tailor the prefix suggestion.'),
      },
      annotations: toolAnnotations('alias_options_get'),
    },
    (args) => runTool(() => client.getAliasOptions(args.hostname)),
  );

  server.registerTool(
    'alias_domains_list',
    {
      title: 'List alias domains',
      description:
        'List the email domains available for creating aliases on this account, each flagged ' +
        'is_custom (a user-owned domain) or not (a SimpleLogin public domain).',
      annotations: toolAnnotations('alias_domains_list'),
    },
    () => runTool(() => client.listDomains()),
  );
}
