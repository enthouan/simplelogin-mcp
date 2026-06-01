/**
 * Zod schemas for SimpleLogin account information APIs.
 */
import { z } from "zod";

export const userInfoSchema = z
  .object({
    name: z.string(),
    is_premium: z.boolean(),
    email: z.string(),
    in_trial: z.boolean().optional(),
    trial_end_timestamp: z.number().int().nullable().optional(),
    profile_picture_url: z.string().nullable().optional(),
    max_alias_free_plan: z.number().int().optional(),
  })
  .passthrough();
