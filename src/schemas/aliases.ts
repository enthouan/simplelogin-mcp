/**
 * Zod schemas for SimpleLogin alias, alias option, activity, and alias contact APIs.
 */
import { z } from "zod";
import { integerIdSchema, mailboxSummarySchema, nullableStringSchema, pageIdSchema } from "./common.js";

const contactSummarySchema = z.object({
  email: z.string(),
  name: nullableStringSchema.optional(),
  reverse_alias: z.string(),
});

const latestActivitySchema = z
  .object({
    action: z.enum(["forward", "reply", "block", "bounced"]).or(z.string()),
    timestamp: z.number().int(),
    contact: contactSummarySchema,
  })
  .passthrough();

export const aliasSchema = z
  .object({
    id: integerIdSchema,
    email: z.string(),
    name: z.string().nullable().optional(),
    enabled: z.boolean(),
    creation_date: z.string().optional(),
    creation_timestamp: z.number().int(),
    note: z.string().nullable().optional(),
    nb_block: z.number().int().optional(),
    nb_forward: z.number().int().optional(),
    nb_reply: z.number().int().optional(),
    support_pgp: z.boolean().optional(),
    disable_pgp: z.boolean().optional(),
    mailbox: mailboxSummarySchema.optional(),
    mailboxes: z.array(mailboxSummarySchema).optional(),
    latest_activity: latestActivitySchema.nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .passthrough();

export const aliasListResponseSchema = z.object({ aliases: z.array(aliasSchema) }).passthrough();

export const aliasFilterSchema = z.enum(["enabled", "disabled", "pinned"]);
export const aliasListInputSchema = z.object({
  page_id: pageIdSchema,
  filter: aliasFilterSchema.optional(),
  sort: z.string().optional(),
  query: z.string().optional(),
});

export const aliasIdInputSchema = z.object({ id: integerIdSchema });

export const createRandomAliasInputSchema = z.object({
  hostname: z.string().optional(),
  mode: z.enum(["uuid", "word"]).optional(),
  note: z.string().optional(),
  mailbox_id: integerIdSchema.optional(),
});

export const createCustomAliasInputSchema = z.object({
  hostname: z.string().optional(),
  alias_prefix: z.string().min(1),
  signed_suffix: z.string().min(1),
  mailbox_ids: z.array(integerIdSchema).min(1),
  mailboxes: z.array(integerIdSchema).min(1).optional(),
  note: z.string().optional(),
  name: z.string().optional(),
});

export const aliasUpdateInputSchema = z.object({
  id: integerIdSchema,
  note: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  mailbox_id: integerIdSchema.optional(),
  mailbox_ids: z.array(integerIdSchema).optional(),
  disable_pgp: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const aliasToggleResponseSchema = z.object({ enabled: z.boolean() }).passthrough();

export const activitySchema = z
  .object({
    action: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    timestamp: z.number().int(),
    reverse_alias: z.string().optional(),
    reverse_alias_address: z.string().optional(),
  })
  .passthrough();

export const activitiesResponseSchema = z.object({ activities: z.array(activitySchema) }).passthrough();

export const aliasPagedInputSchema = z.object({ id: integerIdSchema, page_id: pageIdSchema });

export const aliasOptionSuffixSchema = z
  .object({
    suffix: z.string(),
    signed_suffix: z.string(),
    is_custom: z.boolean(),
    is_premium: z.boolean(),
  })
  .passthrough();

export const aliasOptionsResponseSchema = z
  .object({
    can_create: z.boolean(),
    prefix_suggestion: z.string(),
    suffixes: z.array(aliasOptionSuffixSchema),
    recommendation: z.unknown().optional(),
  })
  .passthrough();

export const aliasOptionsInputSchema = z.object({ hostname: z.string().optional() });

export const aliasDomainSchema = z.object({ domain: z.string(), is_custom: z.boolean() }).passthrough();
export const aliasDomainsResponseSchema = z.array(aliasDomainSchema);
