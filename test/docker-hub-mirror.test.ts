import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  checkHistoryDispatch,
  checkHistoryTags,
  historicalImages,
} from '../.github/scripts/docker-hub-history.js';
import {
  compareVersions,
  copyImage,
  freshReleases,
  planTag,
  publishTag,
  selectedRelease,
} from '../.github/scripts/docker-hub-mirror.js';
import { type Identity, MissingContent } from '../.github/scripts/mirror-registry.js';
import {
  originalToolNames,
  releaseExpectations,
  smokeArguments,
  verifyDiscovery,
  withAnonymousDocker,
} from '../.github/scripts/smoke-release-image.js';

const version = '1.9.9';
const revision = 'a'.repeat(40);
const selected = { version, revision, digest: 'sha256:' + '1'.repeat(64) };
const other = { version: '1.8.0', revision: 'b'.repeat(40), digest: 'sha256:' + '2'.repeat(64) };
const repo = 'enthouan/simplelogin-mcp';
const manifest = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as {
  version: string;
  packages: [{ identifier: string }];
};
const tagMetadata = {
  ...manifest,
  version,
  packages: [{ ...manifest.packages[0], identifier: `ghcr.io/${repo}:${version}` }],
};

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: repo,
  GITHUB_EVENT_NAME: 'push',
  GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/release.yml@refs/tags/v${version}`,
  GITHUB_REF: 'refs/tags/v' + version,
  GITHUB_SHA: revision,
  RELEASE_TAG: 'v' + version,
  RELEASE_COMMIT: revision,
  RELEASE_IMAGE_DIGEST: selected.digest,
};
function releaseGit(args: string[]) {
  if (args[0] === 'rev-parse') return revision;
  if (args[0] === 'cat-file') return 'tag';
  if (args[0] === 'merge-base') return '';
  if (args[1] === revision + ':server.json') return JSON.stringify(tagMetadata);
  if (args[1] === revision + ':package.json') return JSON.stringify({ version });
  throw new Error('Unexpected Git command: ' + args.join(' '));
}

describe('mirror release identity', () => {
  it('binds the Docker outputs to a canonical annotated upstream push and validated release metadata', () => {
    expect(selectedRelease(env, releaseGit)).toEqual(selected);
    for (const overrides of [
      { GITHUB_ACTIONS: '' },
      { GITHUB_REPOSITORY: 'fork/simplelogin-mcp' },
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_EVENT_NAME: 'workflow_run' },
      { GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/ci.yml@refs/tags/v${version}` },
      { GITHUB_REF: 'refs/heads/main' },
      { RELEASE_TAG: 'v1.09.9' },
      { RELEASE_TAG: 'v1.9.9-rc.1' },
      { RELEASE_TAG: 'v1.9.9+meta' },
      { RELEASE_TAG: 'latest' },
      { RELEASE_IMAGE_DIGEST: 'sha256:invalid' },
      { RELEASE_COMMIT: 'main' },
      { RELEASE_COMMIT: other.revision },
      { GITHUB_REF: 'refs/tags/v1.2.3' },
    ])
      expect(() => selectedRelease({ ...env, ...overrides }, releaseGit)).toThrow();
  });

  it('permits trusted-main recovery, checks checkout/ancestry, and reads only tagged data', () => {
    const dispatch = {
      ...env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/docker-hub-mirror.yml@refs/heads/main`,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: other.revision,
    };
    const run = vi.fn((args: string[]) => (args[1] === 'HEAD' ? other.revision : releaseGit(args)));
    expect(selectedRelease(dispatch, run)).toEqual(selected);
    expect(run).toHaveBeenCalledWith([
      'merge-base',
      '--is-ancestor',
      'HEAD',
      'refs/remotes/origin/main',
    ]);
    expect(run).toHaveBeenCalledWith([
      'merge-base',
      '--is-ancestor',
      revision,
      'refs/remotes/origin/main',
    ]);
    expect(() => selectedRelease({ ...dispatch, GITHUB_REF: 'refs/heads/topic' }, run)).toThrow();
    expect(() => selectedRelease(dispatch, releaseGit)).toThrow('implementation');
    for (const [command, value] of [
      ['cat-file', 'commit'],
      ['show', '{}'],
    ]) {
      expect(() =>
        selectedRelease(dispatch, (args) => (args[0] === command ? value! : run(args))),
      ).toThrow();
    }
  });

  it('uses fresh remote annotated stable tags on protected main, including releases without a GitHub Release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirror-tag-test-'));
    const git = (args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Mirror test',
          '-c',
          'user.email=test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'tag.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args,
        ],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trimEnd();
    try {
      git(['init', '-b', 'main']);
      git(['remote', 'add', 'origin', dir]);
      git(['commit', '--allow-empty', '-m', 'selected']);
      const sha = git(['rev-parse', 'HEAD']);
      git(['tag', '-a', 'v' + version, '-m', 'selected']);
      git(['tag', '-a', 'v2.0.0', '-m', 'missing metadata']);
      writeFileSync(
        join(dir, 'server.json'),
        JSON.stringify({
          ...tagMetadata,
          version: '1.10.0',
          packages: [{ ...tagMetadata.packages[0], identifier: `ghcr.io/${repo}:1.10.0` }],
        }),
      );
      writeFileSync(join(dir, 'package.json'), '{"version":"1.10.0"}');
      git(['add', 'server.json', 'package.json']);
      git(['commit', '-m', 'newer']);
      git(['tag', '-a', 'v1.10.0', '-m', 'newer']);
      git(['tag', '-a', 'v3.0.0', '-m', 'mismatched metadata']);
      git(['tag', 'v4.0.0']);
      git(['switch', '-c', 'unmerged']);
      git(['commit', '--allow-empty', '-m', 'unmerged']);
      git(['tag', '-a', 'v5.0.0', '-m', 'other branch']);
      expect([...freshReleases({ ...selected, revision: sha }, git).keys()].sort()).toEqual([
        '1.10.0',
        version,
      ]);
      git(['tag', '-d', 'v' + version]);
      expect(() => freshReleases({ ...selected, revision: sha }, git)).toThrow(
        'missing or changed',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function state(initial: Record<string, Identity> = {}) {
  const tags = new Map(Object.entries(initial));
  const releases = vi.fn(
    () =>
      new Map([
        [version, revision],
        [other.version, other.revision],
      ]),
  );
  const tag = vi.fn((name: string) => Promise.resolve(tags.get(name) ?? null));
  const verify = vi.fn<() => Promise<Record<string, string>>>().mockResolvedValue({});
  const copy = vi.fn((name: string) => {
    tags.set(name, selected);
    return true;
  });
  const report = vi.fn<(line: string) => void>();
  const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const deps = { releases, tag, verify };
  const publish = (name: string) => publishTag(name, selected, deps, copy, report, wait);
  return { tags, deps, copy, publish, report, wait };
}

describe('pinned historical originals', () => {
  it('restricts the batch to the thirteen original exact releases through 1.0.2', () => {
    expect(historicalImages.map((image) => image.version)).toEqual([
      '0.1.0',
      '0.2.0',
      '0.3.0',
      '0.4.0',
      '0.5.0',
      '0.6.0',
      '0.7.0',
      '0.8.0',
      '0.8.1',
      '0.9.0',
      '1.0.0',
      '1.0.1',
      '1.0.2',
    ]);
    expect(new Set(historicalImages.map((image) => image.digest)).size).toBe(13);
    expect(
      historicalImages
        .filter((image) => image.sourceTag.startsWith('v'))
        .map((image) => image.version),
    ).toEqual(['0.1.0', '0.2.0']);
  });

  it('requires the approved anchor on protected main, using the normal recovery identity checks', () => {
    const anchor = {
      ...env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/docker-hub-mirror.yml@refs/heads/main`,
      RELEASE_TAG: 'v1.0.5',
      RELEASE_COMMIT: '810cdbaf161c085cfc7d5377d880cdd9ec92e848',
      RELEASE_IMAGE_DIGEST:
        'sha256:282b6580824c44dc1f229a9d16e7acf53201af4740ae8ca4ad7c82da4dde1a03',
    };
    const run = (args: string[]) => {
      if (args[0] === 'rev-parse')
        return args[1] === 'HEAD' ? env.GITHUB_SHA : anchor.RELEASE_COMMIT;
      if (args[1] === anchor.RELEASE_COMMIT + ':server.json')
        return JSON.stringify({
          ...manifest,
          version: '1.0.5',
          packages: [{ ...manifest.packages[0], identifier: `ghcr.io/${repo}:1.0.5` }],
        });
      if (args[1] === anchor.RELEASE_COMMIT + ':package.json') return '{"version":"1.0.5"}';
      return releaseGit(args);
    };
    expect(() => checkHistoryDispatch(anchor, run)).not.toThrow();
    for (const overrides of [
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_REF: 'refs/heads/feature' },
      { RELEASE_TAG: 'v1.0.6' },
      { RELEASE_COMMIT: other.revision },
      { RELEASE_IMAGE_DIGEST: other.digest },
    ])
      expect(() => checkHistoryDispatch({ ...anchor, ...overrides }, run)).toThrow();
  });

  it('rejects missing tags, changed annotated tag objects and changed peeled targets', () => {
    const [early, annotated] = [historicalImages[0]!, historicalImages[2]!];
    const refs = [
      `${early.revision}\trefs/tags/v${early.version}`,
      `${annotated.tagObject}\trefs/tags/v${annotated.version}`,
      `${annotated.revision}\trefs/tags/v${annotated.version}^{}`,
    ];
    const tags = (refs: string[]) => checkHistoryTags([early, annotated], () => refs.join('\n'));
    expect(tags(refs)).toEqual(
      new Map([
        [early.version, early.revision],
        [annotated.version, annotated.revision],
      ]),
    );
    for (let i = 0; i < refs.length; i++) {
      expect(() => tags(refs.filter((_, n) => i !== n))).toThrow();
      expect(() =>
        tags(refs.map((ref, n) => (n === i ? ref.replace(/^[a-f0-9]+/, revision) : ref))),
      ).toThrow();
    }
  });

  it('requires distinct literal tool names in releases that predate the generated catalog', () => {
    const source = "server.registerTool(\n  'lookup', description, {});";
    expect(originalToolNames([source, "server.registerTool('list', config);"])).toEqual([
      'lookup',
      'list',
    ]);
    for (const files of [[], [source, source], [source, 'server.registerTool(computed, config);']])
      expect(() => originalToolNames(files)).toThrow();
  });
});

describe('immutable exact tags and stable latest', () => {
  it('copies missing tags once, confirms each graph, and verifies identical retries without writes', async () => {
    const s = state();
    for (const tag of [version, 'latest', version, 'latest']) await s.publish(tag);
    expect(s.copy.mock.calls).toEqual([[version], ['latest']]);
    expect(s.deps.verify).toHaveBeenCalledTimes(4);
  });

  it('rejects exact or same-version alias conflicts and malformed reads before any write', async () => {
    for (const tag of [version, 'latest']) {
      const s = state({ [tag]: { ...selected, digest: other.digest } });
      await expect(s.publish(tag)).rejects.toThrow('conflict');
      s.deps.tag.mockRejectedValue(new Error('HTTP 403'));
      await expect(s.publish(tag)).rejects.toThrow('403');
      expect(s.copy).not.toHaveBeenCalled();
    }
  });

  it.each([version, 'latest'])(
    'repairs a confirmed missing descendant on identical %s, but stops on corrupt or unreadable content',
    async (tag) => {
      for (const error of [
        new MissingContent('missing blob'),
        new Error('digest mismatch'),
        new Error('HTTP 429'),
      ]) {
        const s = state({ [version]: selected, [tag]: selected });
        s.deps.verify.mockRejectedValueOnce(error);
        if (error instanceof MissingContent) {
          await s.publish(tag);
          expect(s.copy).toHaveBeenCalledExactlyOnceWith(tag);
          expect(s.deps.verify).toHaveBeenCalledTimes(2);
        } else {
          await expect(s.publish(tag)).rejects.toThrow(error.message);
          expect(s.copy).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('uses numeric major/minor/patch ordering including arbitrary-length components', () => {
    const sorted = [
      '10.0.0',
      '2.0.0',
      '1.9.100000000000000000000',
      '1.9.10',
      '1.10.0',
      '1.9.9',
    ].sort(compareVersions);
    expect(sorted).toEqual([
      '1.9.9',
      '1.9.10',
      '1.9.100000000000000000000',
      '1.10.0',
      '2.0.0',
      '10.0.0',
    ]);
  });

  it.each(['1.9.10', '1.10.0', '2.0.0'])(
    'preserves absent, stale and current latest owned by newer v%s',
    async (newer) => {
      for (const previous of [undefined, other, selected]) {
        const s = state(previous ? { latest: previous } : {});
        s.deps.releases.mockReturnValue(
          new Map([
            [version, revision],
            [newer, other.revision],
          ]),
        );
        await s.publish('latest');
        expect(s.copy).not.toHaveBeenCalled();
        expect(s.report.mock.calls.flat().join(' ')).toContain('Recover v' + newer);
      }
    },
  );

  it('advances a verified older alias and preserves a newer destination even if its remote tag vanished', async () => {
    const older = state({ latest: other, [other.version]: other, [version]: selected });
    await older.publish('latest');
    expect(older.tags.get('latest')).toEqual(selected);
    const newer = state({ latest: { ...other, version: '2.0.0' } });
    await newer.publish('latest');
    expect(newer.copy).not.toHaveBeenCalled();
    const orphan = state({ latest: other });
    await expect(orphan.publish('latest')).rejects.toThrow('differs from its exact');
    expect(orphan.copy).not.toHaveBeenCalled();
  });

  it('rechecks remote and alias ownership before writes, including after a slow partial-copy check', async () => {
    const missingExact = state();
    await expect(missingExact.publish('latest')).rejects.toThrow('Exact Docker Hub tag changed');
    expect(missingExact.copy).not.toHaveBeenCalled();
    for (const remote of [new Map<string, string>(), new Map([[version, other.revision]])]) {
      const s = state();
      s.deps.releases.mockReturnValueOnce(new Map([[version, revision]])).mockReturnValue(remote);
      await expect(s.publish(version)).rejects.toThrow('moved');
      expect(s.copy).not.toHaveBeenCalled();
    }
    const s = state();
    s.deps.releases.mockReturnValueOnce(new Map([[version, revision]])).mockReturnValue(
      new Map([
        [version, revision],
        ['2.0.0', other.revision],
      ]),
    );
    await s.publish('latest');
    expect(s.copy).not.toHaveBeenCalled();
    const changed = state();
    changed.deps.tag.mockResolvedValueOnce(null).mockResolvedValueOnce(other);
    await expect(changed.publish(version)).rejects.toThrow('changed before write');
    expect(changed.copy).not.toHaveBeenCalled();
  });

  it('confirms lost responses from public state and bounds delayed/missing read-back without repeating writes', async () => {
    const s = state();
    s.copy.mockImplementation((name) => {
      s.tags.set(name, selected);
      return false;
    });
    s.deps.verify.mockRejectedValueOnce(new MissingContent('blob propagation'));
    await s.publish(version);
    expect(s.copy).toHaveBeenCalledTimes(1);
    expect(s.report.mock.calls.flat().join(' ')).toContain('uncertain');
    const incomplete = state();
    incomplete.copy.mockReturnValue(false);
    await expect(incomplete.publish(version)).rejects.toThrow('unconfirmed');
    expect(incomplete.copy).toHaveBeenCalledTimes(1);
    expect(incomplete.wait).toHaveBeenCalledTimes(2);
  });

  it('stops on conflicting read-back, graph verification failure, or failed release lookup', async () => {
    const s = state();
    s.copy.mockImplementation((name) => {
      s.tags.set(name, other);
      return true;
    });
    await expect(s.publish(version)).rejects.toThrow('Conflicting read-back');
    expect(s.wait).not.toHaveBeenCalled();
    const invalid = state();
    invalid.deps.verify.mockRejectedValue(new Error('bad SBOM subject'));
    await expect(invalid.publish(version)).rejects.toThrow('bad SBOM');
    expect(invalid.copy).toHaveBeenCalledTimes(1);
    const missing = state();
    missing.deps.releases.mockReturnValue(new Map());
    await expect(planTag('latest', selected, missing.deps)).rejects.toThrow('missing or changed');
    expect(missing.deps.tag).not.toHaveBeenCalled();
  });
});

describe('publisher and anonymous smoke isolation', () => {
  const publisher = {
    DOCKERHUB_CONFIRMED_REPOSITORY: 'docker.io/' + repo,
    DOCKERHUB_USERNAME: 'mirror-account',
    DOCKERHUB_TOKEN: 'synthetic-token',
    DOCKER_CONFIG: '/unrelated',
    PATH: process.env['PATH'],
  };
  it.each(['success', 'login failure', 'copy failure'])(
    'isolates stdin credentials and removes only its private directory on %s',
    (outcome) => {
      let dir = '';
      const run = vi.fn((args: string[], env: NodeJS.ProcessEnv, input?: string) => {
        dir = env['HOME']!;
        expect(env).toEqual({
          HOME: dir,
          DOCKER_CONFIG: dir,
          REGCTL_CONFIG: join(dir, 'regctl.json'),
          PATH: publisher.PATH,
        });
        expect(existsSync(dir)).toBe(true);
        expect(args.join(' ')).not.toContain('synthetic-token');
        if (args[1] === 'login') {
          expect(input).toBe('synthetic-token');
          return outcome !== 'login failure';
        }
        expect(input).toBeUndefined();
        return args[1] !== 'copy' || outcome !== 'copy failure';
      });
      if (outcome === 'login failure')
        expect(() => copyImage(selected, version, publisher, run)).toThrow('login failed');
      else expect(copyImage(selected, version, publisher, run)).toBe(outcome === 'success');
      expect(existsSync(dir)).toBe(false);
      expect(run.mock.calls[0]?.[0]).toEqual([
        'config',
        'set',
        '--docker-cred=false',
        '--docker-cert=false',
      ]);
      if (outcome !== 'login failure')
        expect(run.mock.calls.at(-1)?.[0]).toEqual([
          'image',
          'copy',
          '--force-recursive',
          `ghcr.io/${repo}@${selected.digest}`,
          `docker.io/${repo}:${version}`,
        ]);
    },
  );
  it('fails before login when owner confirmation or credentials are missing', () => {
    for (const key of ['DOCKERHUB_CONFIRMED_REPOSITORY', 'DOCKERHUB_TOKEN', 'DOCKERHUB_USERNAME']) {
      const run = vi.fn();
      expect(() => copyImage(selected, version, { ...publisher, [key]: '' }, run)).toThrow();
      expect(run).not.toHaveBeenCalled();
    }
  });
  it('uses an independent helper-free Docker config for public pulls and cleans it on failure', async () => {
    let path = '';
    await expect(
      withAnonymousDocker((config) => {
        path = config;
        expect(JSON.parse(readFileSync(join(config, 'config.json'), 'utf8'))).toEqual({
          auths: { 'unused.invalid': {} },
        });
        return Promise.reject(new Error('pull failed'));
      }),
    ).rejects.toThrow('pull failed');
    expect(existsSync(path)).toBe(false);
  });
  it('accepts only the two intended digests and the local smoke image', () => {
    for (const host of ['docker.io', 'ghcr.io'])
      expect(smokeArguments(`${host}/${repo}@${selected.digest}`, 'check')).toContain(
        '--pull=never',
      );
    for (const image of [
      `docker.io/${repo}:latest`,
      `docker.io/${repo}@sha256:a`,
      `docker.io/other/repo@${selected.digest}`,
      `example.org/${repo}@${selected.digest}`,
      `docker.io/${repo}:1.9.9@${selected.digest}`,
    ])
      expect(() => smokeArguments(image, 'check')).toThrow();
  });
  it('uses the selected release version and generated catalog; rejects missing, extra, duplicate and malformed rows', () => {
    const read = (ref: string) =>
      ref === revision + ':package.json'
        ? '{"version":"0.8.0"}'
        : ref === revision + ':TOOL_CATALOG.md'
          ? '| Tool | Category |\n| --- | --- |\n| `historical_tool` | account |'
          : '';
    const expected = releaseExpectations(revision, read);
    expect(expected).toEqual({ version: '0.8.0', names: ['historical_tool'] });
    const info = { name: 'simplelogin-mcp', version: expected.version };
    verifyDiscovery(info, ['historical_tool'], expected.version, expected.names);
    for (const names of [[], ['extra'], ['historical_tool', 'historical_tool']])
      expect(() => verifyDiscovery(info, names, expected.version, expected.names)).toThrow();
    for (const row of ['| broken |', '| `historical_tool` |'])
      expect(() =>
        releaseExpectations(revision, (ref) => read(ref) + (ref.endsWith('.md') ? '\n' + row : '')),
      ).toThrow();
  });
});

interface Step {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  needs?: string;
  if?: string;
  uses?: string;
  permissions?: Record<string, string>;
  environment?: string;
  concurrency?: { group: string };
  with?: Record<string, string>;
  steps?: Step[];
}
function workflow(name: string) {
  return parse(
    readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'),
  ) as {
    on: Record<string, { inputs?: Record<string, { default?: boolean }> }>;
    jobs: Record<string, Job>;
    permissions: Record<string, string>;
    concurrency?: unknown;
  };
}
describe('mirror workflow wiring', () => {
  const release = workflow('release');
  const mirror = workflow('docker-hub-mirror');
  const preview = mirror.jobs['preview']!;
  const writer = mirror.jobs['mirror']!;
  const caller = release.jobs['mirror']!;
  it('fans out from verified GHCR without granting publishing permissions to the secondary workflow', () => {
    expect(caller.uses).toBe('./.github/workflows/docker-hub-mirror.yml');
    expect(caller.needs).toBe('docker');
    expect(release.jobs['registry']?.needs).toBe('docker');
    expect(caller.if).toBe(release.jobs['registry']?.if);
    expect(caller.with).toEqual({
      tag: '${{ github.ref_name }}',
      revision: '${{ needs.docker.outputs.revision }}',
      digest: '${{ needs.docker.outputs.digest }}',
    });
    expect(caller.permissions).toEqual({ contents: 'read' });
    expect(mirror.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify([caller, mirror])).not.toMatch(
      /continue-on-error|secrets: inherit|id-token|packages: write/,
    );
  });
  it('routes retries and backfills through a single writer with a distinct lock from GHCR', () => {
    expect(Object.keys(mirror.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    expect(mirror.on['workflow_dispatch']?.inputs?.['publish']?.default).toBe(false);
    expect(preview.if).toContain("github.repository == 'enthouan/simplelogin-mcp'");
    expect(preview.if).toContain("github.ref == 'refs/heads/main'");
    expect(writer.needs).toBe('preview');
    expect(writer.if).toBe("github.event_name == 'push' || inputs.publish");
    expect(release.concurrency).toBeUndefined();
    expect(mirror.concurrency).toBeUndefined();
    expect(writer.concurrency).toEqual({
      group: 'docker-hub-stable-mirror-${{ github.repository }}',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(writer.concurrency?.group).not.toBe(release.jobs['docker']?.concurrency?.group);
    expect(JSON.stringify(mirror)).not.toMatch(
      /build-push-action|mcp-publisher|mcp-registry\.ts publish|docker build /,
    );
  });
  it('keeps owner credentials in the writer steps, with trusted checkout, installation and preview first', () => {
    expect(writer.environment).toBe('dockerhub');
    const steps = writer.steps!;
    const privileged = steps.filter((step) => JSON.stringify(step).includes('secrets.'));
    expect(privileged.map((step) => step.run)).toEqual([
      'node .github/scripts/docker-hub-mirror.ts exact',
      'node .github/scripts/docker-hub-mirror.ts latest',
      'node .github/scripts/docker-hub-history.ts publish',
    ]);
    expect(mirror.on['workflow_dispatch']?.inputs?.['include_history']?.default).toBe(false);
    expect(mirror.on['workflow_call']?.inputs?.['include_history']).toBeUndefined();
    const historySteps = [...preview.steps!, ...steps].filter((step) =>
      /docker-hub-history\.ts|--history/.test(step.run ?? ''),
    );
    expect(historySteps).toHaveLength(3);
    for (const step of historySteps)
      expect(step.if).toBe("github.event_name == 'workflow_dispatch' && inputs.include_history");
    expect(JSON.stringify(preview)).not.toContain('secrets.');
    for (const job of [preview, writer]) {
      const checkout = job.steps?.find((step) => step.uses?.startsWith('actions/checkout@'));
      expect(checkout?.with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
    }
    const install = steps.find((step) => step.env?.['REGCTL_VERSION']);
    expect(install?.env).toEqual({
      REGCTL_VERSION: 'v0.11.7',
      REGCTL_SHA256: '3737fbbdd791e04e7a831640b681f3397a376498e80e2ad9b1b2d27296f239bc',
    });
    expect(install?.run).toContain('sha256sum --check --strict');
    const order = [
      steps.findIndex((step) => step.run?.includes('install --frozen-lockfile')),
      steps.indexOf(install!),
      steps.indexOf(privileged[0]!),
      steps.findIndex((step) => step.run?.includes('smoke-release-image.ts "docker.io/')),
      steps.indexOf(privileged[1]!),
    ];
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(
      preview.steps?.find((step) => step.run?.includes('smoke-release-image.ts "ghcr.io/'))?.if,
    ).toBe("github.event_name == 'workflow_dispatch'");
    expect(steps.at(-1)?.if).toBe('always()');
    const cleanup = steps.find((step) => step.run === 'rm -rf -- "$MIRROR_TEMP"');
    expect(cleanup?.if).toContain('always()');
    expect(cleanup?.env?.['MIRROR_TEMP']).toBe('${{ steps.regctl.outputs.directory }}');
  });
});
