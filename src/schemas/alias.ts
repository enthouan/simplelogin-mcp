/**
 * @module schemas/alias
 * Zod schemas for alias API responses. Fields that older or self-hosted
 * SimpleLogin instances may omit are marked optional/nullable so validation stays
 * robust across versions while still catching genuinely malformed payloads.
 */
import { z } from 'zod';

/** A mailbox reference as embedded in alias payloads. */
const MailboxRefSchema = z.object({
  id: z.number().int(),
  email: z.string(),
});

/** The most recent activity on an alias, when present. */
const AliasActivitySchema = z.object({
  action: z.string(),
  timestamp: z.number(),
  contact: z.object({
    email: z.string(),
    name: z.string().nullable(),
    reverse_alias: z.string(),
  }),
});

/** A single alias object, shared by list, get, and create responses. */
export const AliasSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string().nullable().optional(),
  enabled: z.boolean(),
  creation_date: z.string().optional(),
  creation_timestamp: z.number(),
  note: z.string().nullable().optional(),
  nb_block: z.number(),
  nb_forward: z.number(),
  nb_reply: z.number(),
  support_pgp: z.boolean().optional(),
  disable_pgp: z.boolean().optional(),
  mailbox: MailboxRefSchema.optional(),
  mailboxes: z.array(MailboxRefSchema),
  latest_activity: AliasActivitySchema.nullable().optional(),
  pinned: z.boolean().optional(),
});
export type Alias = z.infer<typeof AliasSchema>;

/** GET /api/v2/aliases response. */
export const AliasListResponseSchema = z.object({
  aliases: z.array(AliasSchema),
});
export type AliasListResponse = z.infer<typeof AliasListResponseSchema>;

/** One suffix option returned by the alias options endpoint. */
const AliasSuffixSchema = z.object({
  signed_suffix: z.string(),
  suffix: z.string(),
  is_custom: z.boolean(),
  is_premium: z.boolean(),
});

/** GET /api/v5/alias/options response. */
export const AliasOptionsSchema = z.object({
  can_create: z.boolean(),
  prefix_suggestion: z.string(),
  suffixes: z.array(AliasSuffixSchema),
  recommendation: z.object({ alias: z.string(), hostname: z.string() }).nullable().optional(),
});
export type AliasOptions = z.infer<typeof AliasOptionsSchema>;

/** POST /api/aliases/:id/toggle response. */
export const AliasToggleResponseSchema = z.object({
  enabled: z.boolean(),
});
export type AliasToggleResponse = z.infer<typeof AliasToggleResponseSchema>;

/** DELETE /api/aliases/:id response. */
export const AliasDeleteResponseSchema = z.object({
  deleted: z.boolean(),
});
export type AliasDeleteResponse = z.infer<typeof AliasDeleteResponseSchema>;

/**
 * PATCH /api/aliases/:id returns 200 with no documented body; accept anything so
 * the client can normalize it to a simple success result.
 */
export const AliasUpdateResponseSchema = z.unknown();

/**
 * One entry in an alias's activity log (GET /api/aliases/:id/activities). Distinct
 * from {@link AliasActivitySchema}, the trimmed `latest_activity` embedded in alias
 * objects: the log carries the message envelope (from/to, reverse alias). `action`
 * is left a plain string rather than an enum so newer/self-hosted instances that add
 * action types still validate; known values are forward, reply, block, and bounced.
 */
const AliasActivityEntrySchema = z.object({
  action: z.string(),
  from: z.string(),
  to: z.string(),
  timestamp: z.number(),
  reverse_alias: z.string().optional(),
  reverse_alias_address: z.string().optional(),
});
export type AliasActivityEntry = z.infer<typeof AliasActivityEntrySchema>;

/** GET /api/aliases/:id/activities response (max 20 entries per page). */
export const AliasActivitiesResponseSchema = z.object({
  activities: z.array(AliasActivityEntrySchema),
});
export type AliasActivitiesResponse = z.infer<typeof AliasActivitiesResponseSchema>;
