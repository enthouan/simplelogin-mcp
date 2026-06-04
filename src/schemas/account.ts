/**
 * @module schemas/account
 * Zod schema for account/user-info responses.
 */
import { z } from 'zod';

/** GET /api/user_info response. */
export const UserInfoSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
  is_premium: z.boolean(),
  in_trial: z.boolean(),
  trial_end_timestamp: z.number().nullable().optional(),
  profile_picture_url: z.string().nullable().optional(),
  max_alias_free_plan: z.number().optional(),
});
export type UserInfo = z.infer<typeof UserInfoSchema>;
