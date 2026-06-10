/**
 * @module tools/account
 * Account utility tools: user info (which doubles as an API-key check), stats,
 * notifications, and the account-wide alias settings. The only mutations here
 * are marking a notification read and a conservative settings update limited to
 * the five documented alias-behavior fields; auth, payment, account deletion,
 * and sudo-style endpoints are deliberately out of scope.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../client/simplelogin.js';
import { ALIAS_GENERATORS, SENDER_FORMATS, RANDOM_ALIAS_SUFFIXES } from '../schemas/account.js';
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

  server.registerTool(
    'account_get_stats',
    {
      title: 'Get account stats',
      description:
        "Return the account's lifetime counters: number of aliases (nb_alias) and number of " +
        'emails forwarded (nb_forward), replied to (nb_reply), and blocked (nb_block) across ' +
        'all aliases. Use alias_activity_list for the per-alias breakdown behind these totals.',
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => client.getStats()),
  );

  server.registerTool(
    'notification_list',
    {
      title: 'List notifications',
      description:
        'List account notifications from SimpleLogin (announcements, warnings such as a mailbox ' +
        'bouncing, etc.), 20 per page, unread first then newest first. Each entry has an id, ' +
        'title, HTML message, read flag, and a human-readable created_at. Use page_id for ' +
        'pagination (starts at 0); more=true means another page exists. Mark entries handled ' +
        'with notification_mark_read.',
      inputSchema: {
        page_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page number; 20 notifications per page. Defaults to 0.'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => runTool(() => client.listNotifications({ pageId: args.page_id ?? 0 })),
  );

  server.registerTool(
    'notification_mark_read',
    {
      title: 'Mark notification read',
      description:
        'Mark a single account notification as read, by the id from notification_list. ' +
        'Idempotent: marking an already-read notification succeeds and changes nothing. ' +
        'Notifications cannot be marked unread or deleted via the API.',
      inputSchema: {
        notification_id: z
          .number()
          .int()
          .describe('Numeric id of the notification to mark as read.'),
      },
      annotations: { idempotentHint: true },
    },
    (args) => runTool(() => client.markNotificationRead(args.notification_id)),
  );

  server.registerTool(
    'settings_get',
    {
      title: 'Get account settings',
      description:
        'Return the account-wide alias settings: alias_generator (random-alias address style), ' +
        'notification (email notifications on/off), random_alias_default_domain (domain used ' +
        'for random aliases), sender_format (how the original sender appears in forwarded ' +
        'mail), and random_alias_suffix (suffix style for random and on-the-fly aliases). ' +
        'Change them with settings_update.',
      annotations: { readOnlyHint: true },
    },
    () => runTool(() => client.getSettings()),
  );

  server.registerTool(
    'settings_update',
    {
      title: 'Update account settings',
      description:
        'Update the account-wide alias settings; only the provided fields change and the ' +
        'resulting settings are returned. Deliberately limited to the five documented ' +
        'alias-behavior fields: account email, password, payment, and deletion are out of ' +
        'scope and stay in the web UI. random_alias_default_domain must be a domain from ' +
        'alias_domains_list (premium-only domains need a premium account; a custom domain must ' +
        'be yours and verified). A call that changes nothing is rejected without contacting ' +
        'SimpleLogin.',
      inputSchema: {
        alias_generator: z
          .enum(ALIAS_GENERATORS)
          .optional()
          .describe('Address style for random aliases: "word" (word-based) or "uuid".'),
        notification: z
          .boolean()
          .optional()
          .describe('Whether SimpleLogin sends the user email notifications.'),
        random_alias_default_domain: z
          .string()
          .optional()
          .describe('Domain used for random aliases; one of the domains from alias_domains_list.'),
        sender_format: z
          .enum(SENDER_FORMATS)
          .optional()
          .describe(
            'How the original sender appears in forwarded mail. For john@wick.com ("John Wick"): ' +
              'AT = "John Wick - john at wick.com", A = "John Wick - john(a)wick.com", ' +
              'NAME_ONLY = "John Wick", AT_ONLY = "john at wick.com", NO_NAME = no sender shown.',
          ),
        random_alias_suffix: z
          .enum(RANDOM_ALIAS_SUFFIXES)
          .optional()
          .describe(
            'Suffix style for random and on-the-fly aliases: "word" (dictionary word) or ' +
              '"random_string".',
          ),
      },
    },
    (args) =>
      runTool(() =>
        client.updateSettings({
          aliasGenerator: args.alias_generator,
          notification: args.notification,
          randomAliasDefaultDomain: args.random_alias_default_domain,
          senderFormat: args.sender_format,
          randomAliasSuffix: args.random_alias_suffix,
        }),
      ),
  );
}
