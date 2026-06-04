/**
 * @module tools/mailboxes
 * Mailbox tools. The MVP exposes listing only; create/update/delete arrive in a
 * later pass and slot in here as additional registerTool calls.
 */
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
}
