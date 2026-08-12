import { TOOL_CATALOG, loadRegisteredToolMetadata } from '../../../src/tools/catalog.js';

const metadataByName = await loadRegisteredToolMetadata();

export const TOOL_CATALOG_WITH_INPUTS = TOOL_CATALOG.map((tool) => ({
  ...tool,
  ...metadataByName.get(tool.name)!,
}));

export const CATEGORY_DETAILS = {
  aliases: {
    label: 'Aliases',
    description: 'Find, create, tune, audit, pause, and safely remove aliases.',
    example: 'List my disabled aliases and include their notes. Do not make any changes.',
  },
  contacts: {
    label: 'Contacts',
    description: 'Create reverse aliases and control who can forward mail.',
    example: 'For alias ID 42, list its contacts and show which ones are blocked.',
  },
  mailboxes: {
    label: 'Mailboxes',
    description: 'Manage verified destinations, defaults, and explicit transfers.',
    example: 'List my mailboxes and identify which verified mailbox is the default.',
  },
  custom_domains: {
    label: 'Custom domains',
    description: 'Inspect domains, update routing, and review deleted-alias trash.',
    example: 'List my custom domains and summarize their settings. Do not make any changes.',
  },
  account: {
    label: 'Account',
    description: 'Check account details, stats, notifications, and alias settings.',
    example: 'Show my lifetime alias, forwarded, replied, and blocked email totals.',
  },
} as const satisfies Record<
  (typeof TOOL_CATALOG)[number]['category'],
  { label: string; description: string; example: string }
>;

export const CATEGORY_ENTRIES = Object.entries(CATEGORY_DETAILS).map(([category, details]) => ({
  category: category as keyof typeof CATEGORY_DETAILS,
  ...details,
  tools: TOOL_CATALOG_WITH_INPUTS.filter((tool) => tool.category === category),
}));
