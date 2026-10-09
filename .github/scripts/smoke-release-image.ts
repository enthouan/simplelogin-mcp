// Run via tsx after a frozen dependency install. No API tools are called.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_NAMES } from '../../src/tools/catalog.js';

export function smokeArguments(image: string, name: string): string[] {
  assert(
    /^ghcr\.io\/enthouan\/simplelogin-mcp@sha256:[a-f0-9]{64}$/.test(image) ||
      image === 'simplelogin-mcp:smoke',
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
): void {
  assert(
    info?.name === 'simplelogin-mcp' && info.version === version,
    'MCP server identity mismatch',
  );
  assert.deepEqual([...names].sort(), [...TOOL_NAMES].sort(), 'MCP tool catalog mismatch');
}

function docker(args: string[], allowFailure = false): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!allowFailure) assert(result.status === 0 && !result.error, `Docker ${args[0]} failed`);
  return result.stdout ?? '';
}

async function main(): Promise<void> {
  const image = process.argv[2] ?? '';
  const name = `simplelogin-registry-smoke-${randomUUID()}`;
  const args = smokeArguments(image, name);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  if (image !== 'simplelogin-mcp:smoke') docker(['pull', image]);
  const transport = new StdioClientTransport({
    command: 'docker',
    args,
    stderr: 'pipe',
    env: {
      ...getDefaultEnvironment(),
      ...(process.env['DOCKER_CONFIG'] ? { DOCKER_CONFIG: process.env['DOCKER_CONFIG'] } : {}),
    },
  });
  // Drain diagnostic output without forwarding environment values or untrusted image output.
  transport.stderr?.on('data', () => {
    /* Intentionally discard child diagnostics. */
  });
  const client = new Client({ name: 'simplelogin-release-smoke', version: '1.0.0' });
  const deadline = setTimeout(() => {
    docker(['rm', '--force', name], true);
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
    verifyDiscovery(client.getServerVersion(), names, pkg.version);
    const health: unknown = JSON.parse(
      docker(['inspect', '--format', '{{json .Config.Healthcheck.Test}}', name]),
    );
    assert.deepEqual(
      health,
      ['CMD', 'node', 'dist/healthcheck.js'],
      'Unexpected image health check',
    );
    // Exercise the actual configured check, without disabling Docker health checks.
    docker(['exec', name, 'node', 'dist/healthcheck.js']);
    process.stdout.write(
      `Offline MCP image smoke passed: version ${pkg.version}, ${names.length} tools, stdio health check.\n`,
    );
  } finally {
    clearTimeout(deadline);
    // Stop only this uniquely named smoke container, including when startup failed.
    docker(['rm', '--force', name], true);
    await client.close();
    await transport.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Image smoke failed'}\n`);
    process.exitCode = 1;
  });
}
