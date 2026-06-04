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
