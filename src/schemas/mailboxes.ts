/**
 * Zod schemas for SimpleLogin mailbox APIs.
 */
import { z } from "zod";
import { integerIdSchema } from "./common.js";

export const mailboxSchema = z
  .object({
    id: integerIdSchema,
    email: z.string(),
    default: z.boolean(),
    verified: z.boolean().optional(),
    creation_timestamp: z.number().int().optional(),
    nb_alias: z.number().int().optional(),
  })
  .passthrough();

export const mailboxListResponseSchema = z.object({ mailboxes: z.array(mailboxSchema) }).passthrough();
export const mailboxCreateInputSchema = z.object({ email: z.string().email() });
export const mailboxDeleteInputSchema = z.object({
  id: integerIdSchema,
  transfer_aliases_to: z.number().int().optional(),
});
export const mailboxUpdateInputSchema = z.object({
  id: integerIdSchema,
  email: z.string().email().optional(),
  default: z.boolean().optional(),
  cancel_email_change: z.boolean().optional(),
});
