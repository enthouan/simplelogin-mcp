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
} as const;

/** Per-alias resource path (GET / PATCH / DELETE). */
export const aliasPath = (aliasId: number): string => `/api/aliases/${aliasId}`;

/** Enable/disable toggle for a single alias (POST). */
export const aliasTogglePath = (aliasId: number): string => `/api/aliases/${aliasId}/toggle`;
