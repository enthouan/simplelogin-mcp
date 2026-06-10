/**
 * @module schemas/domain
 * Zod schemas for domain API responses: the alias-creation domains list and the
 * user's custom domains (settings, mailboxes, and per-domain trash).
 */
import { z } from 'zod';

/** A single domain usable for alias creation. */
export const DomainSchema = z.object({
  domain: z.string(),
  is_custom: z.boolean(),
});
export type Domain = z.infer<typeof DomainSchema>;

/** GET /api/v2/setting/domains response (a bare array). */
export const DomainListResponseSchema = z.array(DomainSchema);
export type DomainListResponse = z.infer<typeof DomainListResponseSchema>;

/** A custom domain as serialized by GET/PATCH /api/custom_domains. */
export const CustomDomainSchema = z.object({
  id: z.number().int(),
  domain_name: z.string(),
  is_verified: z.boolean(),
  nb_alias: z.number(),
  creation_date: z.string(),
  creation_timestamp: z.number(),
  catch_all: z.boolean(),
  name: z.string().nullable(),
  random_prefix_generation: z.boolean(),
  mailboxes: z.array(z.object({ id: z.number().int(), email: z.string() })),
});
export type CustomDomain = z.infer<typeof CustomDomainSchema>;

/** GET /api/custom_domains response. */
export const CustomDomainListResponseSchema = z.object({
  custom_domains: z.array(CustomDomainSchema),
});
export type CustomDomainListResponse = z.infer<typeof CustomDomainListResponseSchema>;

/** PATCH /api/custom_domains/:id response: the domain with the changes applied. */
export const CustomDomainUpdateResponseSchema = z.object({
  custom_domain: CustomDomainSchema,
});
export type CustomDomainUpdateResponse = z.infer<typeof CustomDomainUpdateResponseSchema>;

/** GET /api/custom_domains/:id/trash response: the domain's deleted aliases. */
export const CustomDomainTrashResponseSchema = z.object({
  aliases: z.array(
    z.object({
      alias: z.string(),
      deletion_timestamp: z.number(),
    }),
  ),
});
export type CustomDomainTrashResponse = z.infer<typeof CustomDomainTrashResponseSchema>;
