/**
 * @module schemas/account
 * Zod schemas for account-level responses: user info, stats, notifications, and
 * the account-wide alias settings.
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

/** GET /api/stats response: account-wide counters. */
export const AccountStatsSchema = z.object({
  nb_alias: z.number(),
  nb_block: z.number(),
  nb_forward: z.number(),
  nb_reply: z.number(),
});
export type AccountStats = z.infer<typeof AccountStatsSchema>;

/** A single account notification. `message` is HTML; `created_at` is humanized text. */
export const NotificationSchema = z.object({
  id: z.number().int(),
  title: z.string().nullable(),
  message: z.string(),
  read: z.boolean(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** GET /api/notifications response. */
export const NotificationListResponseSchema = z.object({
  more: z.boolean(),
  notifications: z.array(NotificationSchema),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

/** POST /api/notifications/:id/read response. */
export const NotificationReadResponseSchema = z.object({ done: z.boolean() });
export type NotificationReadResponse = z.infer<typeof NotificationReadResponseSchema>;

/** Address style for randomly generated aliases. */
export const ALIAS_GENERATORS = ['word', 'uuid'] as const;
/** How the original sender appears in the From header of forwarded mail. */
export const SENDER_FORMATS = ['AT', 'A', 'NAME_ONLY', 'AT_ONLY', 'NO_NAME'] as const;
/** Suffix style appended to random and on-the-fly aliases. */
export const RANDOM_ALIAS_SUFFIXES = ['word', 'random_string'] as const;

/** GET/PATCH /api/setting response: the account-wide alias settings. */
export const SettingSchema = z.object({
  alias_generator: z.enum(ALIAS_GENERATORS),
  notification: z.boolean(),
  random_alias_default_domain: z.string(),
  sender_format: z.enum(SENDER_FORMATS),
  random_alias_suffix: z.enum(RANDOM_ALIAS_SUFFIXES),
});
export type Setting = z.infer<typeof SettingSchema>;
