// Run via tsx after a frozen dependency install. No API tools are called.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_NAMES } from '../../src/tools/catalog.js';
import { git } from './docker-hub-mirror.ts';
import {
  digestPattern,
  object,
  repository,
  revisionPattern,
  versionPattern,
} from './mcp-registry.ts';

export function smokeArguments(image: string, name: string): string[] {
  assert(
    ['ghcr.io', 'docker.io'].some((host) => {
      const prefix = `${host}/${repository}@`;
      return image.startsWith(prefix) && digestPattern.test(image.slice(prefix.length));
    }) || image === 'simplelogin-mcp:smoke',
    'Expected an immutable release digest or the local smoke-test image',
  );
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--network=none',
    '--pull=never',
    '-e',
    'TRANSPORT=stdio',
    '-e',
    'SL_API_KEY=registry-smoke-not-a-real-key',
    '-e',
    'SL_API_URL=http://127.0.0.1:9',
    image,
  ];
}

export function verifyDiscovery(
  info: { name: string; version: string } | undefined,
  names: string[],
  version: string,
  expectedNames: readonly string[] = TOOL_NAMES,
): void {
  assert(
    info?.name === 'simplelogin-mcp' && info.version === version,
    'MCP server identity mismatch',
  );
  assert.deepEqual([...names].sort(), [...expectedNames].sort(), 'MCP tool catalog mismatch');
}

// Read the reviewed release's generated catalog as data. Never load historical modules.
export function releaseExpectations(
  revision: string,
  read = (ref: string): string => execFileSync('git', ['show', ref], { encoding: 'utf8' }),
) {
  assert(revisionPattern.test(revision), 'Invalid smoke release revision');
  const { version } = object(JSON.parse(read(`${revision}:package.json`)));
  assert(
    typeof version === 'string' && versionPattern.test(version),
    'Invalid smoke release version',
  );
  const rows = read(`${revision}:TOOL_CATALOG.md`)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|'));
  assert(
    /^\|\s*Tool\s*\|/.test(rows[0] ?? '') && /^\|\s*-+\s*\|/.test(rows[1] ?? '') && rows.length > 2,
    'Missing release tool catalog',
  );
  const names = rows.slice(2).map((row) => {
    const match = /^\|\s*`([A-Za-z0-9_.-]+)`\s*\|/.exec(row);
    assert(match, 'Invalid release tool row');
    return match[1]!;
  });
  assert(new Set(names).size === names.length, 'Duplicate release tool names');
  return { version, names };
}

// The first five releases registered tools as string literals before the generated catalog existed.
export function originalToolNames(sources: string[]): string[] {
  const names = sources.flatMap((source) => {
    const registrations = [
      ...source.matchAll(/\bserver\.registerTool\(\s*'([A-Za-z0-9_.-]+)'\s*,/g),
    ];
    assert.equal(
      registrations.length,
      [...source.matchAll(/\bserver\.registerTool\(/g)].length,
      'Unknown historical tool registration',
    );
    return registrations.map((match) => match[1]!);
  });
  assert(
    names.length > 0 && new Set(names).size === names.length,
    'Missing or duplicate historical tool names',
  );
  return names;
}

export async function withAnonymousDocker<T>(use: (config: string) => Promise<T>): Promise<T> {
  const config = mkdtempSync(join(tmpdir(), 'simplelogin-anonymous-pull-'));
  try {
    // An unrelated empty auth entry suppresses Docker CLI's automatic native keychain discovery.
    writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { 'unused.invalid': {} } }));
    return await use(config);
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
}

function docker(args: string[], env: NodeJS.ProcessEnv, allowFailure = false): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!allowFailure) assert(result.status === 0 && !result.error, `Docker ${args[0]} failed`);
  return result.stdout ?? '';
}

async function historicalHttpHealth(image: string, name: string, env: NodeJS.ProcessEnv) {
  try {
    docker(
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '--network=none',
        '--pull=never',
        '--health-interval=1s',
        '--health-start-period=1s',
        '-e',
        'TRANSPORT=http',
        '-e',
        // Only loopback exists under --network=none. Serve both localhost address families:
        // the early wget probe resolves localhost, while later builds probe 127.0.0.1.
        'HOST=::',
        '-e',
        'MCP_AUTH_TOKEN=isolated-historical-health-test',
        '-e',
        'PORT=3000',
        '-e',
        'SL_API_KEY=registry-smoke-not-a-real-key',
        '-e',
        'SL_API_URL=http://127.0.0.1:9',
        image,
      ],
      env,
    );
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = docker(['inspect', '--format', '{{.State.Health.Status}}', name], env).trim();
      if (status === 'healthy') return;
      await delay(1000);
    }
    throw new Error('The historical image failed its original HTTP health check');
  } finally {
    docker(['rm', '--force', name], env, true);
  }
}

async function smoke(
  image: string,
  expected: { version: string; names: readonly string[] },
  dockerConfig?: string,
  historical = false,
): Promise<void> {
  const name = `simplelogin-registry-smoke-${randomUUID()}`;
  const args = smokeArguments(image, name);
  const env = {
    ...getDefaultEnvironment(),
    ...(dockerConfig ? { DOCKER_CONFIG: dockerConfig } : {}),
  };
  if (image !== 'simplelogin-mcp:smoke') docker(['pull', image], env);
  const transport = new StdioClientTransport({
    command: 'docker',
    args,
    stderr: 'pipe',
    env,
  });
  // Drain diagnostic output without forwarding environment values or untrusted image output.
  transport.stderr?.on('data', () => {
    /* Intentionally discard child diagnostics. */
  });
  const client = new Client({ name: 'simplelogin-release-smoke', version: '1.0.0' });
  const deadline = setTimeout(() => {
    docker(['rm', '--force', name], env, true);
    process.exitCode = 1;
    void client.close();
  }, 60_000);
  try {
    await client.connect(transport, { timeout: 30_000 });
    const names: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
      names.push(...page.tools.map((tool) => tool.name));
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        assert(!cursors.has(cursor) && cursors.size < 100, 'Invalid tool pagination');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    verifyDiscovery(client.getServerVersion(), names, expected.version, expected.names);
    if (historical) {
      await historicalHttpHealth(image, name + '-http', env);
      process.stdout.write(
        `Native ${process.arch} historical smoke passed: ${expected.version}, ${names.length} stdio tools, original HTTP health check on isolated loopback.\n`,
      );
      return;
    }
    const health: unknown = JSON.parse(
      docker(['inspect', '--format', '{{json .Config.Healthcheck.Test}}', name], env),
    );
    assert.deepEqual(
      health,
      ['CMD', 'node', 'dist/healthcheck.js'],
      'Unexpected image health check',
    );
    // Exercise the actual configured check, without disabling Docker health checks.
    docker(['exec', name, ...health.slice(1)], env);
    process.stdout.write(
      `Native ${process.arch} offline MCP smoke passed: simplelogin-mcp ${expected.version}, ${names.length} tools, configured stdio health check.\n`,
    );
  } finally {
    clearTimeout(deadline);
    // Stop only this uniquely named smoke container, including when startup failed.
    docker(['rm', '--force', name], env, true);
    await client.close();
    await transport.close();
  }
}

async function main(): Promise<void> {
  const image = process.argv[2] ?? '';
  if (image === '--history') {
    const host = process.argv[3];
    assert(host === 'ghcr.io' || host === 'docker.io', 'Unexpected historical registry');
    const { historicalImages } = await import('./docker-hub-history.ts');
    for (const { version, revision, digest } of historicalImages) {
      const expected =
        git(['ls-tree', '--name-only', revision, 'TOOL_CATALOG.md']) === 'TOOL_CATALOG.md'
          ? releaseExpectations(revision)
          : {
              version,
              names: originalToolNames(
                git(['ls-tree', '-r', '--name-only', revision, 'src/tools'])
                  .split('\n')
                  .filter((path) => path.endsWith('.ts'))
                  .map((path) => git(['show', `${revision}:${path}`])),
              ),
            };
      assert.equal(expected.version, version);
      await withAnonymousDocker((config) =>
        smoke(`${host}/enthouan/simplelogin-mcp@${digest}`, expected, config, true),
      );
    }
    return;
  }
  const revision = process.argv[3];
  const expected =
    revision === undefined
      ? {
          version: (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
            .version,
          names: TOOL_NAMES,
        }
      : releaseExpectations(revision);
  if (image === 'simplelogin-mcp:smoke')
    return smoke(image, expected, process.env['DOCKER_CONFIG']);
  await withAnonymousDocker((config) => smoke(image, expected, config));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Image smoke failed'}\n`);
    process.exitCode = 1;
  });
}
