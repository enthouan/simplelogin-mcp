import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../src/tools/catalog.js';
import {
  buildSmokeEvidence,
  buildSmokeRecoveryRecord,
  cleanupSmokeArtifacts,
  createSmokeRunNaming,
  parseCliConfig,
  releaseSmokeRecoveryFile,
  reserveSmokeRecoveryFile,
  runSmokeCli,
  runSmokeTest,
  shouldStopSmokeTransportLoop,
  writeSmokeRecoveryFile,
  type SmokeArtifacts,
  type SmokeMcpClient,
  type SmokeRunNaming,
} from '../src/smoke/live.js';

const ALL_TOOLS = [...TOOL_NAMES];

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
    alias_list: (args) => ({
      aliases:
        args['query'] === runNaming.runId && aliasExists
          ? [{ id: 101, email: 'smoke@simplelogin.example', note: runNaming.aliasNote }]
          : [],
    }),
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
    expect(summary.toolDiscovery).toEqual({
      expected: 27,
      discovered: 27,
      exactMatch: true,
    });
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

  it('recovers and cleans up an alias when create fails after the alias exists', async () => {
    const runNaming = naming();
    let aliasExists = false;
    const client = new FakeSmokeClient(ALL_TOOLS, {
      account_get_info: () => ({ email: 'maintainer@example.com' }),
      alias_list: (args) => ({
        aliases:
          args['query'] === runNaming.runId && aliasExists
            ? [
                {
                  id: 101,
                  email: 'smoke@simplelogin.example',
                  note: runNaming.aliasNote,
                },
              ]
            : [],
      }),
      alias_create_random: () => {
        aliasExists = true;
        throw new Error('tool response validation failed after create');
      },
      alias_get: () => {
        if (!aliasExists) throw new Error('SimpleLogin API error (HTTP 404): not found');
        return { id: 101, email: 'smoke@simplelogin.example', note: runNaming.aliasNote };
      },
      alias_delete: () => {
        aliasExists = false;
        return { deleted: true };
      },
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('create temporary random alias');
    expect(summary.artifacts.alias?.id).toBe(101);
    expect(summary.cleanup.alias.status).toBe('succeeded');
    expect(client.calls.some((call) => call.name === 'alias_delete')).toBe(true);
  });

  it('does not create a random alias after the smoke run is aborted', async () => {
    const abortController = new AbortController();
    const client = makeSuccessfulClient();
    client.setHandler('alias_list', () => {
      abortController.abort();
      return { aliases: [] };
    });
    client.setHandler('alias_create_random', () => {
      throw new Error('alias_create_random should not be called after abort');
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
      abortSignal: abortController.signal,
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.message).toContain('interrupted');
    expect(summary.cleanup.alias.status).toBe('not_needed');
    expect(client.calls.some((call) => call.name === 'alias_create_random')).toBe(false);
  });

  it('does not delete a returned alias id until readback proves smoke ownership', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('alias_get', () => ({
      id: 101,
      email: 'personal@example.com',
      note: 'not created by this smoke run',
    }));
    client.setHandler('alias_list', () => ({ aliases: [] }));

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
      attemptContact: false,
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('read temporary alias');
    expect(summary.artifacts.alias).toBeUndefined();
    expect(summary.cleanup.alias.status).toBe('not_needed');
    expect(client.calls.some((call) => call.name === 'alias_delete')).toBe(false);
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
    const issueNotes = summary.failure?.suggestedIssueNotes.join('\n') ?? '';
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).not.toContain('sl-secret');
    expect(rendered).not.toContain('mcp-secret');
    expect(issueNotes).not.toContain(naming().runId);
    expect(issueNotes).not.toMatch(/(?:alias|contact)_id=/);
    expect(issueNotes).not.toContain('Error:');
    expect(issueNotes).toContain('keep run ids, artifact ids');
  });

  it('builds portable evidence without run ids, account data, artifact ids, or errors', async () => {
    const runNaming = naming();
    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(makeSuccessfulClient(runNaming)),
    });

    const evidence = buildSmokeEvidence(summary);
    const rendered = JSON.stringify(evidence);

    expect(evidence.ok).toBe(true);
    expect(evidence.toolDiscovery).toEqual({ expected: 27, discovered: 27, exactMatch: true });
    expect(evidence.contact).toEqual({ attempted: true, skipped: false });
    expect(evidence.cleanup).toEqual({
      overall: 'succeeded',
      alias: { status: 'succeeded', attempted: true },
      contact: { status: 'succeeded', attempted: true },
    });
    expect(rendered).not.toContain(runNaming.runId);
    expect(rendered).not.toContain('smoke@simplelogin.example');
    expect(rendered).not.toContain('maintainer@example.com');
    expect(rendered).not.toMatch(/"(?:id|artifacts|message|note|reason|suggestedIssueNotes)"/);
  });

  it('builds a minimal private recovery record without addresses, contacts, or errors', async () => {
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);
    client.setHandler('alias_delete', () => {
      throw new Error('private upstream detail');
    });
    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
      attemptContact: false,
    });

    const recovery = buildSmokeRecoveryRecord(summary);
    const rendered = JSON.stringify(recovery);

    expect(recovery).toEqual({
      transport: 'stdio',
      runId: runNaming.runId,
      artifacts: { aliasId: 101 },
      cleanup: {
        overall: 'failed',
        alias: 'delete_failed',
        contact: 'not_needed',
      },
    });
    expect(rendered).not.toContain('smoke@simplelogin.example');
    expect(rendered).not.toContain(runNaming.contact);
    expect(rendered).not.toContain('private upstream detail');

    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const recoveryPath = join(recoveryDirectory, 'recovery.json');
    try {
      const reservation = reserveSmokeRecoveryFile(recoveryPath);
      expect(() => reserveSmokeRecoveryFile(recoveryPath)).toThrow();
      expect(statSync(recoveryPath).mode & 0o777).toBe(0o600);
      expect(writeSmokeRecoveryFile(reservation, [summary])).toBe(true);
      releaseSmokeRecoveryFile(reservation, true);
      expect(readFileSync(recoveryPath, 'utf8')).toContain(runNaming.runId);
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('removes a reserved private recovery file when the smoke succeeds', async () => {
    const runNaming = naming();
    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(makeSuccessfulClient(runNaming)),
    });
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const recoveryPath = join(recoveryDirectory, 'recovery.json');
    try {
      const reservation = reserveSmokeRecoveryFile(recoveryPath);
      expect(writeSmokeRecoveryFile(reservation, [summary])).toBe(false);
      releaseSmokeRecoveryFile(reservation, false);
      expect(existsSync(recoveryPath)).toBe(false);
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects existing and symlink recovery paths without overwriting their targets', () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const existingPath = join(recoveryDirectory, 'existing.json');
    const symlinkPath = join(recoveryDirectory, 'symlink.json');
    try {
      writeFileSync(existingPath, 'owner data', 'utf8');
      symlinkSync(existingPath, symlinkPath);

      expect(() => reserveSmokeRecoveryFile(existingPath)).toThrow();
      expect(() => reserveSmokeRecoveryFile(symlinkPath)).toThrow();
      expect(readFileSync(existingPath, 'utf8')).toBe('owner data');
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('aborts recovery preflight before creating an MCP client', async () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const existingPath = join(recoveryDirectory, 'existing.json');
    writeFileSync(existingPath, 'owner data', 'utf8');
    let clientFactoryCalls = 0;
    const stderr: string[] = [];
    try {
      const exitCode = await runSmokeCli({
        argv: ['--transport', 'stdio'],
        env: {
          SL_API_KEY: 'private-api-key',
          SMOKE_PRIVATE_RECOVERY_FILE: existingPath,
        },
        cwd: recoveryDirectory,
        clientFactory: () => {
          clientFactoryCalls++;
          return Promise.resolve(makeSuccessfulClient());
        },
        signalHandlerInstaller: () => () => undefined,
        writeStdout: () => undefined,
        writeStderr: (output) => stderr.push(output),
      });

      expect(exitCode).toBe(1);
      expect(clientFactoryCalls).toBe(0);
      expect(readFileSync(existingPath, 'utf8')).toBe('owner data');
      expect(stderr.join('')).not.toContain('private-api-key');
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('aborts an invalid recovery parent before creating an MCP client', async () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    let clientFactoryCalls = 0;
    try {
      const exitCode = await runSmokeCli({
        argv: ['--transport', 'stdio'],
        env: {
          SL_API_KEY: 'private-api-key',
          SMOKE_PRIVATE_RECOVERY_FILE: join(recoveryDirectory, 'missing', 'recovery.json'),
        },
        cwd: recoveryDirectory,
        clientFactory: () => {
          clientFactoryCalls++;
          return Promise.resolve(makeSuccessfulClient());
        },
        signalHandlerInstaller: () => () => undefined,
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });

      expect(exitCode).toBe(1);
      expect(clientFactoryCalls).toBe(0);
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('removes the preflight reservation after a successful CLI smoke', async () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const recoveryPath = join(recoveryDirectory, 'recovery.json');
    const runNaming = naming();
    try {
      const exitCode = await runSmokeCli({
        argv: ['--transport', 'stdio'],
        env: {
          SL_API_KEY: 'private-api-key',
          SMOKE_CONTACT: 'skip',
          SMOKE_PRIVATE_RECOVERY_FILE: recoveryPath,
        },
        cwd: recoveryDirectory,
        clientFactory: () => Promise.resolve(makeSuccessfulClient(runNaming)),
        namingFactory: () => runNaming,
        signalHandlerInstaller: () => () => undefined,
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });

      expect(exitCode).toBe(0);
      expect(existsSync(recoveryPath)).toBe(false);
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('prints sanitized evidence and exits nonzero when a late recovery write fails', async () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const recoveryPath = join(recoveryDirectory, 'recovery.json');
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);
    client.setHandler('alias_delete', () => {
      throw new Error('private-api-key late cleanup detail');
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = await runSmokeCli({
        argv: ['--transport', 'stdio'],
        env: {
          SL_API_KEY: 'private-api-key',
          SMOKE_CONTACT: 'skip',
          SMOKE_PRIVATE_RECOVERY_FILE: recoveryPath,
        },
        cwd: recoveryDirectory,
        clientFactory: () => Promise.resolve(client),
        namingFactory: () => runNaming,
        signalHandlerInstaller: () => () => undefined,
        recoveryFileOperations: {
          write: () => {
            throw new Error('private write implementation detail');
          },
        },
        writeStdout: (output) => stdout.push(output),
        writeStderr: (output) => stderr.push(output),
      });

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout.join(''))).toMatchObject({
        ok: false,
        summaries: [{ transport: 'stdio', cleanup: { overall: 'failed' } }],
      });
      expect(stdout.join('')).not.toContain('private-api-key');
      expect(stdout.join('')).not.toContain(runNaming.runId);
      expect(stderr.join('')).toContain('Private recovery record could not be completed');
      expect(stderr.join('')).not.toContain('private write implementation detail');
      expect(stderr.join('')).not.toContain('private-api-key');
      expect(existsSync(recoveryPath)).toBe(true);
      expect(statSync(recoveryPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  });

  it('shares one recovery reservation and retains only failed transport summaries', async () => {
    const recoveryDirectory = mkdtempSync(join(tmpdir(), 'simplelogin-mcp-smoke-'));
    const recoveryPath = join(recoveryDirectory, 'recovery.json');
    const runNaming = naming();
    const stdioClient = makeSuccessfulClient(runNaming);
    const httpClient = makeSuccessfulClient(runNaming);
    httpClient.setHandler('account_get_info', () => {
      throw new Error('HTTP read failed');
    });
    let reservationCount = 0;
    try {
      const exitCode = await runSmokeCli({
        argv: ['--transport', 'all'],
        env: {
          SL_API_KEY: 'private-api-key',
          SMOKE_CONTACT: 'skip',
          SMOKE_PRIVATE_RECOVERY_FILE: recoveryPath,
        },
        cwd: recoveryDirectory,
        clientFactory: (transport) =>
          Promise.resolve(transport === 'stdio' ? stdioClient : httpClient),
        namingFactory: () => runNaming,
        signalHandlerInstaller: () => () => undefined,
        recoveryFileOperations: {
          reserve: (filePath) => {
            reservationCount++;
            return reserveSmokeRecoveryFile(filePath);
          },
        },
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });

      const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8')) as {
        summaries: { transport: string }[];
      };
      expect(exitCode).toBe(1);
      expect(reservationCount).toBe(1);
      expect(recovery.summaries).toHaveLength(1);
      expect(recovery.summaries[0]?.transport).toBe('http');
    } finally {
      rmSync(recoveryDirectory, { recursive: true, force: true });
    }
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

  it('fails generic contact availability outages instead of skipping them', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('contact_create', () => {
      throw new Error('SimpleLogin API error (HTTP 503): contact service is not available');
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.contact.skipped).toBe(false);
    expect(summary.failure?.step).toBe('create temporary contact');
    expect(summary.failure?.message).toContain('not available');
    expect(summary.cleanup.alias.status).toBe('succeeded');
  });

  it('recovers and cleans up a contact when create fails after the contact exists', async () => {
    const runNaming = naming();
    const client = makeSuccessfulClient(runNaming);
    let contactExists = false;
    client.setHandler('contact_create', () => {
      contactExists = true;
      throw new Error('tool response validation failed after contact create');
    });
    client.setHandler('contact_list', () => ({
      contacts: contactExists ? [{ id: 202, contact: runNaming.contact }] : [],
    }));
    client.setHandler('contact_delete', () => {
      contactExists = false;
      return { deleted: true };
    });

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: runNaming,
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('create temporary contact');
    expect(summary.artifacts.contact?.id).toBe(202);
    expect(summary.cleanup.contact.status).toBe('succeeded');
    expect(client.calls.some((call) => call.name === 'contact_delete')).toBe(true);
  });

  it('does not delete a returned contact id until readback proves smoke ownership', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('contact_list', () => ({
      contacts: [{ id: 202, contact: 'Personal <personal@example.com>' }],
    }));

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('read temporary contact');
    expect(summary.artifacts.contact).toBeUndefined();
    expect(summary.cleanup.contact.status).toBe('not_needed');
    expect(client.calls.some((call) => call.name === 'contact_delete')).toBe(false);
    expect(summary.cleanup.alias.status).toBe('succeeded');
  });

  it('fails when the discovered tool catalog is incomplete', async () => {
    const client = makeSuccessfulClient();
    const toolsWithoutContacts = ALL_TOOLS.filter((tool) => !tool.startsWith('contact_'));
    const missingContactClient = new FakeSmokeClient(toolsWithoutContacts, client.handlers);

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(missingContactClient),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('list MCP tools');
    expect(summary.failure?.message).toContain('27-tool public contract');
    expect(summary.toolDiscovery).toEqual({
      expected: 27,
      discovered: toolsWithoutContacts.length,
      exactMatch: false,
    });
    expect(summary.cleanup.alias.status).toBe('not_needed');
  });

  it('fails when a unique smoke contact already exists', async () => {
    const client = makeSuccessfulClient();
    client.setHandler('contact_create', () => ({
      id: 202,
      contact: naming().contact,
      existed: true,
    }));

    const summary = await runSmokeTest({
      transport: 'stdio',
      naming: naming(),
      clientFactory: () => Promise.resolve(client),
    });

    expect(summary.ok).toBe(false);
    expect(summary.failure?.step).toBe('create temporary contact');
    expect(summary.failure?.message).toContain('existing contact');
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

  it('stops the CLI transport loop after cleanup failure or a signal', () => {
    expect(shouldStopSmokeTransportLoop({ cleanup: { overall: 'failed' } })).toBe(true);
    expect(shouldStopSmokeTransportLoop({ cleanup: { overall: 'succeeded' } })).toBe(false);
    expect(shouldStopSmokeTransportLoop({ cleanup: { overall: 'not_needed' } }, 'SIGTERM')).toBe(
      true,
    );
  });

  it('allows HTTP-only config without a local SimpleLogin API key', () => {
    const config = parseCliConfig(['--transport', 'http'], {
      MCP_AUTH_TOKEN: 'mcp-secret',
      SMOKE_PRIVATE_RECOVERY_FILE: '/private/recovery.json',
    });

    expect(config.transports).toEqual(['http']);
    expect(config.apiKey).toBeUndefined();
    expect(config.serverEnv).toEqual({});
    expect(config.secrets).toEqual(['mcp-secret']);
    expect(config.privateRecoveryFile).toBe('/private/recovery.json');
  });

  it('still requires a SimpleLogin API key when stdio is selected', () => {
    expect(() => parseCliConfig(['--transport', 'stdio'], {})).toThrow(
      'SL_API_KEY is required for the live SimpleLogin smoke test',
    );
  });
});
