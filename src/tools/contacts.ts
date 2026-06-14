/**
 * @module tools/contacts
 * Contact (reverse-alias) workflow tools for an existing alias: list contacts,
 * create a contact, block/unblock forwarding from a contact, and delete a contact.
 * A contact is the address an alias can send mail *to*; replying through its
 * reverse alias keeps the user's real mailbox hidden from the recipient.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { toolAnnotations } from './catalog.js';
import { runTool } from './helpers.js';

export function registerContactTools(server: McpServer, client: SimpleLoginClient): void {
  server.registerTool(
    'contact_list',
    {
      title: 'List alias contacts',
      description:
        'List the contacts (reverse aliases) for a single SimpleLogin alias, 20 per page. Each ' +
        'contact is an address the alias can correspond with: it carries the contact email, a ' +
        'reverse_alias_address the user sends to in order to reach that contact from the alias, ' +
        'whether forwarding from it is blocked (block_forward), and when it was last emailed. ' +
        'Use page_id for pagination (starts at 0).',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias whose contacts to list.'),
        page_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page number; 20 contacts per page. Defaults to 0.'),
      },
      annotations: toolAnnotations('contact_list'),
    },
    (args) =>
      runTool(() =>
        client.listAliasContacts({ aliasId: args.alias_id, pageId: args.page_id ?? 0 }),
      ),
  );

  server.registerTool(
    'contact_create',
    {
      title: 'Create alias contact',
      description:
        'Create a contact (reverse alias) on an alias so the user can send mail from the alias ' +
        'to that contact while keeping their real mailbox hidden. Pass the recipient as a bare ' +
        'address ("first@example.com") or an RFC-5322 display form ("First Last ' +
        '<first@example.com>"). The response includes the reverse_alias_address to send to; ' +
        'existed=true means the contact already existed and nothing was created. Creating ' +
        'reverse aliases may require a premium SimpleLogin plan.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias to create the contact on.'),
        contact: z
          .string()
          .min(1)
          .describe(
            'Recipient address, optionally with a display name: "Name <addr@example.com>".',
          ),
      },
      annotations: toolAnnotations('contact_create'),
    },
    (args) =>
      runTool(() => client.createContact({ aliasId: args.alias_id, contact: args.contact })),
  );

  server.registerTool(
    'contact_set_blocked',
    {
      title: 'Block/unblock alias contact',
      description:
        'Set whether forwarding from a contact to its alias is blocked. Pass blocked=true to stop ' +
        'mail from that contact reaching the user, or blocked=false to allow it again. Requires ' +
        'the alias_id (the contact belongs to it) so the current state can be read first: setting ' +
        'the state it is already in is a no-op. Returns the resulting block_forward state.',
      inputSchema: {
        alias_id: z.number().int().describe('Numeric id of the alias the contact belongs to.'),
        contact_id: z.number().int().describe('Numeric id of the contact to block or unblock.'),
        blocked: z
          .boolean()
          .describe('Desired state: true to block forwarding from the contact, false to allow it.'),
      },
      annotations: toolAnnotations('contact_set_blocked'),
    },
    (args) => runTool(() => client.setContactBlocked(args.alias_id, args.contact_id, args.blocked)),
  );

  server.registerTool(
    'contact_delete',
    {
      title: 'Delete alias contact',
      description:
        'Permanently delete a contact (reverse alias) by its numeric id. This cannot be undone; ' +
        'the reverse-alias address stops working and the correspondence history for that contact ' +
        'is removed. To merely stop receiving mail from the contact, prefer contact_set_blocked ' +
        'with blocked=true instead. Requires confirm=true as an explicit acknowledgement.',
      inputSchema: {
        contact_id: z.number().int().describe('Numeric id of the contact to delete.'),
        confirm: z
          .literal(true)
          .describe('Must be set to true to confirm this permanent, irreversible deletion.'),
      },
      annotations: toolAnnotations('contact_delete'),
    },
    (args) => runTool(() => client.deleteContact(args.contact_id)),
  );
}
