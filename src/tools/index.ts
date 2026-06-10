/**
 * @module tools/index
 * Registers every tool group on an McpServer. Adding a new group is one import and
 * one call here.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { registerAliasTools } from './aliases.js';
import { registerContactTools } from './contacts.js';
import { registerMailboxTools } from './mailboxes.js';
import { registerCustomDomainTools } from './domains.js';
import { registerAccountTools } from './account.js';

/** Wire all SimpleLogin tools onto the given server. */
export function registerAllTools(server: McpServer, client: SimpleLoginClient): void {
  registerAliasTools(server, client);
  registerContactTools(server, client);
  registerMailboxTools(server, client);
  registerCustomDomainTools(server, client);
  registerAccountTools(server, client);
}
