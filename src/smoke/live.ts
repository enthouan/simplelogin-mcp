/**
 * @module smoke/live
 * Manual live smoke runner for real SimpleLogin accounts. It exercises the MCP
 * server through SDK client transports, tracks only artifacts created by the
 * current run, and always attempts verified cleanup before reporting the result.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { redactSecrets } from '../logger.js';
import { VERSION } from '../version.js';

export type SmokeTransport = 'stdio' | 'http';
type SmokeTransportChoice = SmokeTransport | 'all';
type StepStatus = 'ok' | 'failed' | 'skipped';
type CleanupStatus =
  | 'not_needed'
  | 'skipped_foreign_artifact'
  | 'succeeded'
  | 'delete_failed'
  | 'verification_failed';

const REQUIRED_TOOLS = [
  'account_get_info',
  'alias_list',
  'alias_create_random',
  'alias_get',
  'alias_delete',
] as const;
const CONTACT_TOOLS = ['contact_create', 'contact_list', 'contact_delete'] as const;
const DEFAULT_MAX_LOOKUP_PAGES = 5;
const DEFAULT_STEP_TIMEOUT_MS = 60_000;
const LIST_PAGE_SIZE = 20;

export interface SmokeMcpClient {
  listTools(): Promise<string[]>;
  callTool<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  close(): Promise<void>;
}

export type SmokeClientFactory = (transport: SmokeTransport) => Promise<SmokeMcpClient>;

export interface SmokeRunNaming {
  runId: string;
  aliasNote: string;
  hostname: string;
  contact: string;
}

export interface SmokeArtifact {
  id: number;
  runId: string;
  createdByRun: boolean;
}

export interface SmokeAliasArtifact extends SmokeArtifact {
  email: string;
}

export interface SmokeContactArtifact extends SmokeArtifact {
  aliasId: number;
  contact: string;
}

export interface SmokeArtifacts {
  alias?: SmokeAliasArtifact;
  contact?: SmokeContactArtifact;
}

interface SmokeStep {
  step: string;
  status: StepStatus;
  tool?: string;
  note?: string;
}

interface CleanupRecord {
  status: CleanupStatus;
  attempted: boolean;
  id?: number;
  error?: string;
}

interface SmokeCleanupSummary {
  overall: 'not_needed' | 'succeeded' | 'failed';
  alias: CleanupRecord;
  contact: CleanupRecord;
}

interface SmokeFailure {
  step: string;
  tool?: string;
  message: string;
  suggestedIssueNotes: string[];
}

export interface SmokeRunSummary {
  ok: boolean;
  transport: SmokeTransport;
  runId: string;
  steps: SmokeStep[];
  artifacts: SmokeArtifacts;
  cleanup: SmokeCleanupSummary;
  contact: {
    attempted: boolean;
    skipped: boolean;
    reason?: string;
  };
  failure?: SmokeFailure;
}

export interface RunSmokeTestOptions {
  transport: SmokeTransport;
  clientFactory: SmokeClientFactory;
  naming?: SmokeRunNaming;
  attemptContact?: boolean;
  maxLookupPages?: number;
  secrets?: readonly string[];
  abortSignal?: AbortSignal;
}

interface CliConfig {
  transports: SmokeTransport[];
  attemptContact: boolean;
  httpUrl: string;
  cwd: string;
  serverPath: string;
  apiKey?: string;
  apiUrl?: string;
  mcpAuthToken?: string;
  stepTimeoutMs: number;
  maxLookupPages: number;
  serverEnv: Record<string, string>;
  secrets: string[];
}

class SmokeStepError extends Error {
  constructor(
    readonly step: string,
    readonly tool: string | undefined,
    cause: unknown,
    secrets: readonly string[],
  ) {
    super(redactSmokeText(errorMessage(cause), secrets));
    this.name = 'SmokeStepError';
  }
}

class SmokeToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = 'SmokeToolError';
  }
}

class SdkSmokeClient implements SmokeMcpClient {
  constructor(
    private readonly client: Client,
    private readonly stepTimeoutMs: number,
    private readonly secrets: readonly string[],
  ) {}

  async listTools(): Promise<string[]> {
    const result = await this.client.listTools(undefined, { timeout: this.stepTimeoutMs });
    return result.tools.map((tool) => tool.name);
  }

  async callTool<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: this.stepTimeoutMs,
    });
    return parseToolResult<T>(name, result, this.secrets);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createSmokeRunNaming(
  date = new Date(),
  randomHex = randomBytes(4).toString('hex'),
): SmokeRunNaming {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z');
  const safeRandom = randomHex
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '')
    .slice(0, 16);
  const runId = `slmcp-smoke-${timestamp}-${safeRandom}`;
  return {
    runId,
    aliasNote: `simplelogin-mcp live smoke test ${runId}; temporary alias; safe to delete`,
    hostname: 'simplelogin-mcp-smoke.invalid',
    contact: `SimpleLogin MCP Smoke ${runId} <${runId}@example.com>`,
  };
}

export async function runSmokeTest(options: RunSmokeTestOptions): Promise<SmokeRunSummary> {
  const secrets = options.secrets ?? [];
  const naming = options.naming ?? createSmokeRunNaming();
  const maxLookupPages = options.maxLookupPages ?? DEFAULT_MAX_LOOKUP_PAGES;
  const artifacts: SmokeArtifacts = {};
  const summary: SmokeRunSummary = {
    ok: false,
    transport: options.transport,
    runId: naming.runId,
    steps: [],
    artifacts,
    cleanup: emptyCleanupSummary(),
    contact: { attempted: options.attemptContact ?? true, skipped: false },
  };

  let client: SmokeMcpClient | undefined;

  try {
    client = await options.clientFactory(options.transport);

    const toolNames = await runStep(summary, 'list MCP tools', undefined, secrets, async () => {
      const names = await client!.listTools();
      assertRequiredTools(names);
      return names;
    });

    await runStep(summary, 'check account credentials', 'account_get_info', secrets, () =>
      client!.callTool('account_get_info'),
    );
    await runStep(summary, 'read first alias page', 'alias_list', secrets, () =>
      client!.callTool('alias_list', { page_id: 0 }),
    );

    const alias = await runStep(
      summary,
      'create temporary random alias',
      'alias_create_random',
      secrets,
      async () => {
        throwIfAborted(options.abortSignal);
        const createdAlias = await client!.callTool('alias_create_random', {
          mode: 'uuid',
          note: naming.aliasNote,
          hostname: naming.hostname,
        });
        requireInteger(createdAlias, 'id', 'alias_create_random');
        requireString(createdAlias, 'email', 'alias_create_random');
        return createdAlias;
      },
    );
    const aliasId = requireInteger(alias, 'id', 'alias_create_random');
    const aliasEmail = requireString(alias, 'email', 'alias_create_random');

    await runStep(summary, 'read temporary alias', 'alias_get', secrets, async () => {
      const readAlias = await client!.callTool('alias_get', { alias_id: aliasId });
      if (requireInteger(readAlias, 'id', 'alias_get') !== aliasId) {
        throw new Error(`alias_get returned a different id than the created alias ${aliasId}`);
      }
      if (readAlias['note'] !== naming.aliasNote) {
        throw new Error('alias_get returned an alias note that does not match this smoke run');
      }
      artifacts.alias = {
        id: aliasId,
        email: aliasEmail,
        runId: naming.runId,
        createdByRun: true,
      };
      return readAlias;
    });

    await maybeExerciseContact({
      client,
      summary,
      artifacts,
      naming,
      toolNames,
      maxLookupPages,
      secrets,
      abortSignal: options.abortSignal,
    });
  } catch (error) {
    summary.failure = normalizeFailure(error, summary, secrets);
  } finally {
    if (client) {
      if (!artifacts.alias && shouldAttemptAliasRecovery(summary.failure)) {
        await recoverAliasCreatedByFailedStep(client, artifacts, summary, {
          naming,
          maxLookupPages,
          secrets,
        });
      }
      if (artifacts.alias && !artifacts.contact && shouldAttemptContactRecovery(summary.failure)) {
        await recoverContactCreatedByFailedStep(client, artifacts, summary, {
          naming,
          maxLookupPages,
          secrets,
        });
      }
      summary.cleanup = await cleanupSmokeArtifacts(client, artifacts, {
        runId: naming.runId,
        maxLookupPages,
        secrets,
      });
      await client.close().catch((error: unknown) => {
        summary.failure ??= normalizeFailure(
          new SmokeStepError('close MCP client', undefined, error, secrets),
          summary,
          secrets,
        );
      });
    }
  }

  if (!summary.failure && summary.cleanup.overall === 'failed') {
    summary.failure = normalizeFailure(
      new SmokeStepError(
        'cleanup temporary artifacts',
        undefined,
        new Error('cleanup failed'),
        secrets,
      ),
      summary,
      secrets,
    );
  }

  summary.ok = !summary.failure && summary.cleanup.overall !== 'failed';
  if (summary.failure) {
    summary.failure.suggestedIssueNotes = buildSuggestedIssueNotes(summary, summary.failure);
  }
  return summary;
}

export async function cleanupSmokeArtifacts(
  client: SmokeMcpClient,
  artifacts: SmokeArtifacts,
  options: { runId: string; maxLookupPages?: number; secrets?: readonly string[] },
): Promise<SmokeCleanupSummary> {
  const maxLookupPages = options.maxLookupPages ?? DEFAULT_MAX_LOOKUP_PAGES;
  const secrets = options.secrets ?? [];
  const cleanup = emptyCleanupSummary();

  if (artifacts.contact) {
    cleanup.contact = await cleanupContact(client, artifacts.contact, {
      runId: options.runId,
      maxLookupPages,
      secrets,
    });
  }
  if (artifacts.alias) {
    cleanup.alias = await cleanupAlias(client, artifacts.alias, {
      runId: options.runId,
      secrets,
    });
  }

  cleanup.overall = summarizeCleanup(cleanup);
  return cleanup;
}

export function redactSmokeText(text: string, secrets: readonly string[] = []): string {
  return redactSecrets(text, secrets);
}

export function parseCliConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): CliConfig {
  const values = parseArgs(argv);
  const transportChoice = normalizeTransportChoice(
    values['transport'] ?? env['SMOKE_TRANSPORT'] ?? 'stdio',
  );
  const transports: SmokeTransport[] =
    transportChoice === 'all' ? ['stdio', 'http'] : [transportChoice];
  const apiKey = transports.includes('stdio')
    ? requireEnv(env, 'SL_API_KEY')
    : optionalEnv(env, 'SL_API_KEY');
  const apiUrl = optionalEnv(env, 'SL_API_URL');
  const mcpAuthToken = optionalEnv(env, 'MCP_AUTH_TOKEN');
  const stepTimeoutMs = parsePositiveInteger(
    values['timeout-ms'] ?? env['SMOKE_STEP_TIMEOUT_MS'] ?? `${DEFAULT_STEP_TIMEOUT_MS}`,
    'SMOKE_STEP_TIMEOUT_MS',
  );
  const maxLookupPages = parsePositiveInteger(
    values['max-lookup-pages'] ?? env['SMOKE_MAX_LOOKUP_PAGES'] ?? `${DEFAULT_MAX_LOOKUP_PAGES}`,
    'SMOKE_MAX_LOOKUP_PAGES',
  );
  const serverPath = path.resolve(
    cwd,
    values['stdio-server'] ?? env['SMOKE_STDIO_SERVER'] ?? path.join('dist', 'index.js'),
  );
  const httpUrl = values['http-url'] ?? env['SMOKE_HTTP_URL'] ?? 'http://127.0.0.1:3000/mcp';
  const attemptContact = parseContactSetting(values, env);
  const serverEnv = apiKey ? buildServerEnv(env, { apiKey, apiUrl }) : {};
  const secrets = [apiKey, mcpAuthToken].filter((value): value is string => Boolean(value));

  return {
    transports,
    attemptContact,
    httpUrl,
    cwd,
    serverPath,
    apiKey,
    apiUrl,
    mcpAuthToken,
    stepTimeoutMs,
    maxLookupPages,
    serverEnv,
    secrets,
  };
}

export async function connectMcpSmokeClient(
  transport: SmokeTransport,
  config: CliConfig,
): Promise<SmokeMcpClient> {
  const client = new Client({ name: 'simplelogin-mcp-live-smoke', version: VERSION });

  if (transport === 'stdio') {
    if (!existsSync(config.serverPath)) {
      throw new Error(
        `Built server not found at ${config.serverPath}. Run pnpm build before the live smoke test.`,
      );
    }
    const stdioTransport = new StdioClientTransport({
      command: process.execPath,
      args: [config.serverPath],
      cwd: config.cwd,
      env: config.serverEnv,
      stderr: 'pipe',
    });
    stdioTransport.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(redactSmokeText(chunk.toString('utf8'), config.secrets));
    });
    await client.connect(stdioTransport, { timeout: config.stepTimeoutMs });
    return new SdkSmokeClient(client, config.stepTimeoutMs, config.secrets);
  }

  const headers = config.mcpAuthToken
    ? { Authorization: `Bearer ${config.mcpAuthToken}` }
    : undefined;
  const httpTransport = new StreamableHTTPClientTransport(new URL(config.httpUrl), {
    requestInit: headers ? { headers } : undefined,
  });
  await client.connect(httpTransport, { timeout: config.stepTimeoutMs });
  return new SdkSmokeClient(client, config.stepTimeoutMs, config.secrets);
}

async function recoverAliasCreatedByFailedStep(
  client: SmokeMcpClient,
  artifacts: SmokeArtifacts,
  summary: SmokeRunSummary,
  options: { naming: SmokeRunNaming; maxLookupPages: number; secrets: readonly string[] },
): Promise<void> {
  const record = startStep(summary, 'recover temporary alias after failed create', 'alias_list');
  try {
    const alias = await findAliasByRunId(client, options.naming.runId, options.maxLookupPages);
    if (!alias) {
      record.status = 'skipped';
      record.note = 'no temporary alias found for this smoke run id';
      return;
    }

    const id = requireInteger(alias, 'id', 'alias_list');
    const email = requireString(alias, 'email', 'alias_list');
    artifacts.alias = {
      id,
      email,
      runId: options.naming.runId,
      createdByRun: true,
    };
    record.status = 'ok';
    record.note = `recovered alias ${id} for cleanup`;
  } catch (error) {
    record.status = 'failed';
    record.note = redactSmokeText(errorMessage(error), options.secrets);
  }
}

async function recoverContactCreatedByFailedStep(
  client: SmokeMcpClient,
  artifacts: SmokeArtifacts,
  summary: SmokeRunSummary,
  options: { naming: SmokeRunNaming; maxLookupPages: number; secrets: readonly string[] },
): Promise<void> {
  const alias = artifacts.alias;
  if (!alias) return;

  const record = startStep(
    summary,
    'recover temporary contact after failed create',
    'contact_list',
  );
  try {
    const contact = await findContactByRunId(
      client,
      alias.id,
      options.naming.runId,
      options.maxLookupPages,
    );
    if (!contact) {
      record.status = 'skipped';
      record.note = 'no temporary contact found for this smoke run id';
      return;
    }

    const id = requireInteger(contact, 'id', 'contact_list');
    artifacts.contact = {
      id,
      aliasId: alias.id,
      contact: stringifyContact(contact),
      runId: options.naming.runId,
      createdByRun: true,
    };
    record.status = 'ok';
    record.note = `recovered contact ${id} for cleanup`;
  } catch (error) {
    record.status = 'failed';
    record.note = redactSmokeText(errorMessage(error), options.secrets);
  }
}

async function maybeExerciseContact(options: {
  client: SmokeMcpClient;
  summary: SmokeRunSummary;
  artifacts: SmokeArtifacts;
  naming: SmokeRunNaming;
  toolNames: string[];
  maxLookupPages: number;
  secrets: readonly string[];
  abortSignal?: AbortSignal;
}): Promise<void> {
  if (!options.summary.contact.attempted) {
    options.summary.contact.skipped = true;
    options.summary.contact.reason = 'contact smoke disabled by configuration';
    options.summary.steps.push({ step: 'create temporary contact', status: 'skipped' });
    return;
  }
  const missingContactTools = CONTACT_TOOLS.filter((tool) => !options.toolNames.includes(tool));
  if (missingContactTools.length > 0) {
    const reason = `contact tools unavailable: ${missingContactTools.join(', ')}`;
    options.summary.contact.reason = reason;
    options.summary.steps.push({
      step: 'check contact tools',
      status: 'failed',
      note: reason,
    });
    throw new SmokeStepError('check contact tools', undefined, new Error(reason), options.secrets);
  }

  const alias = options.artifacts.alias;
  if (!alias) throw new Error('internal smoke error: missing temporary alias before contact step');

  throwIfAborted(options.abortSignal);
  const createStep = startStep(options.summary, 'create temporary contact', 'contact_create');
  let contact: Record<string, unknown>;
  let contactId: number | undefined;
  try {
    contact = await options.client.callTool('contact_create', {
      alias_id: alias.id,
      contact: options.naming.contact,
    });
    if (contact['existed'] !== true) {
      contactId = requireInteger(contact, 'id', 'contact_create');
    }
    createStep.status = 'ok';
  } catch (error) {
    const message = redactSmokeText(errorMessage(error), options.secrets);
    if (isOptionalContactLimitation(message)) {
      createStep.status = 'skipped';
      createStep.note = message;
      options.summary.contact.skipped = true;
      options.summary.contact.reason = message;
      return;
    }
    createStep.status = 'failed';
    createStep.note = message;
    throw new SmokeStepError('create temporary contact', 'contact_create', error, options.secrets);
  }

  if (contact['existed'] === true) {
    const reason = 'contact_create reported an existing contact for the unique smoke address';
    options.summary.contact.reason = reason;
    createStep.status = 'failed';
    createStep.note = reason;
    throw new SmokeStepError(
      'create temporary contact',
      'contact_create',
      new Error(reason),
      options.secrets,
    );
  }

  if (contactId === undefined) {
    throw new SmokeStepError(
      'create temporary contact',
      'contact_create',
      new Error('contact_create returned no contact id'),
      options.secrets,
    );
  }

  await runStep(
    options.summary,
    'read temporary contact',
    'contact_list',
    options.secrets,
    async () => {
      const found = await findContactById(
        options.client,
        alias.id,
        contactId,
        options.maxLookupPages,
      );
      if (!found) {
        throw new Error(`contact ${contactId} was not found on alias ${alias.id} after creation`);
      }
      if (!contactBelongsToRun(found, options.naming.runId)) {
        throw new Error('contact_list returned a contact that does not match this smoke run');
      }
      options.artifacts.contact = {
        id: contactId,
        aliasId: alias.id,
        contact: stringifyContact(found),
        runId: options.naming.runId,
        createdByRun: true,
      };
      return found;
    },
  );
}

async function cleanupContact(
  client: SmokeMcpClient,
  contact: SmokeContactArtifact,
  options: { runId: string; maxLookupPages: number; secrets: readonly string[] },
): Promise<CleanupRecord> {
  if (!ownsArtifact(contact, options.runId)) {
    return { status: 'skipped_foreign_artifact', attempted: false, id: contact.id };
  }

  try {
    const deleted = await client.callTool('contact_delete', {
      contact_id: contact.id,
      confirm: true,
    });
    if (deleted['deleted'] !== true) {
      return {
        status: 'delete_failed',
        attempted: true,
        id: contact.id,
        error: 'contact_delete did not return deleted=true',
      };
    }
  } catch (error) {
    return {
      status: 'delete_failed',
      attempted: true,
      id: contact.id,
      error: redactSmokeText(errorMessage(error), options.secrets),
    };
  }

  try {
    const found = await findContactById(
      client,
      contact.aliasId,
      contact.id,
      options.maxLookupPages,
    );
    if (found) {
      return {
        status: 'verification_failed',
        attempted: true,
        id: contact.id,
        error: `contact ${contact.id} was still visible after delete`,
      };
    }
  } catch (error) {
    return {
      status: 'verification_failed',
      attempted: true,
      id: contact.id,
      error: redactSmokeText(errorMessage(error), options.secrets),
    };
  }

  return { status: 'succeeded', attempted: true, id: contact.id };
}

async function cleanupAlias(
  client: SmokeMcpClient,
  alias: SmokeAliasArtifact,
  options: { runId: string; secrets: readonly string[] },
): Promise<CleanupRecord> {
  if (!ownsArtifact(alias, options.runId)) {
    return { status: 'skipped_foreign_artifact', attempted: false, id: alias.id };
  }

  try {
    const deleted = await client.callTool('alias_delete', { alias_id: alias.id, confirm: true });
    if (deleted['deleted'] !== true) {
      return {
        status: 'delete_failed',
        attempted: true,
        id: alias.id,
        error: 'alias_delete did not return deleted=true',
      };
    }
  } catch (error) {
    return {
      status: 'delete_failed',
      attempted: true,
      id: alias.id,
      error: redactSmokeText(errorMessage(error), options.secrets),
    };
  }

  try {
    await client.callTool('alias_get', { alias_id: alias.id });
    return {
      status: 'verification_failed',
      attempted: true,
      id: alias.id,
      error: `alias ${alias.id} was still readable after delete`,
    };
  } catch (error) {
    if (isNotFoundError(errorMessage(error))) {
      return { status: 'succeeded', attempted: true, id: alias.id };
    }
    return {
      status: 'verification_failed',
      attempted: true,
      id: alias.id,
      error: redactSmokeText(errorMessage(error), options.secrets),
    };
  }
}

async function findAliasByRunId(
  client: SmokeMcpClient,
  runId: string,
  maxPages: number,
): Promise<Record<string, unknown> | undefined> {
  for (let pageId = 0; pageId < maxPages; pageId++) {
    const result = await client.callTool('alias_list', { page_id: pageId, query: runId });
    const aliases = Array.isArray(result['aliases']) ? result['aliases'] : [];
    for (const candidate of aliases) {
      if (!isRecord(candidate)) continue;
      const note = candidate['note'];
      if (typeof note === 'string' && note.includes(runId)) return candidate;
    }
    if (aliases.length < LIST_PAGE_SIZE) return undefined;
  }
  return undefined;
}

async function findContactById(
  client: SmokeMcpClient,
  aliasId: number,
  contactId: number,
  maxPages: number,
): Promise<Record<string, unknown> | undefined> {
  for (let pageId = 0; pageId < maxPages; pageId++) {
    const result = await client.callTool('contact_list', { alias_id: aliasId, page_id: pageId });
    const contacts = Array.isArray(result['contacts']) ? result['contacts'] : [];
    for (const candidate of contacts) {
      if (isRecord(candidate) && candidate['id'] === contactId) return candidate;
    }
    if (contacts.length < LIST_PAGE_SIZE) return undefined;
  }
  return undefined;
}

async function findContactByRunId(
  client: SmokeMcpClient,
  aliasId: number,
  runId: string,
  maxPages: number,
): Promise<Record<string, unknown> | undefined> {
  for (let pageId = 0; pageId < maxPages; pageId++) {
    const result = await client.callTool('contact_list', { alias_id: aliasId, page_id: pageId });
    const contacts = Array.isArray(result['contacts']) ? result['contacts'] : [];
    for (const candidate of contacts) {
      if (isRecord(candidate) && contactBelongsToRun(candidate, runId)) return candidate;
    }
    if (contacts.length < LIST_PAGE_SIZE) return undefined;
  }
  return undefined;
}

function contactBelongsToRun(contact: Record<string, unknown>, runId: string): boolean {
  return stringifyContact(contact).includes(runId);
}

function stringifyContact(contact: Record<string, unknown>): string {
  const value = contact['contact'];
  return typeof value === 'string' ? value : '';
}

async function runStep<T>(
  summary: SmokeRunSummary,
  step: string,
  tool: string | undefined,
  secrets: readonly string[],
  action: () => Promise<T>,
): Promise<T> {
  const record = startStep(summary, step, tool);
  try {
    const result = await action();
    record.status = 'ok';
    return result;
  } catch (error) {
    record.status = 'failed';
    record.note = redactSmokeText(errorMessage(error), secrets);
    throw error instanceof SmokeStepError ? error : new SmokeStepError(step, tool, error, secrets);
  }
}

function startStep(summary: SmokeRunSummary, step: string, tool?: string): SmokeStep {
  const record: SmokeStep = { step, tool, status: 'failed' };
  summary.steps.push(record);
  return record;
}

function assertRequiredTools(toolNames: string[]): void {
  const missing = REQUIRED_TOOLS.filter((tool) => !toolNames.includes(tool));
  if (missing.length > 0) {
    throw new Error(`MCP server is missing required smoke-test tools: ${missing.join(', ')}`);
  }
}

function requireInteger(payload: Record<string, unknown>, field: string, tool: string): number {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${tool} returned no integer ${field}`);
  }
  return value;
}

function requireString(payload: Record<string, unknown>, field: string, tool: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${tool} returned no non-empty string ${field}`);
  }
  return value;
}

function parseToolResult<T extends Record<string, unknown>>(
  toolName: string,
  result: unknown,
  secrets: readonly string[],
): T {
  if (isRecord(result) && 'toolResult' in result) return result['toolResult'] as T;
  const text = extractToolText(result);
  if (isRecord(result) && result['isError'] === true) {
    throw new SmokeToolError(toolName, redactSmokeText(text || 'tool returned isError', secrets));
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SmokeToolError(
      toolName,
      redactSmokeText(`tool returned non-JSON text: ${text}`, secrets),
    );
  }
}

function extractToolText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result['content'])) return '';
  for (const item of result['content']) {
    if (isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string') {
      return item['text'];
    }
  }
  return '';
}

function normalizeFailure(
  error: unknown,
  summary: SmokeRunSummary,
  secrets: readonly string[],
): SmokeFailure {
  const stepError = error instanceof SmokeStepError ? error : undefined;
  const failure: SmokeFailure = {
    step: stepError?.step ?? 'run live smoke test',
    tool: stepError?.tool,
    message: redactSmokeText(errorMessage(error), secrets),
    suggestedIssueNotes: [],
  };
  failure.suggestedIssueNotes = buildSuggestedIssueNotes(summary, failure);
  return failure;
}

function buildSuggestedIssueNotes(summary: SmokeRunSummary, failure: SmokeFailure): string[] {
  const aliasId = summary.artifacts.alias?.id ?? 'none';
  const contactId = summary.artifacts.contact?.id ?? 'none';
  return [
    `Transport: ${summary.transport}`,
    `Run id: ${summary.runId}`,
    `Failed step: ${failure.step}`,
    `Tool: ${failure.tool ?? 'n/a'}`,
    `Error: ${failure.message}`,
    `Artifacts: alias_id=${aliasId}; contact_id=${contactId}`,
    `Cleanup: alias=${summary.cleanup.alias.status}; contact=${summary.cleanup.contact.status}`,
    'Expected: live smoke should create only its temporary alias/contact and verify cleanup.',
    'Follow-up: include the sanitized smoke summary JSON and server stderr around this run.',
  ];
}

function emptyCleanupSummary(): SmokeCleanupSummary {
  return {
    overall: 'not_needed',
    alias: { status: 'not_needed', attempted: false },
    contact: { status: 'not_needed', attempted: false },
  };
}

function summarizeCleanup(cleanup: SmokeCleanupSummary): SmokeCleanupSummary['overall'] {
  if (
    cleanup.alias.status === 'delete_failed' ||
    cleanup.alias.status === 'verification_failed' ||
    cleanup.contact.status === 'delete_failed' ||
    cleanup.contact.status === 'verification_failed'
  ) {
    return 'failed';
  }
  if (cleanup.alias.status === 'succeeded' || cleanup.contact.status === 'succeeded') {
    return 'succeeded';
  }
  return 'not_needed';
}

function shouldAttemptAliasRecovery(failure: SmokeFailure | undefined): boolean {
  return (
    failure?.step === 'create temporary random alias' || failure?.step === 'read temporary alias'
  );
}

function shouldAttemptContactRecovery(failure: SmokeFailure | undefined): boolean {
  return failure?.step === 'create temporary contact' || failure?.step === 'read temporary contact';
}

function ownsArtifact(artifact: SmokeArtifact, runId: string): boolean {
  return artifact.createdByRun && artifact.runId === runId;
}

function isOptionalContactLimitation(message: string): boolean {
  return /premium|upgrade|paid plan|subscription|plan (?:required|limit|limitation)/i.test(message);
}

function isNotFoundError(message: string): boolean {
  return /HTTP 404|not found|does not exist|missing/i.test(message);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Smoke run interrupted; skipping new mutating calls and starting cleanup.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index];
    if (!raw) continue;
    if (raw === '--') continue;
    if (raw === '--skip-contact') {
      values['contact'] = 'skip';
      continue;
    }
    if (!raw.startsWith('--')) {
      throw new Error(`Unexpected argument ${raw}`);
    }
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      values[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${raw}`);
    }
    values[withoutPrefix] = next;
    index++;
  }
  return values;
}

function normalizeTransportChoice(value: string): SmokeTransportChoice {
  if (value === 'stdio' || value === 'http' || value === 'all') return value;
  throw new Error('SMOKE_TRANSPORT must be stdio, http, or all');
}

function parseContactSetting(values: Record<string, string>, env: NodeJS.ProcessEnv): boolean {
  const raw = values['contact'] ?? env['SMOKE_CONTACT'] ?? 'create';
  if (['skip', 'false', '0', 'no'].includes(raw.toLowerCase())) return false;
  if (['create', 'true', '1', 'yes'].includes(raw.toLowerCase())) return true;
  throw new Error('SMOKE_CONTACT must be create or skip');
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = optionalEnv(env, name);
  if (!value) throw new Error(`${name} is required for the live SimpleLogin smoke test`);
  return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function buildServerEnv(
  env: NodeJS.ProcessEnv,
  values: { apiKey: string; apiUrl?: string },
): Record<string, string> {
  const serverEnv = getDefaultEnvironment();
  serverEnv['TRANSPORT'] = 'stdio';
  serverEnv['SL_API_KEY'] = values.apiKey;
  if (values.apiUrl) serverEnv['SL_API_URL'] = values.apiUrl;
  for (const key of ['SL_REQUEST_TIMEOUT_MS', 'NODE_EXTRA_CA_CERTS']) {
    const value = optionalEnv(env, key);
    if (value) serverEnv[key] = value;
  }
  return serverEnv;
}

async function runCli(): Promise<void> {
  let config: CliConfig | undefined;
  let receivedSignal: NodeJS.Signals | undefined;
  let removeSignalHandlers: (() => void) | undefined;
  try {
    config = parseCliConfig(process.argv.slice(2));
    const abortController = new AbortController();
    removeSignalHandlers = installSignalHandlers((signal) => {
      receivedSignal = signal;
      abortController.abort(signal);
      process.exitCode = signalExitCode(signal);
      process.stderr.write(
        `Received ${signal}; waiting for active smoke run cleanup before exiting.\n`,
      );
    });
    const summaries: SmokeRunSummary[] = [];
    for (const transport of config.transports) {
      if (receivedSignal) break;
      summaries.push(
        await runSmokeTest({
          transport,
          attemptContact: config.attemptContact,
          maxLookupPages: config.maxLookupPages,
          secrets: config.secrets,
          abortSignal: abortController.signal,
          clientFactory: (selectedTransport) => connectMcpSmokeClient(selectedTransport, config!),
        }),
      );
      if (receivedSignal) break;
    }

    const ok = !receivedSignal && summaries.every((summary) => summary.ok);
    process.stdout.write(`${JSON.stringify({ ok, summaries }, null, 2)}\n`);
    process.exitCode = receivedSignal ? signalExitCode(receivedSignal) : ok ? 0 : 1;
  } catch (error) {
    const secrets = config?.secrets ?? [];
    process.stderr.write(
      `Live smoke test failed: ${redactSmokeText(errorMessage(error), secrets)}\n`,
    );
    process.exitCode = 1;
  } finally {
    removeSignalHandlers?.();
  }
}

function installSignalHandlers(onSignal: (signal: NodeJS.Signals) => void): () => void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const handlers = signals.map((signal) => {
    const handler = (): void => onSignal(signal);
    process.once(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) {
      process.off(signal, handler);
    }
  };
}

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void runCli();
}
