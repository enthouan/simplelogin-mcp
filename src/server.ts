/**
 * @module server
 * Builds a fully-wired McpServer with every SimpleLogin tool registered. Pure
 * factory: callers own the transport and lifecycle. For stateless HTTP a fresh
 * server is built per request, so this stays cheap and side-effect free.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from './client/simplelogin.js';
import { registerAllTools } from './tools/index.js';
import { VERSION } from './version.js';

/** Construct an McpServer bound to the given SimpleLogin client. */
export function buildServer(client: SimpleLoginClient): McpServer {
  const server = new McpServer({ name: 'simplelogin-mcp', version: VERSION });
  registerAllTools(server, client);
  return server;
}
