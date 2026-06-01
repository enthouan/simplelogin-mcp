/**
 * Zod schemas for SimpleLogin contact APIs.
 */
import { z } from "zod";
import { integerIdSchema, nullableStringSchema, pageIdSchema } from "./common.js";

export const contactSchema = z
  .object({
    id: integerIdSchema,
    contact: z.string(),
    creation_date: z.string().optional(),
    creation_timestamp: z.number().int().optional(),
    last_email_sent_date: nullableStringSchema.optional(),
    last_email_sent_timestamp: z.number().int().nullable().optional(),
    reverse_alias: z.string(),
    reverse_alias_address: z.string().optional(),
    block_forward: z.boolean().optional(),
    existed: z.boolean().optional(),
  })
  .passthrough();

export const contactsResponseSchema = z.object({ contacts: z.array(contactSchema) }).passthrough();
export const contactCreateInputSchema = z.object({ alias_id: integerIdSchema, contact: z.string().min(1) });
export const contactIdInputSchema = z.object({ id: integerIdSchema });
export const contactToggleResponseSchema = z.object({ block_forward: z.boolean() }).passthrough();
export const aliasContactsInputSchema = z.object({ alias_id: integerIdSchema, page_id: pageIdSchema });
