/**
 * @module schemas/contact
 * Zod schemas for alias contact (reverse-alias) API responses. As with the other
 * schemas, fields that older or self-hosted SimpleLogin instances may omit are
 * optional/nullable so validation stays robust across versions.
 */
import { z } from 'zod';

/**
 * A single contact (reverse alias) as returned by GET
 * /api/aliases/:id/contacts. `block_forward` is whether mail forwarded from this
 * contact to the alias is currently blocked. The last-email-sent fields are null
 * until the user first replies to the contact through its reverse alias.
 */
export const ContactSchema = z.object({
  id: z.number().int(),
  contact: z.string(),
  creation_date: z.string().optional(),
  creation_timestamp: z.number(),
  last_email_sent_date: z.string().nullable().optional(),
  last_email_sent_timestamp: z.number().nullable().optional(),
  reverse_alias: z.string(),
  reverse_alias_address: z.string().optional(),
  block_forward: z.boolean(),
});
export type Contact = z.infer<typeof ContactSchema>;

/** GET /api/aliases/:id/contacts response (max 20 contacts per page). */
export const ContactListResponseSchema = z.object({
  contacts: z.array(ContactSchema),
});
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;

/**
 * POST /api/aliases/:id/contacts response. A freshly created contact returns the
 * full object with `existed: false` (and no `block_forward`); when the contact
 * already existed, SimpleLogin returns only `{ existed: true }`. Every contact
 * field is therefore optional, and `existed` is the one field present in both
 * cases.
 */
export const ContactCreateResponseSchema = z.object({
  id: z.number().int().optional(),
  contact: z.string().optional(),
  creation_date: z.string().optional(),
  creation_timestamp: z.number().optional(),
  last_email_sent_date: z.string().nullable().optional(),
  last_email_sent_timestamp: z.number().nullable().optional(),
  reverse_alias: z.string().optional(),
  reverse_alias_address: z.string().optional(),
  existed: z.boolean(),
});
export type ContactCreateResponse = z.infer<typeof ContactCreateResponseSchema>;

/** POST /api/contacts/:id/toggle response (the resulting block state). */
export const ContactToggleResponseSchema = z.object({
  block_forward: z.boolean(),
});
export type ContactToggleResponse = z.infer<typeof ContactToggleResponseSchema>;

/** DELETE /api/contacts/:id response. */
export const ContactDeleteResponseSchema = z.object({
  deleted: z.boolean(),
});
export type ContactDeleteResponse = z.infer<typeof ContactDeleteResponseSchema>;
