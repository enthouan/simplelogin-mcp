/**
 * @module schemas/mailbox
 * Zod schemas for mailbox API responses.
 */
import { z } from 'zod';

/** A mailbox as returned by GET /api/v2/mailboxes. */
export const MailboxSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  default: z.boolean(),
  creation_timestamp: z.number(),
  nb_alias: z.number().optional(),
  verified: z.boolean().optional(),
});
export type Mailbox = z.infer<typeof MailboxSchema>;

/** GET /api/v2/mailboxes response. */
export const MailboxListResponseSchema = z.object({
  mailboxes: z.array(MailboxSchema),
});
export type MailboxListResponse = z.infer<typeof MailboxListResponseSchema>;

/**
 * POST /api/mailboxes response (201): the newly created mailbox, unverified until
 * the user clicks the verification email. creation_timestamp and nb_alias are
 * returned by current SimpleLogin but absent from the documented example, so they
 * stay optional for older or self-hosted instances.
 */
export const MailboxCreateResponseSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  verified: z.boolean(),
  default: z.boolean(),
  creation_timestamp: z.number().optional(),
  nb_alias: z.number().optional(),
});
export type MailboxCreateResponse = z.infer<typeof MailboxCreateResponseSchema>;

/** PUT /api/mailboxes/:id response. */
export const MailboxUpdateResponseSchema = z.object({
  updated: z.boolean(),
});
export type MailboxUpdateResponse = z.infer<typeof MailboxUpdateResponseSchema>;

/** DELETE /api/mailboxes/:id response. */
export const MailboxDeleteResponseSchema = z.object({
  deleted: z.boolean(),
});
export type MailboxDeleteResponse = z.infer<typeof MailboxDeleteResponseSchema>;
