/**
 * Zod schemas for SimpleLogin custom domain APIs.
 */
import { z } from "zod";
import { integerIdSchema, mailboxSummarySchema } from "./common.js";

export const customDomainSchema = z
  .object({
    id: integerIdSchema,
    domain_name: z.string(),
    is_verified: z.boolean(),
    catch_all: z.boolean(),
    creation_date: z.string().optional(),
    creation_timestamp: z.number().int().optional(),
    mailboxes: z.array(mailboxSummarySchema).optional(),
    name: z.string().nullable().optional(),
    nb_alias: z.number().int().optional(),
    random_prefix_generation: z.boolean().optional(),
  })
  .passthrough();

export const customDomainListResponseSchema = z.array(customDomainSchema);
export const domainIdInputSchema = z.object({ id: integerIdSchema });
export const customDomainUpdateInputSchema = z.object({
  id: integerIdSchema,
  catch_all: z.boolean().optional(),
  random_prefix_generation: z.boolean().optional(),
  random_prefix: z.boolean().optional(),
  name: z.string().nullable().optional(),
  mailbox_ids: z.array(integerIdSchema).optional(),
});

export const deletedAliasSchema = z.object({ alias: z.string(), deletion_timestamp: z.number().int() }).passthrough();
export const deletedAliasesResponseSchema = z.object({ aliases: z.array(deletedAliasSchema) }).passthrough();
