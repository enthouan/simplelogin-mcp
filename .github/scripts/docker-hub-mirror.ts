// All writes flow through the one serialized mirror job. Recovery executes code from main.
import assert, { AssertionError } from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  digestPattern,
  object,
  repository,
  revisionPattern,
  validateReleaseMetadata,
  validateReleaseSource,
  versionPattern,
} from './mcp-registry.ts';
import {
  type Identity,
  MissingContent,
  PublicRegistry,
  requirePublicHub,
  retryRead,
} from './mirror-registry.ts';

const source = `ghcr.io/${repository}`;
const destination = `docker.io/${repository}`;
type Git = (args: string[]) => string;
export const git: Git = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env['PATH'], HOME: process.env['HOME'], GIT_TERMINAL_PROMPT: '0' },
  }).trimEnd();

function releaseMetadata(version: string, revision: string, run: Git) {
  const file = (path: string): unknown => JSON.parse(run(['show', `${revision}:${path}`]));
  return validateReleaseMetadata(
    file('server.json'),
    object(file('package.json'))['version'],
    version,
  );
}

export function selectedRelease(env: NodeJS.ProcessEnv, run: Git): Identity {
  const tag = env['RELEASE_TAG'] ?? '';
  const version = tag.slice(1);
  const revision = env['RELEASE_COMMIT'] ?? '';
  const digest = env['RELEASE_IMAGE_DIGEST'] ?? '';
  assert(
    env['GITHUB_ACTIONS'] === 'true' && env['GITHUB_REPOSITORY'] === repository,
    'Expected upstream repository',
  );
  assert(
    tag.startsWith('v') &&
      versionPattern.test(version) &&
      revisionPattern.test(revision) &&
      digestPattern.test(digest),
    'Invalid release tag, revision or digest',
  );
  const ref = `refs/tags/${tag}`;
  if (env['GITHUB_EVENT_NAME'] === 'push') {
    assert(env['GITHUB_REF'] === ref, 'Unexpected push ref');
    assert(
      env['GITHUB_WORKFLOW_REF'] === `${repository}/.github/workflows/release.yml@${ref}`,
      'Only the release workflow can supply Docker job outputs',
    );
    assert(
      validateReleaseSource(env, (_, args) => run(args)) === revision,
      'Docker job revision differs from release',
    );
  } else {
    assert(
      env['GITHUB_EVENT_NAME'] === 'workflow_dispatch' && env['GITHUB_REF'] === 'refs/heads/main',
      'Recovery must run from main',
    );
    assert(
      env['GITHUB_WORKFLOW_REF'] ===
        `${repository}/.github/workflows/docker-hub-mirror.yml@refs/heads/main`,
      'Unexpected recovery workflow',
    );
    assert(
      revisionPattern.test(env['GITHUB_SHA'] ?? '') &&
        run(['rev-parse', 'HEAD']) === env['GITHUB_SHA'],
      'Recovery implementation differs from event',
    );
    run(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']);
    assert(
      run(['cat-file', '-t', ref]) === 'tag' && run(['rev-parse', `${ref}^{commit}`]) === revision,
      'Recovery release tag differs from selected commit',
    );
    run(['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']);
  }
  releaseMetadata(version, revision, run);
  return { version, revision, digest };
}

export function compareVersions(a: string, b: string): number {
  assert(versionPattern.test(a) && versionPattern.test(b), 'Invalid stable version');
  const right = b.split('.').map(BigInt);
  for (const [i, value] of a.split('.').map(BigInt).entries()) {
    if (value !== right[i]) return value > right[i]! ? 1 : -1;
  }
  return 0;
}

// Fetch one snapshot, including deletions, into a private ref namespace. A newer eligible tag
// reserves latest even while its GHCR publication or GitHub Release creation is still pending.
export function freshReleases(selected: Identity, run: Git): Map<string, string> {
  run([
    'fetch',
    '--atomic',
    '--prune',
    '--no-tags',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/tags/v*:refs/mirror/tags/v*',
  ]);
  const refs = run([
    'for-each-ref',
    '--merged=refs/remotes/origin/main',
    '--format=%(refname:strip=3) %(objecttype) %(*objecttype) %(*objectname)',
    'refs/mirror/tags/',
  ]);
  const releases = new Map<string, string>();
  for (const line of refs.split('\n')) {
    const [tag, type, peeledType, revision] = line.split(' ');
    if (!tag?.startsWith('v') || !versionPattern.test(tag.slice(1)) || type !== 'tag') continue;
    if (peeledType !== 'commit' || !revision) continue;
    const version = tag.slice(1);
    // Only a newer candidate needs its metadata checked to reserve latest. Old releases
    // can predate server.json. Read historical files as data, never execute their scripts.
    if (compareVersions(version, selected.version) > 0) {
      if (
        run(['ls-tree', '--name-only', revision, 'server.json', 'package.json']) !==
        'package.json\nserver.json'
      )
        continue;
      try {
        releaseMetadata(version, revision, run);
      } catch (error) {
        if (error instanceof AssertionError || error instanceof SyntaxError) continue;
        throw error;
      }
    }
    releases.set(version, revision);
  }
  assert(
    releases.get(selected.version) === selected.revision,
    'Selected remote release tag is missing or changed',
  );
  assert.equal(
    run(['rev-parse', `refs/mirror/tags/v${selected.version}`]),
    run(['rev-parse', `refs/tags/v${selected.version}`]),
    'Selected annotated tag object changed',
  );
  return releases;
}

interface Dependencies {
  releases: () => Map<string, string>;
  tag: (tag: string) => Promise<Identity | null>;
  verify: () => Promise<Record<string, string>>;
}
interface Plan {
  action: 'copy' | 'repair' | 'verified' | 'preserve';
  previous: Identity | null;
  detail: string;
}

export async function planTag(tag: string, selected: Identity, deps: Dependencies): Promise<Plan> {
  assert(tag === selected.version || tag === 'latest', 'Unexpected mirror tag');
  const releases = deps.releases();
  assert(
    releases.get(selected.version) === selected.revision,
    'Selected remote release tag is missing or changed',
  );
  const previous = await deps.tag(tag);
  if (tag === 'latest') {
    const newest = [...releases.keys()].sort(compareVersions).at(-1)!;
    if (compareVersions(newest, selected.version) > 0)
      return {
        action: 'preserve',
        previous,
        detail: `latest belongs to v${newest}. Recover v${newest} to repair it.`,
      };
    if (previous && compareVersions(previous.version, selected.version) > 0)
      return {
        action: 'preserve',
        previous,
        detail: `latest already identifies newer v${previous.version}.`,
      };
  }
  if (previous === null) return { action: 'copy', previous, detail: 'tag is absent' };
  if (previous.digest === selected.digest) {
    assert.deepEqual(previous, selected, 'Tag identity mismatch');
    try {
      await deps.verify();
      return { action: 'verified', previous, detail: 'complete graph verified' };
    } catch (error) {
      if (!(error instanceof MissingContent)) throw error;
      return { action: 'repair', previous, detail: error.message };
    }
  }
  assert(
    tag === 'latest' && previous.version !== selected.version,
    `Immutable conflict at ${destination}:${tag}`,
  );
  assert(
    releases.get(previous.version) === previous.revision,
    'Existing latest has conflicting release identity',
  );
  assert.deepEqual(
    await deps.tag(previous.version),
    previous,
    'Existing latest differs from its exact Docker Hub tag',
  );
  return { action: 'copy', previous, detail: `advance from v${previous.version}` };
}

type Copy = (tag: string) => boolean;

// A failed client response can follow a successful write. Read back, never submit a second
// write here. An unchanged old alias may be briefly visible after a successful update.
export async function publishTag(
  tag: string,
  selected: Identity,
  deps: Dependencies,
  copy: Copy,
  report: (line: string) => void,
  wait?: (ms: number) => Promise<void>,
) {
  const plan = await planTag(tag, selected, deps);
  report(
    `${destination}:${tag} — ${plan.action} (${plan.detail}). Prior digest: ${plan.previous?.digest ?? 'absent'}.`,
  );
  if (plan.action === 'preserve' || plan.action === 'verified') return;
  // A partial graph check may have taken time. Recheck ownership and the observed alias
  // immediately before writing, while this job holds the shared mirror-writer group.
  const fresh = deps.releases();
  assert(
    fresh.get(selected.version) === selected.revision,
    'Selected remote tag moved before write',
  );
  if (tag === 'latest' && [...fresh.keys()].some((v) => compareVersions(v, selected.version) > 0)) {
    const newest = [...fresh.keys()].sort(compareVersions).at(-1)!;
    report(`Preserved latest. Recover v${newest} for that alias.`);
    return;
  }
  if (tag === 'latest') {
    assert.deepEqual(
      await deps.tag(selected.version),
      selected,
      'Exact Docker Hub tag changed before latest publication',
    );
  }
  assert.deepEqual(
    await deps.tag(tag),
    plan.previous,
    'Destination changed before write. Inspect and retry the mirror.',
  );
  const confirmedResponse = copy(tag);
  await retryRead(
    async () => {
      const observed = await deps.tag(tag);
      if (
        !observed ||
        (observed.digest !== selected.digest && observed.digest === plan.previous?.digest)
      )
        throw new MissingContent(
          `Write unconfirmed for ${tag}. Inspect the destination and retry only the mirror.`,
        );
      assert.deepEqual(observed, selected, `Conflicting read-back for ${tag}`);
      await deps.verify();
    },
    true,
    wait,
  );
  report(
    `${tag} ${confirmedResponse ? 'copied' : 'verified after an uncertain copy response'} at ${selected.digest}; all referenced content verified anonymously.`,
  );
}

type Regctl = (args: string[], env: NodeJS.ProcessEnv, input?: string) => boolean;
const regctl: Regctl = (args, env, input) => {
  const result = spawnSync('regctl', args, {
    env,
    input,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 10 * 60_000,
  });
  return !result.error && result.status === 0;
};

export function copyImage(
  selected: Identity,
  tag: string,
  env: NodeJS.ProcessEnv,
  run: Regctl = regctl,
): boolean {
  assert(
    digestPattern.test(selected.digest) &&
      revisionPattern.test(selected.revision) &&
      versionPattern.test(selected.version) &&
      (tag === selected.version || tag === 'latest'),
    'Invalid copy reference',
  );
  assert(
    env['DOCKERHUB_CONFIRMED_REPOSITORY'] === destination,
    'Owner must confirm the public Docker Hub repository before enabling writes',
  );
  const user = env['DOCKERHUB_USERNAME'];
  const token = env['DOCKERHUB_TOKEN'];
  assert(
    user && token,
    'Provision DOCKERHUB_USERNAME and DOCKERHUB_TOKEN in the dockerhub environment',
  );
  const dir = mkdtempSync(join(env['MIRROR_TEMP'] ?? tmpdir(), 'simplelogin-mirror-auth-'));
  // regctl never inherits the runner's home, Docker config, publishing secret env, or helpers.
  const isolated = {
    PATH: env['PATH'],
    HOME: dir,
    DOCKER_CONFIG: dir,
    REGCTL_CONFIG: join(dir, 'regctl.json'),
  };
  try {
    assert(
      run(['config', 'set', '--docker-cred=false', '--docker-cert=false'], isolated),
      'regctl isolation failed',
    );
    assert(
      run(['registry', 'login', 'docker.io', '--user', user, '--pass-stdin'], isolated, token),
      'Docker Hub publisher login failed',
    );
    return run(
      [
        'image',
        'copy',
        '--force-recursive',
        `${source}@${selected.digest}`,
        `${destination}:${tag}`,
      ],
      isolated,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function summary(line: string) {
  process.stdout.write(`${line}\n`);
  if (process.env['GITHUB_STEP_SUMMARY'])
    appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${line}\n\n`);
}

async function main() {
  const mode = process.argv[2];
  assert(mode === 'preview' || mode === 'exact' || mode === 'latest', 'Invalid mirror operation');
  const selected = selectedRelease(process.env, git);
  const hub = new PublicRegistry('docker.io');
  const ghcr = new PublicRegistry('ghcr.io');
  const reportGraph = async (registry: PublicRegistry) => {
    const platforms = await registry.verify(selected);
    summary(
      `${registry.host}/${repository}@${selected.digest}: linux/amd64 ${platforms['amd64']}, linux/arm64 ${platforms['arm64']}. Configs, layers, max provenance and SPDX subjects verified.`,
    );
    return platforms;
  };
  const deps: Dependencies = {
    releases: () => freshReleases(selected, git),
    tag: (tag) => hub.tag(tag),
    verify: () => reportGraph(hub),
  };
  summary(
    `v${selected.version} at ${selected.revision}. Workflow ${process.env['GITHUB_WORKFLOW_REF']} (implementation ${git(['rev-parse', 'HEAD'])}); run ${process.env['GITHUB_RUN_ID']}, attempt ${process.env['GITHUB_RUN_ATTEMPT']}. Working directory: ${process.cwd()}.`,
  );
  if (mode === 'preview') {
    deps.releases();
    if (process.env['GITHUB_EVENT_NAME'] === 'workflow_dispatch')
      assert.deepEqual(
        await ghcr.tag(selected.version),
        selected,
        'Approved digest differs from the public GHCR release tag',
      );
    await reportGraph(ghcr);
    summary(
      `Copy source ${source}@${selected.digest}. Only ${destination}:${selected.version} and eligible latest can change. Read back raw digests and the entire anonymous graph, then verify native offline discovery.`,
    );
  }
  await requirePublicHub();
  if (mode === 'preview') {
    for (const tag of [selected.version, 'latest']) {
      const plan = await planTag(tag, selected, deps);
      summary(
        `${destination}:${tag} — ${plan.action}: ${plan.detail}. Current digest: ${plan.previous?.digest ?? 'absent'}.`,
      );
    }
  } else {
    await publishTag(
      mode === 'exact' ? selected.version : 'latest',
      selected,
      deps,
      (tag) => copyImage(selected, tag, process.env),
      summary,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    summary(
      `Docker Hub mirror failed. ${error instanceof Error ? error.message : 'Unknown error'}. See docs/docker-hub-mirror.md for mirror-only recovery.`,
    );
    process.exitCode = 1;
  });
}
