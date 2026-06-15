import { describe, expect, it } from 'vitest';
import {
  cleanupSmokeArtifacts,
  createSmokeRunNaming,
  runSmokeTest,
  type SmokeArtifacts,
  type SmokeMcpClient,
  type SmokeRunNaming,
} from '../src/smoke/live.js';

const ALL_TOOLS = [
  'account_get_info',
  'alias_list',
  'alias_create_random',
  'alias_get',
  'alias_delete',
  'contact_create',
  'contact_list',
  'contact_delete',
];

class FakeSmokeClient implements SmokeMcpClient {
  readonly calls: { name: string; args?: Record<string, unknown> }[] = [];
  closed = false;

  constructor(
    private readonly tools: string[],
    readonly handlers: Record<
      string,
      (args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
    >,
  ) {}

  listTools(): Promise<string[]> {
    this.calls.push({ name: 'listTools' });
    return Promise.resolve(this.tools);
  }

  async callTool<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    this.calls.push({ name, args });
    const handler = this.handlers[name];
    if (!handler) throw new Error(`unexpected tool call ${name}`);
    return (await handler(args)) as T;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  setHandler(
    name: string,
    handler: (
      args: Record<string, unknown>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): void {
    this.handlers[name] = handler;
  }
}

function naming(): SmokeRunNaming {
  return createSmokeRunNaming(new Date('2026-06-15T12:00:00.000Z'), 'abcdef12');
}

function makeSuccessfulClient(runNaming = naming()): FakeSmokeClient {
  let aliasExists = false;
  let contactExists = false;

  return new FakeSmokeClient(ALL_TOOLS, {
    account_get_info: () => ({ email: 'maintainer@example.com' }),
    alias_list: () => ({ aliases: [] }),
    alias_create_random: (args) => {
      expect(args['note']).toBe(runNaming.aliasNote);
      expect(args['hostname']).toBe(runNaming.hostname);
      aliasExists = true;
      return { id: 101, email: 'smoke@simplelogin.example', note: runNaming.aliasNote };
    },
    alias_get: () => {
      if (!aliasExists) throw new Error('SimpleLogin API error (HTTP 404): not found');
      return { id: 101, email: 'smoke@simplelogin.example', note: runNaming.aliasNote };
    },
    contact_create: (args) => {
      expect(args['alias_id']).toBe(101);
      expect(args['contact']).toBe(runNaming.contact);
      contactExists = true;
      return { id: 202, contact: runNaming.contact, existed: false };
    },
    contact_list: () => ({
      contacts: contactExists ? [{ id: 202, contact: runNaming.contact }] : [],
    }),
    contact_delete: () => {
      contactExists = false;
      return { deleted: true };
    },
    alias_delete: () => {
      aliasExists = false;
      return { deleted: true };
    },
  });
}

describe('live smoke runner logic', () => {
  it('runs the happy path and verifies contact and alias cleanup', async () => {
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(true);
    expect(summary.cleanup.contact.status).toBe('succeeded');
    expect(summary.cleanup.alias.status).toBe('succeeded');
    expect(summary.artifacts.alias?.id).toBe(101);
    expect(summary.artifacts.contact?.id).toBe(202);
    expect(client.closed).toBe(true);
    expect(client.calls.map((call) => call.name)).toEqual([
      'listTools',
      'account_get_info',
      'alias_list',
      'alias_create_random',
      'alias_get',
      'contact_create',
      'contact_list',
      'contact_delete',
      'contact_list',
      'alias_delete',
      'alias_get',
    ]);
  });

  it('cleans up when a later smoke step fails', async () => {
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);
    let aliasReadCount = 0;
    client.setHandler('alias_get', () => {
      aliasReadCount++;
      if (aliasReadCount === 1) throw new Error('readback failed');
      throw new Error('SimpleLogin API error (HTTP 404): not found');
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('read temporary alias');
    expect(summary.cleanup.alias.status).toBe('succeeded');
    expect(client.calls.some((call) => call.name === 'alias_delete')).toBe(true);
  });

  it('reports cleanup delete failures separately', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('alias_delete', () => {
      throw new Error('delete failed');
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
      attemptContact: false,
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('cleanup temporary artifacts');
    expect(summary.cleanup.alias.status).toBe('delete_failed');
    expect(summary.cleanup.alias.id).toBe(101);
  });

  it('reports cleanup verification failures separately', async () => {
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);
    client.setHandler('alias_delete', () => ({ deleted: true }));
    client.setHandler('alias_get', () => ({
      id: 101,
      email: 'smoke@simplelogin.example',
      note: runNaming.aliasNote,
    }));

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
      attemptContact: false,
    });

    expect(summary.ok).toBe(false);
    expect(summary.cleanup.alias.status).toBe('verification_failed');
    expect(summary.cleanup.alias.error).toContain('still readable');
  });

  it('redacts secrets from failure output and issue notes', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('account_get_info', () => {
      throw new Error('SL_API_KEY=sl-secret Authorization: Bearer mcp-secret');
    });

    const summary = await runSmokeTest({
      transport: 'http',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
      secrets: ['sl-secret', 'mcp-secret'],
    });

    const rendered = JSON.stringify(summary);
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).not.toContain('sl-secret');
    expect(rendered).not.toContain('mcp-secret');
  });

  it('uses unique, recognizable temporary names', () => {
    const first = createSmokeRunNaming(new Date('2026-06-15T12:00:00.000Z'), 'abcdef12');
    const second = createSmokeRunNaming(new Date('2026-06-15T12:00:00.000Z'), 'abcdef13');

    expect(first.runId).toMatch(/^slmcp-smoke-20260615T120000z-[a-f0-9]+$/);
    expect(second.runId).not.toBe(first.runId);
    expect(first.aliasNote).toContain(first.runId);
    expect(first.contact).toContain(first.runId);
    expect(first.hostname).toBe('simplelogin-mcp-smoke.invalid');
  });

  it('skips optional contact coverage for premium/API limitations', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('contact_create', () => {
      throw new Error('please upgrade to premium to create reverse aliases');
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(true);
    expect(summary.contact.skipped).toBe(true);
    expect(summary.contact.reason).toContain('premium');
    expect(client.calls.some((call) => call.name === 'contact_delete')).toBe(false);
    expect(summary.cleanup.alias.status).toBe('succeeded');
  });

  it('does not destructively clean up artifacts from another run', async () => {
    const calls: string[] = [];
    const client = new FakeSmokeClient(ALL_TOOLS, {
      alias_delete: () => {
        calls.push('alias_delete');
        return { deleted: true };
      },
      contact_delete: () => {
        calls.push('contact_delete');
        return { deleted: true };
      },
    });
    const artifacts: SmokeArtifacts = {
      alias: { id: 999, email: 'other@example.com', runId: 'other-run', createdByRun: true },
      contact: {
        id: 888,
        aliasId: 999,
        contact: 'Other <other@example.com>',
        runId: 'current-run',
        createdByRun: false,
      },
    };

    const cleanup = await cleanupSmokeArtifacts(client, artifacts, { runId: 'current-run' });

    expect(cleanup.alias.status).toBe('skipped_foreign_artifact');
    expect(cleanup.contact.status).toBe('skipped_foreign_artifact');
    expect(calls).toEqual([]);
  });
});
