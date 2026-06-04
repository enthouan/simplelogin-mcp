/**
 * @module tools/account
 * Account tools. The MVP exposes user info, which also serves as an API-key check.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { runTool } from './helpers.js';

export function registerAccountTools(server: McpServer, client: SimpleLoginClient): void {
  server.registerTool(
    'account_get_info',
    {
      title: 'Get account info',
      description:
        "Return the authenticated SimpleLogin user's info: name, email, premium/trial status, " +
        'and free-plan alias limit. Useful as a quick check that the configured API key is valid.',
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => client.getUserInfo()),
  );
}
