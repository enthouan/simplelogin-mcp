/**
 * Shared Zod schema primitives used by SimpleLogin API request and response schemas.
 */
import { z } from "zod";

export const integerIdSchema = z.number().int().nonnegative();
export const pageIdSchema = z.number().int().nonnegative().optional();
export const nullableStringSchema = z.string().nullable();
export const unknownJsonSchema: z.ZodType<unknown> = z.unknown();
export const okSchema = z.object({}).passthrough();

export const mailboxSummarySchema = z.object({
  id: integerIdSchema,
  email: z.string(),
});

export const deleteResponseSchema = z.object({ deleted: z.boolean() }).passthrough();
