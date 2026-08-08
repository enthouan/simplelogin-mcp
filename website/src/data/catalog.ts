import { TOOL_CATALOG } from '../../../src/tools/catalog.js';

export const CATEGORY_DETAILS = {
  aliases: {
    label: 'Aliases',
    description: 'Find, create, tune, audit, pause, and safely remove aliases.',
  },
  contacts: {
    label: 'Contacts',
    description: 'Create reverse aliases and control who can forward mail.',
  },
  mailboxes: {
    label: 'Mailboxes',
    description: 'Manage verified destinations, defaults, and explicit transfers.',
  },
  custom_domains: {
    label: 'Custom domains',
    description: 'Inspect domains, update routing, and review deleted-alias trash.',
  },
  account: {
    label: 'Account',
    description: 'Check account details, stats, notifications, and alias settings.',
  },
} as const satisfies Record<
  (typeof TOOL_CATALOG)[number]['category'],
  { label: string; description: string }
>;

export const CATEGORY_ENTRIES = Object.entries(CATEGORY_DETAILS).map(([category, details]) => ({
  category: category as keyof typeof CATEGORY_DETAILS,
  ...details,
  tools: TOOL_CATALOG.filter((tool) => tool.category === category),
}));
