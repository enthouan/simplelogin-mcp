/**
 * @module schemas/domain
 * Zod schema for the alias-creation domains list.
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
