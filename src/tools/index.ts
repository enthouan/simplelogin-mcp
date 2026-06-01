/**
 * Registers every SimpleLogin MCP tool group on an MCP server instance.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SimpleLoginClient } from "../client/simplelogin.js";
import { registerAccountTools } from "./account.js";
import { registerAliasTools } from "./aliases.js";
import { registerContactTools } from "./contacts.js";
import { registerDomainTools } from "./domains.js";
import { registerExportTools } from "./exports.js";
import { registerMailboxTools } from "./mailboxes.js";
import { registerNotificationTools } from "./notifications.js";

export function registerTools(server: McpServer, client: SimpleLoginClient): void {
  registerAliasTools(server, client);
  registerMailboxTools(server, client);
  registerDomainTools(server, client);
  registerContactTools(server, client);
  registerAccountTools(server, client);
  registerNotificationTools(server, client);
  registerExportTools(server, client);
}
