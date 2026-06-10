/**
 * @module constants
 * Single source of truth for every SimpleLogin API path used by the client.
 * Adding an endpoint starts here; nothing else in the codebase hardcodes a path.
 */

/** Static API paths (no path parameters). */
export const API_PATHS = {
  /** GET — current user info; doubles as an API-key validity check. */
  userInfo: '/api/user_info',
  /** GET — alias creation options (can_create, suffixes, prefix suggestion). */
  aliasOptions: '/api/v5/alias/options',
  /** POST — create a custom alias from a chosen prefix + signed suffix. */
  aliasCustomNew: '/api/v3/alias/custom/new',
  /** POST — create a random alias. */
  aliasRandomNew: '/api/alias/random/new',
  /** GET (or POST when searching) — paginated alias list with optional filter. */
  aliases: '/api/v2/aliases',
  /** GET — domains usable for alias creation. */
  settingDomains: '/api/v2/setting/domains',
  /** GET — user mailboxes (verified and unverified). */
  mailboxes: '/api/v2/mailboxes',
  /** POST — create a new mailbox (sends a verification email to the address). */
  mailboxCreate: '/api/mailboxes',
  /** GET — the user's custom domains with their settings and mailboxes. */
  customDomains: '/api/custom_domains',
  /** GET: account-wide alias/forward/reply/block counters. */
  stats: '/api/stats',
  /** GET: paginated account notifications. Pages via `page` (not `page_id`). */
  notifications: '/api/notifications',
  /** GET to read / PATCH to update the account-wide alias settings. */
  setting: '/api/setting',
} as const;

/**
 * Mark a single notification as read (POST). The in-app api.md documents this
 * as POST /api/notifications/:id, but the Flask view registers the `/read`
 * suffix; the source is the truth.
 */
export const notificationReadPath = (notificationId: number): string =>
  `/api/notifications/${notificationId}/read`;

/** Per-custom-domain resource path (PATCH). */
export const customDomainPath = (customDomainId: number): string =>
  `/api/custom_domains/${customDomainId}`;

/** Deleted aliases (trash) of a single custom domain (GET). */
export const customDomainTrashPath = (customDomainId: number): string =>
  `/api/custom_domains/${customDomainId}/trash`;

/** Per-mailbox resource path (PUT / DELETE). */
export const mailboxPath = (mailboxId: number): string => `/api/mailboxes/${mailboxId}`;

/** Per-alias resource path (GET / PATCH / DELETE). */
export const aliasPath = (aliasId: number): string => `/api/aliases/${aliasId}`;

/** Enable/disable toggle for a single alias (POST). */
export const aliasTogglePath = (aliasId: number): string => `/api/aliases/${aliasId}/toggle`;

/** Paginated forward/reply/block activity log for a single alias (GET). */
export const aliasActivitiesPath = (aliasId: number): string =>
  `/api/aliases/${aliasId}/activities`;

/** An alias's contacts (reverse aliases): GET to list (paginated), POST to create. */
export const aliasContactsPath = (aliasId: number): string => `/api/aliases/${aliasId}/contacts`;

/** Block/unblock forwarding toggle for a single contact (POST). */
export const contactTogglePath = (contactId: number): string => `/api/contacts/${contactId}/toggle`;

/** Per-contact resource path (DELETE). */
export const contactPath = (contactId: number): string => `/api/contacts/${contactId}`;
