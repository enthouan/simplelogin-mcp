// Run with Node 24's native type stripping; no dependency install or build is required.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const registryUrl = 'https://registry.modelcontextprotocol.io';
const repository = 'enthouan/simplelogin-mcp';
const serverName = 'io.github.enthouan/simplelogin-mcp';
const imageName = `ghcr.io/${repository}`;
const officialKey = 'io.modelcontextprotocol.registry/official';
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export interface Manifest extends Record<string, unknown> {
  name: string;
  version: string;
}

function object(value: unknown): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected object');
  return value as Record<string, unknown>;
}

export function validateRelease(
  input: unknown,
  packageVersion: unknown,
  env: NodeJS.ProcessEnv,
): Manifest {
  assert(env['GITHUB_ACTIONS'] === 'true', 'Registry automation must run in GitHub Actions');
  assert(env['GITHUB_REPOSITORY'] === repository, 'Unexpected repository');
  assert(env['GITHUB_EVENT_NAME'] === 'push', 'Only release tag pushes may publish');
  const match = /^refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
    env['GITHUB_REF'] ?? '',
  );
  assert(match, 'Expected a stable vX.Y.Z release tag');
  const version = match[1]!;
  const manifest = object(input);
  assert(manifest['name'] === serverName, 'Unexpected MCP server namespace');
  assert(
    manifest['version'] === version && packageVersion === version,
    'Release versions disagree',
  );
  assert(!('_meta' in manifest), 'Do not publish Registry-managed metadata');
  const source = object(manifest['repository']);
  assert(source['url'] === `https://github.com/${repository}`, 'Unexpected source repository');
  assert(source['source'] === 'github', 'Expected GitHub source');
  assert(
    Array.isArray(manifest['packages']) && manifest['packages'].length === 1,
    'Expected one OCI package',
  );
  const pkg = object(manifest['packages'][0]);
  assert(
    pkg['registryType'] === 'oci' && pkg['identifier'] === `${imageName}:${version}`,
    'OCI tag must match release',
  );
  assert(!('version' in pkg), 'OCI version belongs in the image identifier');
  assert(object(pkg['transport'])['type'] === 'stdio', 'Expected stdio transport');
  assert(Array.isArray(pkg['environmentVariables']), 'Expected environment metadata');
  const variables = pkg['environmentVariables'].map(object);
  const variableNames = variables.map((entry) => entry['name']);
  assert(
    variableNames.every((name) => typeof name === 'string') &&
      new Set(variableNames).size === variableNames.length,
    'Environment variable names must be unique strings',
  );
  const apiKey = variables.find((entry) => entry['name'] === 'SL_API_KEY');
  assert(
    apiKey?.['isSecret'] === true && apiKey['isRequired'] === true,
    'SL_API_KEY must be required and secret',
  );
  for (const entry of variables.filter((variable) => variable['isSecret'] === true)) {
    assert(
      !('value' in entry) && !('default' in entry),
      'Secret metadata must not contain values or defaults',
    );
  }
  assert(
    variables.some((entry) => entry['name'] === 'TRANSPORT' && entry['value'] === 'stdio'),
    'Expected fixed stdio environment',
  );
  return manifest as Manifest;
}

export function versionUrl(manifest: Manifest): string {
  return `${registryUrl}/v0.1/servers/${encodeURIComponent(manifest.name)}/versions/${encodeURIComponent(manifest.version)}`;
}

// 404 is the only absent state. Never reinterpret auth, server or parsing errors as absence.
export async function lookupVersion(
  manifest: Manifest,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(`${versionUrl(manifest)}?include_deleted=true`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  assert(response.ok, `Registry lookup failed (HTTP ${response.status})`);
  const entry: unknown = await response.json();
  // A 200/null is malformed, not permission to publish.
  object(entry);
  return entry;
}

export function verifyEntry(manifest: Manifest, entry: unknown): void {
  const response = object(entry);
  const metadata = object(object(response['_meta'])[officialKey]);
  assert(
    metadata['status'] === 'active',
    'Existing Registry version is not active; investigate without republishing',
  );
  assert(
    isDeepStrictEqual(response['server'], manifest),
    'Immutable Registry metadata differs; do not overwrite',
  );
  // isLatest may legitimately be false when checking an older release.
}

type Command = (program: string, args: string[]) => string;

export function verifyImage(manifest: Manifest, expectedDigest: string, command: Command): void {
  assert(digestPattern.test(expectedDigest), 'Missing Docker job image digest');
  const tag = `${imageName}:${manifest.version}`;
  const raw = command('docker', ['buildx', 'imagetools', 'inspect', tag, '--raw']);
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  assert(digest === expectedDigest, 'Public image tag does not match the Docker job digest');
  const index = object(JSON.parse(raw));
  assert(
    object(index['annotations'])['io.modelcontextprotocol.server.name'] === manifest.name,
    'Image ownership annotation mismatch',
  );
  assert(Array.isArray(index['manifests']), 'Expected a multi-platform index');
  const manifests = index['manifests'].map(object);
  const pinnedImage = `${imageName}@${digest}`;
  for (const architecture of ['amd64', 'arm64']) {
    const platform = `linux/${architecture}`;
    const runtime = manifests.filter((item) => {
      const target = object(item['platform']);
      return target['os'] === 'linux' && target['architecture'] === architecture;
    });
    assert(
      runtime.length === 1 && digestPattern.test(String(runtime[0]?.['digest'])),
      `Missing or duplicate ${platform} manifest`,
    );
    const inspect = (format: string): Record<string, unknown> =>
      object(
        JSON.parse(
          command('docker', ['buildx', 'imagetools', 'inspect', pinnedImage, '--format', format]),
        ),
      );
    const provenance = inspect(`{{json (index .Provenance "${platform}").SLSA}}`);
    const definition = provenance['buildDefinition'];
    const config =
      definition === undefined
        ? provenance['buildConfig']
        : object(object(definition)['internalParameters'])['buildConfig'];
    assert(Object.keys(object(config)).length > 0, `${platform} lacks max-mode provenance`);
    const sbom = inspect(`{{json (index .SBOM "${platform}").SPDX}}`);
    assert(
      sbom['SPDXID'] === 'SPDXRef-DOCUMENT' && String(sbom['spdxVersion']).startsWith('SPDX-'),
      `${platform} lacks an SPDX SBOM`,
    );
  }
}

export interface PublicationDependencies {
  lookup: () => Promise<unknown>;
  verifyImage: () => void;
  publisher: (args: string[]) => void;
  cleanup: () => void;
  wait: () => Promise<void>;
}

export async function publishRegistry(
  manifest: Manifest,
  dependencies: PublicationDependencies,
): Promise<'existing' | 'published'> {
  const existing = await dependencies.lookup();
  if (existing !== null) {
    verifyEntry(manifest, existing);
    dependencies.verifyImage();
    return 'existing';
  }
  dependencies.verifyImage();
  dependencies.publisher(['validate', 'server.json']);
  try {
    // Mint the short-lived token only after slower validation has finished.
    dependencies.publisher(['login', 'github-oidc', '--registry', registryUrl]);
    try {
      dependencies.publisher(['publish', 'server.json']);
    } catch {
      // A timeout/409 may still have committed. Read back; never retry this write.
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let entry: unknown = null;
      try {
        entry = await dependencies.lookup();
      } catch {
        // Only read-only verification is retried after publication.
      }
      if (entry !== null) {
        verifyEntry(manifest, entry);
        return 'published';
      }
      if (attempt < 5) await dependencies.wait();
    }
    throw new Error(
      'Publication outcome unconfirmed. Inspect the exact Registry version before rerunning only the failed Registry job.',
    );
  } finally {
    dependencies.cleanup();
  }
}

function command(program: string, args: string[], env = process.env): string {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    env,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never print captured publisher/OIDC responses or child-process exception objects.
  assert(
    result.status === 0 && !result.error,
    `${basename(program)} ${args[0] ?? ''} failed or timed out (output withheld)`,
  );
  return result.stdout;
}

function logout(): void {
  const tokenPath = join(homedir(), '.config', 'mcp-publisher', 'token.json');
  if (existsSync(tokenPath)) command('mcp-publisher', ['logout']);
  assert(!existsSync(tokenPath), 'Publisher credential cleanup failed');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  assert(['check', 'publish', 'logout'].includes(mode ?? ''), 'Expected check, publish or logout');
  assert(process.env['GITHUB_ACTIONS'] === 'true', 'This helper is only for GitHub Actions');
  if (mode === 'logout') return logout();
  const manifest = validateRelease(
    JSON.parse(readFileSync('server.json', 'utf8')),
    object(JSON.parse(readFileSync('package.json', 'utf8')))['version'],
    process.env,
  );
  if (mode === 'check') return;
  assert(
    !existsSync(join(homedir(), '.config', 'mcp-publisher', 'token.json')),
    'Refusing to reuse an existing publisher credential',
  );
  const dockerConfig = mkdtempSync(join(tmpdir(), 'mcp-registry-docker-'));
  try {
    // Keep the action-installed CLI plugin available without copying any Docker credentials.
    // System-installed plugins are also discovered by Docker automatically.
    const buildx = join(
      process.env['DOCKER_CONFIG'] ?? join(homedir(), '.docker'),
      'cli-plugins',
      'docker-buildx',
    );
    if (existsSync(buildx)) {
      mkdirSync(join(dockerConfig, 'cli-plugins'));
      symlinkSync(resolve(buildx), join(dockerConfig, 'cli-plugins', 'docker-buildx'));
    }
    const result = await publishRegistry(manifest, {
      lookup: () => lookupVersion(manifest),
      verifyImage: () =>
        verifyImage(manifest, process.env['RELEASE_IMAGE_DIGEST'] ?? '', (program, args) =>
          command(program, args, { ...process.env, DOCKER_CONFIG: dockerConfig }),
        ),
      publisher: (args) => {
        command('mcp-publisher', args);
      },
      cleanup: logout,
      wait: () => delay(5_000),
    });
    const summary = `MCP Registry: ${result} and verified [${manifest.name}@${manifest.version}](${versionUrl(manifest)}).\n`;
    process.stdout.write(summary);
    if (process.env['GITHUB_STEP_SUMMARY'])
      appendFileSync(process.env['GITHUB_STEP_SUMMARY'], summary);
  } finally {
    rmSync(dockerConfig, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Registry automation failed'}\n`,
    );
    process.exitCode = 1;
  });
}
