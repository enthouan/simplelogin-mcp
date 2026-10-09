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
const revisionPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

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

export class TransientRegistryError extends Error {}

// 404 is the only absent state. Never reinterpret auth, server or parsing errors as absence.
export async function lookupVersion(
  manifest: Manifest,
  request: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(`${versionUrl(manifest)}?include_deleted=true`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TransientRegistryError('Registry lookup network failure');
  }
  if (response.status === 404) return null;
  if ([408, 429].includes(response.status) || response.status >= 500) {
    throw new TransientRegistryError(`Registry lookup failed (HTTP ${response.status})`);
  }
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

export function validateReleaseSource(env: NodeJS.ProcessEnv, command: Command): string {
  const ref = env['GITHUB_REF'] ?? '';
  assert(
    ref.startsWith('refs/tags/v') && versionPattern.test(ref.slice(11)),
    'Invalid release ref',
  );
  assert(revisionPattern.test(env['GITHUB_SHA'] ?? ''), 'Missing event revision');
  assert(command('git', ['cat-file', '-t', ref]).trim() === 'tag', 'Release tag must be annotated');
  const revision = command('git', ['rev-parse', `${ref}^{commit}`]).trim();
  assert(revisionPattern.test(revision), 'Invalid release commit');
  assert(command('git', ['rev-parse', 'HEAD']).trim() === revision, 'Checkout differs from tag');
  assert(
    command('git', ['rev-parse', `${env['GITHUB_SHA']}^{commit}`]).trim() === revision,
    'Event differs from tag',
  );
  command('git', ['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']);
  return revision;
}

// A public GHCR token grants anonymous pull access only. Never use runner credentials here,
// and never treat an authentication, network or malformed-response error as a missing image.
export async function lookupImage(
  tag: string,
  request: typeof fetch = fetch,
): Promise<string | null> {
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(tag), 'Invalid image tag');
  const auth = await request(
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`,
    {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    },
  );
  assert(auth.ok, `Anonymous GHCR authorization failed (HTTP ${auth.status})`);
  const token = object(await auth.json())['token'];
  assert(typeof token === 'string' && token.length > 0, 'Missing anonymous GHCR token');
  const response = await request(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  assert(response.ok, `Anonymous image lookup failed (HTTP ${response.status})`);
  const raw = await response.text();
  const index = object(JSON.parse(raw));
  assert(Array.isArray(index['manifests']), 'Expected a multi-platform image index');
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const header = response.headers.get('docker-content-digest');
  assert(header === null || header === digest, 'GHCR content digest mismatch');
  return digest;
}

export function imageIdentity(
  digest: string,
  command: Command,
): { version: string; revision: string } {
  assert(digestPattern.test(digest), 'Invalid image digest');
  let identity: { version: string; revision: string } | undefined;
  for (const architecture of ['amd64', 'arm64']) {
    const platform = `linux/${architecture}`;
    const image = object(
      JSON.parse(
        command('docker', [
          'buildx',
          'imagetools',
          'inspect',
          `${imageName}@${digest}`,
          '--format',
          `{{json (index .Image "${platform}")}}`,
        ]),
      ),
    );
    assert(
      image['os'] === 'linux' && image['architecture'] === architecture,
      'Image platform mismatch',
    );
    const config = object(image['config']);
    const labels = object(config['Labels']);
    assert(
      labels['org.opencontainers.image.source'] === `https://github.com/${repository}`,
      'Image source mismatch',
    );
    assert(
      labels['io.modelcontextprotocol.server.name'] === serverName,
      'Image ownership label mismatch',
    );
    assert(config['User'] === 'node', 'Release image must run as node');
    assert(isDeepStrictEqual(config['Cmd'], ['node', 'dist/index.js']), 'Unexpected image command');
    const version = labels['org.opencontainers.image.version'];
    const revision = labels['org.opencontainers.image.revision'];
    assert(typeof version === 'string' && version.length > 0, 'Missing image version');
    assert(
      typeof revision === 'string' && revisionPattern.test(revision),
      'Missing image revision',
    );
    const current = { version, revision };
    assert(
      identity === undefined || isDeepStrictEqual(identity, current),
      'Platform identities disagree',
    );
    identity = current;
  }
  return identity!;
}

export function verifyImage(
  manifest: Manifest,
  expectedDigest: string,
  command: Command,
  expectedRevision: string,
): void {
  assert(digestPattern.test(expectedDigest), 'Missing Docker job image digest');
  assert(revisionPattern.test(expectedRevision), 'Missing release source revision');
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
  const identity = imageIdentity(digest, command);
  assert(identity.version === manifest.version, 'Image version differs from release');
  assert(identity.revision === expectedRevision, 'Image revision differs from release');
}

export async function prepareImage(
  manifest: Manifest,
  dependencies: {
    lookupImage: (tag: string) => Promise<string | null>;
    lookupVersion: () => Promise<unknown>;
    verifyImage: (digest: string) => void;
  },
): Promise<string | null> {
  const existing = await dependencies.lookupVersion();
  if (existing !== null) verifyEntry(manifest, existing);
  const digest = await dependencies.lookupImage(manifest.version);
  assert(
    existing === null || digest !== null,
    'Published Registry entry has no image; do not rebuild it',
  );
  if (digest !== null) dependencies.verifyImage(digest);
  return digest;
}

// Read the remote, not this run's checkout: newer releases may have appeared since it started.
// A peeled ref identifies an annotated tag; lightweight and non-stable tags do not own aliases.
export function lookupReleaseTags(command: Command): Map<string, string> {
  const refs = new Map<string, string>();
  const raw = command('git', ['ls-remote', '--tags', 'origin']).trim();
  for (const line of raw ? raw.split('\n') : []) {
    const match = /^([a-f0-9]{40})\t(refs\/tags\/\S+)$/.exec(line);
    assert(match && !refs.has(match[2]!), 'Invalid remote tag response');
    refs.set(match[2]!, match[1]!);
  }
  const releases = new Map<string, string>();
  for (const [ref, revision] of refs) {
    if (!ref.startsWith('refs/tags/v') || !ref.endsWith('^{}')) continue;
    const version = ref.slice('refs/tags/v'.length, -3);
    if (!versionPattern.test(version)) continue;
    assert(refs.has(ref.slice(0, -3)), 'Missing remote annotated tag object');
    releases.set(version, revision);
  }
  return releases;
}

// The workflow serializes all image writers. Decide all changes before writing, preserve
// newer releases' minor aliases, and copy the original index without rebuilding.
export async function repairAliases(
  manifest: Manifest,
  digest: string,
  revision: string,
  dependencies: {
    releaseTags: () => Map<string, string>;
    lookup: (tag: string) => Promise<string | null>;
    identity: (digest: string) => { version: string; revision: string };
    command: Command;
  },
): Promise<void> {
  assert(digestPattern.test(digest) && revisionPattern.test(revision), 'Invalid release identity');
  const version = versionPattern.exec(manifest.version);
  assert(version, 'Expected stable release version');
  const releases = dependencies.releaseTags();
  assert(
    releases.get(manifest.version) === revision,
    'Release tag is missing or points to a different remote commit',
  );
  const newerRelease = [...releases.keys()].some((value) => {
    const current = versionPattern.exec(value);
    return (
      current !== null &&
      current[1] === version[1] &&
      current[2] === version[2] &&
      BigInt(current[3]!) > BigInt(version[3]!)
    );
  });
  const shaTag = `sha-${revision}`;
  const minorTag = `${version[1]}.${version[2]}`;
  const targets: string[] = [];
  const commitDigest = await dependencies.lookup(shaTag);
  if (commitDigest !== digest) {
    if (commitDigest !== null) {
      const identity = dependencies.identity(commitDigest);
      // A main build of this same commit can already own the convenience SHA tag.
      assert(identity.revision === revision, 'Commit alias points to a different source revision');
      assert(
        ['latest', 'main'].includes(identity.version),
        'Commit alias conflicts with a release image',
      );
    }
    targets.push(shaTag);
  }
  // Even a missing or stale alias belongs to the newer release; retry that release to repair it.
  if (!newerRelease) {
    const minorDigest = await dependencies.lookup(minorTag);
    if (minorDigest !== digest) {
      let update = minorDigest === null;
      if (minorDigest !== null) {
        const current = versionPattern.exec(dependencies.identity(minorDigest).version);
        assert(
          current && current[1] === version[1] && current[2] === version[2],
          'Invalid minor alias version',
        );
        assert(current[3] !== version[3], 'Minor alias conflicts with the exact release image');
        update = BigInt(current[3]!) < BigInt(version[3]!);
      }
      if (update) targets.push(minorTag);
    }
  }
  if (targets.length === 0) return;
  dependencies.command('docker', [
    'buildx',
    'imagetools',
    'create',
    ...targets.flatMap((tag) => ['--tag', `${imageName}:${tag}`]),
    `${imageName}@${digest}`,
  ]);
  for (const tag of targets) {
    assert((await dependencies.lookup(tag)) === digest, `Image alias ${tag} was not confirmed`);
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
      } catch (error) {
        // Retry only transient reads, not auth failures or malformed successful responses.
        if (!(error instanceof TransientRegistryError)) throw error;
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

function output(name: string, value: string): void {
  assert(!/[\r\n]/.test(value), 'Invalid workflow output');
  if (process.env['GITHUB_OUTPUT'])
    appendFileSync(process.env['GITHUB_OUTPUT'], `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  assert(
    [
      'check',
      'policy',
      'prepare-image',
      'verify-image',
      'repair-aliases',
      'publish',
      'logout',
    ].includes(mode ?? ''),
    'Expected a Registry or release-image command',
  );
  assert(process.env['GITHUB_ACTIONS'] === 'true', 'This helper is only for GitHub Actions');
  if (mode === 'logout') return logout();
  const manifest = validateRelease(
    JSON.parse(readFileSync('server.json', 'utf8')),
    object(JSON.parse(readFileSync('package.json', 'utf8')))['version'],
    process.env,
  );
  if (mode === 'check') return;
  if (mode === 'policy') {
    output('revision', validateReleaseSource(process.env, command));
    return;
  }
  const revision = process.env['RELEASE_COMMIT'] ?? '';
  assert(revisionPattern.test(revision), 'Missing release source revision');
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
    const anonymousCommand: Command = (program, args) =>
      command(program, args, { ...process.env, DOCKER_CONFIG: dockerConfig });
    const verify = (digest: string): void =>
      verifyImage(manifest, digest, anonymousCommand, revision);
    if (mode === 'prepare-image') {
      const digest = await prepareImage(manifest, {
        lookupImage,
        lookupVersion: () => lookupVersion(manifest),
        verifyImage: verify,
      });
      output('exists', String(digest !== null));
      output('digest', digest ?? '');
      return;
    }
    const digest = process.env['RELEASE_IMAGE_DIGEST'] ?? '';
    if (mode === 'verify-image' || mode === 'repair-aliases') {
      verify(digest);
      if (mode === 'repair-aliases') {
        await repairAliases(manifest, digest, revision, {
          releaseTags: () => lookupReleaseTags(command),
          lookup: lookupImage,
          identity: (value) => imageIdentity(value, anonymousCommand),
          command,
        });
      }
      return;
    }
    const result = await publishRegistry(manifest, {
      lookup: () => lookupVersion(manifest),
      verifyImage: () => verify(digest),
      publisher: (args) => {
        command('mcp-publisher', args);
      },
      cleanup: logout,
      wait: () => delay(5_000),
    });
    const summary = [
      `MCP Registry: ${result} and verified [${manifest.name}@${manifest.version}](${versionUrl(manifest)}).`,
      `Source commit: \`${revision}\`.`,
      `Verified image: \`${imageName}@${digest}\` (linux/amd64 and linux/arm64, max provenance and SPDX SBOMs).`,
      '',
    ].join('\n');
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
