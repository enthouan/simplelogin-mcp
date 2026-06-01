/**
 * Centralized SimpleLogin API path constants and path builders.
 */
export const API_PATHS = {
  aliases: "/api/v2/aliases",
  alias: (id: number) => `/api/aliases/${id}`,
  aliasRandomNew: "/api/alias/random/new",
  aliasCustomNew: "/api/v3/alias/custom/new",
  aliasToggle: (id: number) => `/api/aliases/${id}/toggle`,
  aliasContacts: (id: number) => `/api/aliases/${id}/contacts`,
  aliasActivities: (id: number) => `/api/aliases/${id}/activities`,
  aliasOptions: "/api/v5/alias/options",
  aliasDomains: "/api/v2/setting/domains",
  mailboxes: "/api/mailboxes",
  mailboxCreate: "/api/mailboxes",
  mailbox: (id: number) => `/api/mailboxes/${id}`,
  customDomains: "/api/custom_domains",
  customDomain: (id: number) => `/api/custom_domains/${id}`,
  customDomainTrash: (id: number) => `/api/custom_domains/${id}/trash`,
  contact: (id: number) => `/api/contacts/${id}`,
  contactToggle: (id: number) => `/api/contacts/${id}/toggle`,
  userInfo: "/api/user_info",
  setting: "/api/setting",
  notifications: "/api/notifications",
  notification: (id: number) => `/api/notifications/${id}`,
  exportData: "/api/export/data",
  exportAliases: "/api/export/aliases",
} as const;
