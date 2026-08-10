/**
 * Public tool surface checks: registered names, annotations, schema field
 * descriptions, bounded reads, and documentation/catalog drift protection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimpleLoginClient } from '../src/client/simplelogin.js';
import {
  CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT,
  LIST_PAGE_SIZE,
  TOOL_CATALOG,
  TOOL_NAMES,
  loadToolInputArguments,
  loadRegisteredToolMetadata,
  renderToolCatalogMarkdown,
  type ToolAnnotations,
  type ToolName,
} from '../src/tools/catalog.js';
import { registerAllTools } from '../src/tools/index.js';

interface SchemaWithDescription {
  description?: string;
  safeParse(value: unknown): { success: boolean };
}

interface RegisteredToolOptions {
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  inputSchema?: Record<string, SchemaWithDescription>;
}

interface RegisteredTool {
  name: string;
  options: RegisteredToolOptions;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult;
}

function captureRegisteredTools(client: Record<string, unknown> = {}): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      options: RegisteredToolOptions,
      handler: RegisteredTool['handler'],
    ): void {
      tools.push({ name, options, handler });
    },
  };

  registerAllTools(server as unknown as McpServer, client as unknown as SimpleLoginClient);
  return tools;
}

function toolByName(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing registered tool ${name}`);
  return tool;
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function extractReadmeToolNames(markdown: string): string[] {
  const table = markdown.split('## Tools')[1]?.split('## Common workflows')[0] ?? '';
  return [...table.matchAll(/\| `([^`]+)`\s+\|/g)].map((match) => match[1]!);
}

describe('registered tool surface', () => {
  it('registers every expected stable tool name in order and no unexpected names', () => {
    const tools = captureRegisteredTools();

    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    for (const toolName of TOOL_NAMES) {
      expect(toolName).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    }
  });

  it('has useful titles, descriptions, complete schema descriptions, and catalog annotations', () => {
    const tools = captureRegisteredTools();

    for (const [index, tool] of tools.entries()) {
      const catalogEntry = TOOL_CATALOG[index]!;
      expect(tool.options.title?.trim(), `${tool.name} title`).toBeTruthy();
      expect(tool.options.description?.trim(), `${tool.name} description`).toBeTruthy();
      expect(tool.options.annotations).toEqual(catalogEntry.annotations);

      for (const [fieldName, schema] of Object.entries(tool.options.inputSchema ?? {})) {
        expect(schema.description?.trim(), `${tool.name}.${fieldName}`).toBeTruthy();
      }
    }
  });

  it('marks read-only, destructive, and idempotent mutation tools correctly', () => {
    const tools = captureRegisteredTools();
    const namesWith = (predicate: (annotations: ToolAnnotations) => boolean): string[] =>
      tools
        .filter((tool) => tool.options.annotations && predicate(tool.options.annotations))
        .map((tool) => tool.name);

    expect(namesWith((annotations) => annotations.readOnlyHint)).toEqual(
      TOOL_CATALOG.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name),
    );
    expect(namesWith((annotations) => annotations.destructiveHint)).toEqual([
      'alias_update',
      'alias_delete',
      'alias_set_enabled',
      'contact_set_blocked',
      'contact_delete',
      'mailbox_delete',
      'custom_domain_update',
    ]);
    expect(
      namesWith((annotations) => !annotations.readOnlyHint && annotations.idempotentHint),
    ).toEqual([
      'alias_update',
      'alias_set_enabled',
      'contact_set_blocked',
      'custom_domain_update',
      'notification_mark_read',
      'settings_update',
    ]);
  });

  it('derives public input summaries from the registered Zod schemas', async () => {
    const tools = captureRegisteredTools();
    const inputsByName = await loadToolInputArguments();

    expect([...inputsByName.keys()]).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      const expected = Object.entries(tool.options.inputSchema ?? {}).map(([name, schema]) => ({
        name,
        required: !schema.safeParse(undefined).success,
        description: schema.description?.trim(),
      }));
      expect(inputsByName.get(tool.name as ToolName), tool.name).toEqual(expected);
    }
  });

  it('derives public usage details from the registered tool descriptions', async () => {
    const tools = captureRegisteredTools();
    const metadataByName = await loadRegisteredToolMetadata();

    expect([...metadataByName.keys()]).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(metadataByName.get(tool.name as ToolName)?.description, tool.name).toBe(
        tool.options.description?.trim(),
      );
    }
  });
});

describe('paginated and bounded reads', () => {
  it('documents page_id, page size, and default page for server-paginated tools', () => {
    const tools = captureRegisteredTools();

    for (const toolName of [
      'alias_list',
      'alias_activity_list',
      'contact_list',
      'notification_list',
    ]) {
      const tool = toolByName(tools, toolName);
      const pageSchema = tool.options.inputSchema?.['page_id'];
      expect(pageSchema, `${toolName}.page_id`).toBeTruthy();
      expect(pageSchema?.description, `${toolName}.page_id description`).toContain('Defaults to 0');
      expect(pageSchema?.description, `${toolName}.page_id description`).toContain(
        `${LIST_PAGE_SIZE}`,
      );
      expect(tool.options.description, `${toolName} description`).toContain('page_id');
      expect(tool.options.description, `${toolName} description`).toContain(`${LIST_PAGE_SIZE}`);
    }
  });

  it('documents page_id, limit, and bounds for the locally paged trash tool', () => {
    const tool = toolByName(captureRegisteredTools(), 'custom_domain_trash_list');

    const pageSchema = tool.options.inputSchema?.['page_id'];
    expect(pageSchema, 'custom_domain_trash_list.page_id').toBeTruthy();
    expect(pageSchema?.description).toContain('defaults to 0');

    const limitSchema = tool.options.inputSchema?.['limit'];
    expect(limitSchema, 'custom_domain_trash_list.limit').toBeTruthy();
    expect(limitSchema?.description).toContain(`${CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT}`);

    expect(tool.options.description).toContain('page_id');
    expect(tool.options.description).toContain('limit');
    expect(tool.options.description).toContain('max');
  });

  it('defaults paginated handlers to page 0', async () => {
    const calls: Record<string, unknown[]> = {};
    const trashCalls: number[] = [];
    const tools = captureRegisteredTools({
      listAliases: (params: unknown) => {
        calls['alias_list'] = [params];
        return Promise.resolve({ aliases: [] });
      },
      listAliasActivities: (params: unknown) => {
        calls['alias_activity_list'] = [params];
        return Promise.resolve({ activities: [] });
      },
      listAliasContacts: (params: unknown) => {
        calls['contact_list'] = [params];
        return Promise.resolve({ contacts: [] });
      },
      listNotifications: (params: unknown) => {
        calls['notification_list'] = [params];
        return Promise.resolve({ more: false, notifications: [] });
      },
    });

    await toolByName(tools, 'alias_list').handler({});
    await toolByName(tools, 'alias_activity_list').handler({ alias_id: 7 });
    await toolByName(tools, 'contact_list').handler({ alias_id: 7 });
    await toolByName(tools, 'notification_list').handler({});
    await toolByName(
      captureRegisteredTools({
        getCustomDomainTrash: (customDomainId: number) => {
          trashCalls.push(customDomainId);
          return Promise.resolve({ aliases: [] });
        },
      }),
      'custom_domain_trash_list',
    ).handler({ custom_domain_id: 3 });

    expect(calls['alias_list']).toEqual([{ pageId: 0, filter: undefined, query: undefined }]);
    expect(calls['alias_activity_list']).toEqual([{ aliasId: 7, pageId: 0 }]);
    expect(calls['contact_list']).toEqual([{ aliasId: 7, pageId: 0 }]);
    expect(calls['notification_list']).toEqual([{ pageId: 0 }]);
    expect(trashCalls).toEqual([3]);
  });

  it('caps the unpaginated custom-domain trash result by default', async () => {
    const aliases = Array.from({ length: CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT + 5 }, (_, index) => ({
      alias: `deleted-${index}@example.com`,
      deletion_timestamp: index,
    }));
    const tools = captureRegisteredTools({
      getCustomDomainTrash: (customDomainId: number) => {
        expect(customDomainId).toBe(3);
        return Promise.resolve({ aliases });
      },
    });

    const result = await toolByName(tools, 'custom_domain_trash_list').handler({
      custom_domain_id: 3,
    });
    const payload = JSON.parse(textOf(result)) as {
      aliases: unknown[];
      page_id: number;
      limit: number;
      returned: number;
      total: number;
      more: boolean;
    };

    expect(payload.aliases).toHaveLength(CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT);
    expect(payload.page_id).toBe(0);
    expect(payload.limit).toBe(CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT);
    expect(payload.returned).toBe(CUSTOM_DOMAIN_TRASH_DEFAULT_LIMIT);
    expect(payload.total).toBe(aliases.length);
    expect(payload.more).toBe(true);
  });

  it('honors an explicit smaller custom-domain trash limit and page', async () => {
    const aliases = [
      { alias: 'first@example.com', deletion_timestamp: 1 },
      { alias: 'second@example.com', deletion_timestamp: 2 },
      { alias: 'third@example.com', deletion_timestamp: 3 },
    ];
    const tools = captureRegisteredTools({
      getCustomDomainTrash: () => Promise.resolve({ aliases }),
    });

    const result = await toolByName(tools, 'custom_domain_trash_list').handler({
      custom_domain_id: 3,
      page_id: 1,
      limit: 2,
    });
    const payload = JSON.parse(textOf(result)) as {
      aliases: typeof aliases;
      page_id: number;
      limit: number;
      returned: number;
      total: number;
      more: boolean;
    };

    expect(payload.aliases).toEqual(aliases.slice(2, 4));
    expect(payload.page_id).toBe(1);
    expect(payload.limit).toBe(2);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.more).toBe(false);
  });
});

describe('public docs coverage', () => {
  it('keeps the README tool table in registered-tool order', () => {
    expect(extractReadmeToolNames(readRepoFile('README.md'))).toEqual(TOOL_NAMES);
  });

  it('keeps the generated tool catalog deterministic and in sync', async () => {
    const rendered = await renderToolCatalogMarkdown();
    expect(await renderToolCatalogMarkdown()).toBe(rendered);

    const formatted = await prettier.format(rendered, { parser: 'markdown' });
    expect(readRepoFile('TOOL_CATALOG.md')).toBe(formatted);
  });
});
