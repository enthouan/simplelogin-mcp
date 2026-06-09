/**
 * @module tools/mailboxes
 * Mailbox workflow tools: list, create, update, and delete. A mailbox is a real
 * email address that receives alias mail, so the mutations carry guardrails: new
 * and changed addresses must be verified before use, deletion requires an
 * explicit decision about the aliases the mailbox owns, and the default mailbox
 * cannot be deleted.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { runTool } from './helpers.js';

export function registerMailboxTools(server: McpServer, client: SimpleLoginClient): void {
  server.registerTool(
    'mailbox_list',
    {
      title: 'List mailboxes',
      description:
        "List the account's mailboxes (verified and unverified), each with its id, email, " +
        'default flag, alias count, and verification status. Use the returned ids as ' +
        'mailbox_ids when creating or updating aliases.',
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => client.listMailboxes()),
  );

  server.registerTool(
    'mailbox_create',
    {
      title: 'Create mailbox',
      description:
        'Add a new mailbox (a real email address that receives alias mail) to the account. ' +
        'SimpleLogin sends a verification email to the address; the mailbox starts unverified ' +
        'and cannot own aliases or become the default until the user clicks that link. Check ' +
        'mailbox_list to see when verified turns true. Additional mailboxes may require a ' +
        'premium SimpleLogin plan.',
      inputSchema: {
        email: z
          .string()
          .email()
          .describe('Address of the new mailbox; it receives the verification email.'),
      },
    },
    (args) => runTool(() => client.createMailbox(args.email)),
  );

  server.registerTool(
    'mailbox_update',
    {
      title: 'Update mailbox',
      description:
        'Update a mailbox. Provide at least one change: set_default=true makes this mailbox the ' +
        'account default (it must be verified); email starts an address change that stays ' +
        'pending until the new address is verified via the email SimpleLogin sends it; ' +
        'cancel_email_change=true aborts such a pending change. set_default and ' +
        'cancel_email_change only accept true (a mailbox stops being default only when another ' +
        'is promoted, and a pending change is cancelled rather than toggled back), email and ' +
        'cancel_email_change are mutually exclusive, and a call that changes nothing is ' +
        'rejected without contacting SimpleLogin.',
      inputSchema: {
        mailbox_id: z.number().int().describe('Numeric id of the mailbox to update.'),
        email: z
          .string()
          .email()
          .optional()
          .describe('New address for the mailbox; the change is pending until verified.'),
        set_default: z
          .literal(true)
          .optional()
          .describe('Make this mailbox the account default. The mailbox must be verified.'),
        cancel_email_change: z
          .literal(true)
          .optional()
          .describe('Cancel a pending email change on this mailbox.'),
      },
    },
    (args) =>
      runTool(() =>
        client.updateMailbox(args.mailbox_id, {
          email: args.email,
          setDefault: args.set_default,
          cancelEmailChange: args.cancel_email_change,
        }),
      ),
  );

  server.registerTool(
    'mailbox_delete',
    {
      title: 'Delete mailbox',
      description:
        'Permanently delete a mailbox. The aliases it owns must be dealt with explicitly: pass ' +
        'transfer_aliases_to (the id of a different, verified mailbox from mailbox_list) to ' +
        'move them, or delete_aliases=true to delete them with the mailbox; exactly one of the ' +
        'two is required. The default mailbox cannot be deleted; promote another mailbox first ' +
        'via mailbox_update with set_default=true. This cannot be undone. Requires confirm=true ' +
        'as an explicit acknowledgement of the deletion.',
      inputSchema: {
        mailbox_id: z.number().int().describe('Numeric id of the mailbox to delete.'),
        transfer_aliases_to: z
          .number()
          .int()
          .optional()
          .describe('Id of a different verified mailbox that takes over the owned aliases.'),
        delete_aliases: z
          .literal(true)
          .optional()
          .describe('Explicitly acknowledge that the owned aliases are deleted with the mailbox.'),
        confirm: z
          .literal(true)
          .describe('Must be set to true to confirm this permanent, irreversible deletion.'),
      },
      annotations: { destructiveHint: true },
    },
    (args) =>
      runTool(() =>
        client.deleteMailbox(args.mailbox_id, {
          transferAliasesTo: args.transfer_aliases_to,
          deleteAliases: args.delete_aliases,
        }),
      ),
  );
}
