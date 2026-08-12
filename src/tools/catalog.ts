/**
 * @module tools/catalog
 * Public-facing metadata for the SimpleLogin MCP tool surface. Tool registration
 * uses the annotation profiles from here, and tests use the same catalog to
 * catch drift between registered tools and public docs.
 */

export const LIST_PAGE_SIZE = 20;
export const CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT = 100;
export const CUSTOM_DOMAIN_TRASH_MAX_LIMIT = 500;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  category: 'aliases' | 'contacts' | 'mailboxes' | 'custom_domains' | 'account';
  summary: string;
  annotations: ToolAnnotations;
  bounds: string;
  output: string;
}

export interface ToolInputArgument {
  name: string;
  required: boolean;
  description: string;
}

export interface RegisteredToolMetadata {
  description: string;
  inputs: readonly ToolInputArgument[];
}

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const IDEMPOTENT_UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const IDEMPOTENT_DESTRUCTIVE_UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const DELETE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const TOOL_CATALOG = [
  {
    name: 'alias_list',
    category: 'aliases',
    summary: 'List aliases with optional state and text filters.',
    annotations: READ_ONLY,
    bounds: `page_id, ${LIST_PAGE_SIZE} aliases per page`,
    output: '{ aliases }',
  },
  {
    name: 'alias_get',
    category: 'aliases',
    summary: 'Get full details for one alias by id.',
    annotations: READ_ONLY,
    bounds: 'single alias',
    output: 'alias object',
  },
  {
    name: 'alias_activity_list',
    category: 'aliases',
    summary: 'List forward, reply, block, and bounce activity for one alias.',
    annotations: READ_ONLY,
    bounds: `page_id, ${LIST_PAGE_SIZE} activity entries per page`,
    output: '{ activities }',
  },
  {
    name: 'alias_create_random',
    category: 'aliases',
    summary: 'Create a random alias using uuid, word, or account-default style.',
    annotations: CREATE,
    bounds: 'single alias mutation',
    output: 'created alias object',
  },
  {
    name: 'alias_create_custom',
    category: 'aliases',
    summary: 'Create a custom alias from a prefix, signed suffix, and mailboxes.',
    annotations: CREATE,
    bounds: 'single alias mutation',
    output: 'created alias object',
  },
  {
    name: 'alias_update',
    category: 'aliases',
    summary: 'Update alias note, name, mailboxes, PGP, or pinned state.',
    annotations: IDEMPOTENT_DESTRUCTIVE_UPDATE,
    bounds: 'single alias mutation',
    output: '{ ok: true }',
  },
  {
    name: 'alias_delete',
    category: 'aliases',
    summary: 'Permanently delete an alias after confirm=true.',
    annotations: DELETE,
    bounds: 'single irreversible deletion',
    output: '{ deleted }',
  },
  {
    name: 'alias_set_enabled',
    category: 'aliases',
    summary: 'Set an alias enabled or disabled without deleting it.',
    annotations: IDEMPOTENT_DESTRUCTIVE_UPDATE,
    bounds: 'single alias state mutation',
    output: '{ enabled }',
  },
  {
    name: 'alias_options_get',
    category: 'aliases',
    summary: 'Get custom-alias creation options and signed suffixes.',
    annotations: READ_ONLY,
    bounds: 'small account option set',
    output: '{ can_create, prefix_suggestion, suffixes, recommendation? }',
  },
  {
    name: 'alias_domains_list',
    category: 'aliases',
    summary: 'List domains usable for alias creation.',
    annotations: READ_ONLY,
    bounds: 'small account domain set',
    output: 'domain array',
  },
  {
    name: 'contact_list',
    category: 'contacts',
    summary: 'List contacts and reverse aliases for one alias.',
    annotations: READ_ONLY,
    bounds: `page_id, ${LIST_PAGE_SIZE} contacts per page`,
    output: '{ contacts }',
  },
  {
    name: 'contact_create',
    category: 'contacts',
    summary: 'Create or reuse a reverse alias for a recipient.',
    annotations: CREATE,
    bounds: 'single contact mutation',
    output: 'contact object or { existed: true }',
  },
  {
    name: 'contact_set_blocked',
    category: 'contacts',
    summary: 'Set whether forwarding from a contact is blocked.',
    annotations: IDEMPOTENT_DESTRUCTIVE_UPDATE,
    bounds: 'single contact state mutation',
    output: '{ block_forward }',
  },
  {
    name: 'contact_delete',
    category: 'contacts',
    summary: 'Permanently delete a contact after confirm=true.',
    annotations: DELETE,
    bounds: 'single irreversible deletion',
    output: '{ deleted }',
  },
  {
    name: 'mailbox_list',
    category: 'mailboxes',
    summary: 'List account mailboxes and verification/default state.',
    annotations: READ_ONLY,
    bounds: 'account mailbox set',
    output: '{ mailboxes }',
  },
  {
    name: 'mailbox_create',
    category: 'mailboxes',
    summary: 'Add a mailbox and send its verification email.',
    annotations: CREATE,
    bounds: 'single mailbox mutation',
    output: 'created mailbox object',
  },
  {
    name: 'mailbox_update',
    category: 'mailboxes',
    summary: 'Set a default mailbox, start an email change, or cancel one.',
    annotations: UPDATE,
    bounds: 'single mailbox mutation',
    output: '{ updated }',
  },
  {
    name: 'mailbox_delete',
    category: 'mailboxes',
    summary: 'Permanently delete a mailbox after explicit alias handling.',
    annotations: DELETE,
    bounds: 'single irreversible deletion',
    output: '{ deleted }',
  },
  {
    name: 'custom_domain_list',
    category: 'custom_domains',
    summary: 'List custom domains and their settings.',
    annotations: READ_ONLY,
    bounds: 'account custom-domain set',
    output: '{ custom_domains }',
  },
  {
    name: 'custom_domain_update',
    category: 'custom_domains',
    summary: 'Update supported custom-domain routing and display settings.',
    annotations: IDEMPOTENT_DESTRUCTIVE_UPDATE,
    bounds: 'single custom-domain mutation',
    output: '{ custom_domain }',
  },
  {
    name: 'custom_domain_trash_list',
    category: 'custom_domains',
    summary: 'List deleted aliases remembered for one custom domain.',
    annotations: READ_ONLY,
    bounds: `page_id and limit, defaults to page 0 and ${CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT} aliases per page, max ${CUSTOM_DOMAIN_TRASH_MAX_LIMIT}`,
    output: '{ aliases, page_id, limit, returned, total, more }',
  },
  {
    name: 'account_get_info',
    category: 'account',
    summary: 'Get user info and validate the configured API key.',
    annotations: READ_ONLY,
    bounds: 'single account object',
    output: 'user info object',
  },
  {
    name: 'account_get_stats',
    category: 'account',
    summary: 'Get lifetime account counters.',
    annotations: READ_ONLY,
    bounds: 'single stats object',
    output: 'stats object',
  },
  {
    name: 'notification_list',
    category: 'account',
    summary: 'List account notifications unread first.',
    annotations: READ_ONLY,
    bounds: `page_id, ${LIST_PAGE_SIZE} notifications per page`,
    output: '{ more, notifications }',
  },
  {
    name: 'notification_mark_read',
    category: 'account',
    summary: 'Mark one notification as read.',
    annotations: IDEMPOTENT_UPDATE,
    bounds: 'single notification mutation',
    output: '{ done }',
  },
  {
    name: 'settings_get',
    category: 'account',
    summary: 'Get account-wide alias settings.',
    annotations: READ_ONLY,
    bounds: 'single settings object',
    output: 'settings object',
  },
  {
    name: 'settings_update',
    category: 'account',
    summary: 'Update supported account-wide alias settings.',
    annotations: IDEMPOTENT_UPDATE,
    bounds: 'single settings mutation',
    output: 'updated settings object',
  },
] as const satisfies readonly ToolCatalogEntry[];

export type ToolName = (typeof TOOL_CATALOG)[number]['name'];

export const TOOL_NAMES = TOOL_CATALOG.map((tool) => tool.name);

export function getToolCatalogEntry(name: ToolName): (typeof TOOL_CATALOG)[number] {
  const entry = TOOL_CATALOG.find((tool) => tool.name === name);
  if (!entry) throw new Error(`Unknown tool catalog entry: ${name}`);
  return entry;
}

export function toolAnnotations(name: ToolName): ToolAnnotations {
  return { ...getToolCatalogEntry(name).annotations };
}

/**
 * Read public input metadata from the Zod schemas used by the registered tools.
 *
 * Tool modules already import this catalog for annotations, so registration is
 * loaded lazily to avoid an eager module cycle. Keeping the input metadata here
 * derived from registration means the website and generated Markdown cannot
 * silently drift from the schemas that MCP clients actually receive.
 */
export async function loadRegisteredToolMetadata(): Promise<
  ReadonlyMap<ToolName, RegisteredToolMetadata>
> {
  const { registerAllTools } = await import('./index.js');
  const metadataByName = new Map<string, RegisteredToolMetadata>();

  const server = {
    registerTool(
      name: string,
      options: {
        description?: string;
        inputSchema?: Record<
          string,
          {
            description?: string;
            safeParse(value: unknown): { success: boolean };
          }
        >;
      },
    ): void {
      if (metadataByName.has(name)) throw new Error(`Duplicate registered tool: ${name}`);

      const toolDescription = options.description?.trim();
      if (!toolDescription) throw new Error(`Missing registered tool description: ${name}`);

      const inputs = Object.entries(options.inputSchema ?? {}).map(([inputName, schema]) => {
        const description = schema.description?.trim();
        if (!description) throw new Error(`Missing input description: ${name}.${inputName}`);

        return {
          name: inputName,
          required: !schema.safeParse(undefined).success,
          description,
        };
      });
      metadataByName.set(name, { description: toolDescription, inputs });
    },
  };

  registerAllTools(
    server as unknown as Parameters<typeof registerAllTools>[0],
    {} as Parameters<typeof registerAllTools>[1],
  );

  const registeredNames = [...metadataByName.keys()];
  if (
    registeredNames.length !== TOOL_NAMES.length ||
    registeredNames.some((name, index) => name !== TOOL_NAMES[index])
  ) {
    throw new Error('Registered tools do not match the canonical tool catalog');
  }

  return new Map(
    TOOL_NAMES.map((name) => {
      const metadata = metadataByName.get(name);
      if (!metadata) throw new Error(`Missing registered tool metadata: ${name}`);
      return [name, metadata] as const;
    }),
  );
}

export async function loadToolInputArguments(): Promise<
  ReadonlyMap<ToolName, readonly ToolInputArgument[]>
> {
  const metadataByName = await loadRegisteredToolMetadata();
  return new Map(TOOL_NAMES.map((name) => [name, metadataByName.get(name)?.inputs ?? []] as const));
}

export async function renderToolCatalogMarkdown(): Promise<string> {
  const inputsByName = await loadToolInputArguments();
  const lines = [
    '# SimpleLogin MCP Tool Catalog',
    '',
    '<!-- Generated from src/tools/catalog.ts and the registered tool schemas. Do not edit this file directly. -->',
    '',
    'This is the public tool surface for `simplelogin-mcp`. Tool names are stable candidates for the 1.0 line.',
    '',
    'All tools interact with the configured SimpleLogin API, so their MCP `openWorldHint` is `true`. Read tools are marked read-only and idempotent. Permanent delete tools are marked destructive. State-setting updates such as mark-read and settings updates are marked idempotent. Mail-blocking or mail-routing state tools such as alias updates, enable/disable, block/unblock, and custom-domain routing updates are marked both idempotent and destructive.',
    '',
    '| Tool | Category | MCP annotations | Inputs | Bounds | Output |',
    '| ---- | -------- | --------------- | ------ | ------ | ------ |',
    ...TOOL_CATALOG.map(
      (tool) =>
        `| \`${tool.name}\` | ${tool.category} | ${formatAnnotations(tool.annotations)} | ${formatInputs(inputsByName.get(tool.name) ?? [])} | ${tool.bounds} | ${tool.output} |`,
    ),
    '',
  ];

  return lines.join('\n');
}

function formatInputs(inputs: readonly ToolInputArgument[]): string {
  if (inputs.length === 0) return 'none';

  const required = inputs.filter((input) => input.required).map((input) => input.name);
  const optional = inputs.filter((input) => !input.required).map((input) => input.name);
  return [
    required.length > 0 ? `required: ${required.join(', ')}` : undefined,
    optional.length > 0 ? `optional: ${optional.join(', ')}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join('; ');
}

export function renderDockerMcpToolsJson(): string {
  const tools = TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    description: tool.summary,
  }));

  return `${JSON.stringify(tools, null, 2)}\n`;
}

function formatAnnotations(annotations: ToolAnnotations): string {
  const flags = [
    annotations.readOnlyHint ? 'read-only' : 'write',
    annotations.destructiveHint ? 'destructive' : 'non-destructive',
    annotations.idempotentHint ? 'idempotent' : 'non-idempotent',
    annotations.openWorldHint ? 'open-world' : 'closed-world',
  ];
  return flags.join(', ');
}
