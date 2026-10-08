import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Manifest,
  lookupImage,
  lookupReleaseTags,
  prepareImage,
  repairAliases,
  validateReleaseSource,
} from '../.github/scripts/mcp-registry.js';
import { smokeArguments, verifyDiscovery } from '../.github/scripts/smoke-release-image.js';
import { TOOL_NAMES } from '../src/tools/catalog.js';

const imageName = 'ghcr.io/enthouan/simplelogin-mcp';
const manifest: Manifest = { name: 'io.github.enthouan/simplelogin-mcp', version: '1.2.3' };
const digest = `sha256:${'a'.repeat(64)}`;
const otherDigest = `sha256:${'b'.repeat(64)}`;
const revision = 'c'.repeat(40);
const officialKey = 'io.modelcontextprotocol.registry/official';

describe('Annotated release source policy', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function repository() {
    const directory = mkdtempSync(join(tmpdir(), 'simplelogin-release-policy-test-'));
    directories.push(directory);
    const command = (program: string, args: string[]) =>
      execFileSync(
        program,
        [
          '-c',
          'user.name=Release test',
          '-c',
          'user.email=release-test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'tag.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args,
        ],
        { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    command('git', ['init', '-b', 'main']);
    command('git', ['commit', '--allow-empty', '-m', 'test release']);
    const commit = command('git', ['rev-parse', 'HEAD']).trim();
    command('git', ['update-ref', 'refs/remotes/origin/main', commit]);
    return { command, commit, env: { GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_SHA: commit } };
  }

  it('accepts an annotated tag of the checked-out main commit, including tag-object event SHAs', () => {
    const repo = repository();
    repo.command('git', ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3']);
    expect(validateReleaseSource(repo.env, repo.command)).toBe(repo.commit);
    repo.env.GITHUB_SHA = repo.command('git', ['rev-parse', 'v1.2.3']).trim();
    expect(validateReleaseSource(repo.env, repo.command)).toBe(repo.commit);
  });

  it('rejects lightweight tags', () => {
    const repo = repository();
    repo.command('git', ['tag', 'v1.2.3']);
    expect(() => validateReleaseSource(repo.env, repo.command)).toThrow('must be annotated');
  });

  it('reads fresh remote annotated stable tags, ignoring lightweight and non-stable tags', () => {
    const repo = repository();
    repo.command('git', [
      'remote',
      'add',
      'origin',
      repo.command('git', ['rev-parse', '--show-toplevel']).trim(),
    ]);
    repo.command('git', ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3']);
    repo.command('git', ['tag', 'v1.2.4']);
    repo.command('git', ['tag', '-a', 'v1.2.5-rc.1', '-m', 'prerelease']);
    repo.command('git', ['tag', '-a', 'v01.2.6', '-m', 'noncanonical']);
    repo.command('git', ['tag', '-a', 'other-tag', '-m', 'not a release']);
    expect(lookupReleaseTags(repo.command)).toEqual(new Map([['1.2.3', repo.commit]]));
    repo.command('git', ['tag', '-a', 'v1.2.10', '-m', 'v1.2.10']);
    expect(lookupReleaseTags(repo.command)).toEqual(
      new Map([
        ['1.2.10', repo.commit],
        ['1.2.3', repo.commit],
      ]),
    );
  });

  it('rejects malformed, duplicate or incomplete remote tag responses', () => {
    for (const raw of [
      'truncated response',
      `${revision}\trefs/tags/v1.2.3\n${revision}\trefs/tags/v1.2.3`,
      `${revision}\trefs/tags/v1.2.3^{}`,
    ]) {
      expect(() => lookupReleaseTags(() => raw)).toThrow();
    }
    expect(lookupReleaseTags(() => '')).toEqual(new Map());
  });

  it('rejects a tagged commit outside protected main', () => {
    const repo = repository();
    repo.command('git', ['commit', '--allow-empty', '-m', 'unmerged']);
    repo.command('git', ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3']);
    repo.env.GITHUB_SHA = repo.command('git', ['rev-parse', 'HEAD']).trim();
    expect(() => validateReleaseSource(repo.env, repo.command)).toThrow();
  });

  it('rejects mismatched checkout and event commits', () => {
    const repo = repository();
    repo.command('git', ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3']);
    repo.command('git', ['commit', '--allow-empty', '-m', 'next']);
    const next = repo.command('git', ['rev-parse', 'HEAD']).trim();
    expect(() => validateReleaseSource(repo.env, repo.command)).toThrow('Checkout differs');
    repo.command('git', ['switch', '--detach', repo.commit]);
    expect(() => validateReleaseSource({ ...repo.env, GITHUB_SHA: next }, repo.command)).toThrow(
      'Event differs',
    );
  });
});

describe('Anonymous exact-image lookup', () => {
  function requestFor(response: Response) {
    return vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'public-pull-token' }))
      .mockResolvedValueOnce(response);
  }

  it('hashes the public raw index and uses no stored credentials', async () => {
    const raw = JSON.stringify({ manifests: [] });
    const expected = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    const request = requestFor(
      new Response(raw, { headers: { 'docker-content-digest': expected } }),
    );
    await expect(lookupImage(manifest.version, request)).resolves.toBe(expected);
    expect(request.mock.calls[0]?.[0]).toBe(
      'https://ghcr.io/token?service=ghcr.io&scope=repository:enthouan/simplelogin-mcp:pull',
    );
    expect(request.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(request.mock.calls[1]?.[0]).toBe(
      `https://ghcr.io/v2/enthouan/simplelogin-mcp/manifests/${manifest.version}`,
    );
    expect(request.mock.calls[1]?.[1]?.redirect).toBe('error');
  });

  it('treats only a manifest 404 as absence', async () => {
    await expect(
      lookupImage(manifest.version, requestFor(new Response('', { status: 404 }))),
    ).resolves.toBeNull();
  });

  it.each([401, 403, 429, 500, 503])('fails closed on HTTP %i', async (status) => {
    await expect(
      lookupImage(manifest.version, requestFor(new Response('', { status }))),
    ).rejects.toThrow(`HTTP ${status}`);
  });

  it.each(['null', '{}', 'invalid'])(
    'rejects malformed successful image response %s',
    async (body) => {
      await expect(lookupImage(manifest.version, requestFor(new Response(body)))).rejects.toThrow();
    },
  );

  it('rejects a digest-header mismatch and missing anonymous authorization', async () => {
    await expect(
      lookupImage(
        manifest.version,
        requestFor(
          Response.json({ manifests: [] }, { headers: { 'docker-content-digest': digest } }),
        ),
      ),
    ).rejects.toThrow('digest mismatch');
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await expect(lookupImage(manifest.version, request)).rejects.toThrow('anonymous GHCR token');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a failed authorization or network request for a missing image', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(lookupImage(manifest.version, request)).rejects.toThrow('authorization failed');
    request.mockRejectedValue(new Error('network error'));
    await expect(lookupImage(manifest.version, request)).rejects.toThrow('network error');
  });
});

describe('Exact image reuse', () => {
  function dependencies() {
    return {
      lookupImage: vi.fn<(tag: string) => Promise<string | null>>().mockResolvedValue(digest),
      lookupVersion: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
      verifyImage: vi.fn<(digest: string) => void>(),
    };
  }

  it('permits a build only when no exact image or Registry version exists', async () => {
    const deps = dependencies();
    deps.lookupImage.mockResolvedValue(null);
    await expect(prepareImage(manifest, deps)).resolves.toBeNull();
    expect(deps.verifyImage).not.toHaveBeenCalled();
  });

  it('verifies and reuses the exact image even when Registry publication has not happened', async () => {
    const deps = dependencies();
    await expect(prepareImage(manifest, deps)).resolves.toBe(digest);
    expect(deps.verifyImage).toHaveBeenCalledExactlyOnceWith(digest);
  });

  it('fails instead of rebuilding an existing but invalid image', async () => {
    const deps = dependencies();
    deps.verifyImage.mockImplementation(() => {
      throw new Error('wrong release commit');
    });
    await expect(prepareImage(manifest, deps)).rejects.toThrow('wrong release commit');
  });

  it('will not rebuild an image referenced by an already published Registry version', async () => {
    const deps = dependencies();
    deps.lookupVersion.mockResolvedValue({
      server: manifest,
      _meta: { [officialKey]: { status: 'active' } },
    });
    deps.lookupImage.mockResolvedValue(null);
    await expect(prepareImage(manifest, deps)).rejects.toThrow('do not rebuild');
  });

  it.each(['deleted', 'conflict', 'unavailable'])(
    'stops before the image build on Registry %s',
    async (scenario) => {
      const deps = dependencies();
      if (scenario === 'unavailable') deps.lookupVersion.mockRejectedValue(new Error('HTTP 503'));
      else
        deps.lookupVersion.mockResolvedValue({
          server: scenario === 'conflict' ? { ...manifest, description: 'different' } : manifest,
          _meta: { [officialKey]: { status: scenario === 'deleted' ? 'deleted' : 'active' } },
        });
      await expect(prepareImage(manifest, deps)).rejects.toThrow();
      expect(deps.lookupImage).not.toHaveBeenCalled();
    },
  );
});

describe('Release alias recovery', () => {
  const shaTag = `sha-${revision}`;
  function dependencies(initial: Record<string, string> = {}, currentVersion = '1.2.2') {
    const releaseTags = vi.fn(() => new Map([[manifest.version, revision]]));
    const aliases = new Map(Object.entries(initial));
    const lookup = vi.fn((tag: string) => Promise.resolve(aliases.get(tag) ?? null));
    const identity = vi.fn(() => ({ version: currentVersion, revision }));
    const command = vi.fn((program: string, args: string[]) => {
      expect(program).toBe('docker');
      expect(args.slice(0, 3)).toEqual(['buildx', 'imagetools', 'create']);
      expect(args.at(-1)).toBe(`${imageName}@${digest}`);
      for (let i = 3; i < args.length - 1; i += 2) {
        expect(args[i]).toBe('--tag');
        const tag = args[i + 1]!.slice(imageName.length + 1);
        expect(tag).not.toBe(manifest.version);
        aliases.set(tag, digest);
      }
      return '';
    });
    return { releaseTags, lookup, identity, command, aliases };
  }

  it('repairs both missing aliases using one carbon copy of the verified index', async () => {
    const deps = dependencies();
    await repairAliases(manifest, digest, revision, deps);
    expect(deps.command).toHaveBeenCalledTimes(1);
    expect(deps.aliases).toEqual(
      new Map([
        [shaTag, digest],
        ['1.2', digest],
      ]),
    );
  });

  it('does nothing when all aliases already match', async () => {
    const deps = dependencies({ [shaTag]: digest, '1.2': digest });
    await repairAliases(manifest, digest, revision, deps);
    expect(deps.command).not.toHaveBeenCalled();
    expect(deps.identity).not.toHaveBeenCalled();
  });

  it('advances an older minor alias but preserves a newer one on an old release rerun', async () => {
    for (const current of ['1.2.2', '1.2.4', '1.2.100000000000000000000']) {
      const deps = dependencies({ '1.2': otherDigest }, current);
      await repairAliases(manifest, digest, revision, deps);
      expect(deps.aliases.get(shaTag)).toBe(digest);
      expect(deps.aliases.get('1.2')).toBe(current === '1.2.2' ? digest : otherDigest);
    }
  });

  it.each(['1.2.4', '1.2.10', '1.2.100000000000000000000'])(
    'leaves missing or stale minor aliases to the newer remote release %s',
    async (newer) => {
      const initialAliases: Record<string, string>[] = [{}, { '1.2': otherDigest }];
      for (const initial of initialAliases) {
        const deps = dependencies(initial);
        deps.releaseTags.mockReturnValue(
          new Map([
            [manifest.version, revision],
            [newer, 'd'.repeat(40)],
          ]),
        );
        await repairAliases(manifest, digest, revision, deps);
        expect(deps.aliases.get(shaTag)).toBe(digest);
        expect(deps.aliases.get('1.2')).toBe(initial['1.2']);
        expect(deps.lookup).not.toHaveBeenCalledWith('1.2');
        expect(deps.releaseTags).toHaveBeenCalledTimes(1);
        expect(deps.command.mock.calls[0]?.[1]).toEqual([
          'buildx',
          'imagetools',
          'create',
          '--tag',
          `${imageName}:${shaTag}`,
          `${imageName}@${digest}`,
        ]);
      }
    },
  );

  it('ignores other minor lines, older tags and noncanonical versions for minor ownership', async () => {
    const deps = dependencies();
    deps.releaseTags.mockReturnValue(
      new Map([
        [manifest.version, revision],
        ...['1.2.2', '1.3.0', '2.2.10', '1.2.4-rc.1', '1.2.04'].map(
          (version) => [version, revision] as const,
        ),
      ]),
    );
    await repairAliases(manifest, digest, revision, deps);
    expect(deps.aliases.get('1.2')).toBe(digest);
  });

  it.each([undefined, 'd'.repeat(40)])(
    'stops before alias reads or writes if the remote release tag is missing or moved (%s)',
    async (remoteRevision) => {
      const deps = dependencies();
      deps.releaseTags.mockReturnValue(
        new Map(remoteRevision ? [[manifest.version, remoteRevision]] : []),
      );
      await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow(
        'different remote commit',
      );
      expect(deps.lookup).not.toHaveBeenCalled();
      expect(deps.command).not.toHaveBeenCalled();
    },
  );

  it('fails closed when remote release tags cannot be read', async () => {
    const deps = dependencies();
    deps.releaseTags.mockImplementation(() => {
      throw new Error('remote unavailable');
    });
    await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow(
      'remote unavailable',
    );
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.command).not.toHaveBeenCalled();
  });

  it('recovers a partial alias push and handles the same-commit main image', async () => {
    const deps = dependencies({ [shaTag]: otherDigest, '1.2': digest }, 'latest');
    await repairAliases(manifest, digest, revision, deps);
    expect(deps.aliases.get(shaTag)).toBe(digest);
    expect(deps.command.mock.calls[0]?.[1]).toEqual([
      'buildx',
      'imagetools',
      'create',
      '--tag',
      `${imageName}:${shaTag}`,
      `${imageName}@${digest}`,
    ]);
  });

  it.each(['1.2.3', '1.3.1', 'latest', '1.2.4-rc.1'])(
    'refuses conflicting or invalid minor version %s before any write',
    async (current) => {
      const deps = dependencies({ '1.2': otherDigest }, current);
      await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow();
      expect(deps.command).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite a commit alias owned by another revision or release', async () => {
    const deps = dependencies({ [shaTag]: otherDigest }, 'latest');
    deps.identity.mockReturnValue({ version: 'latest', revision: 'd'.repeat(40) });
    await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow(
      'different source',
    );
    deps.identity.mockReturnValue({ version: manifest.version, revision });
    await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow(
      'conflicts with a release',
    );
    expect(deps.command).not.toHaveBeenCalled();
  });

  it('fails on an ambiguous read without writing and on unconfirmed copy without rewriting', async () => {
    const deps = dependencies();
    deps.lookup.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow('HTTP 503');
    expect(deps.command).not.toHaveBeenCalled();
    deps.lookup.mockResolvedValue(null);
    await expect(repairAliases(manifest, digest, revision, deps)).rejects.toThrow('not confirmed');
    expect(deps.command).toHaveBeenCalledTimes(1);
  });
});

describe('Offline release image smoke contract', () => {
  it('runs the immutable image with synthetic credentials, no networking and no health override', () => {
    const args = smokeArguments(`${imageName}@${digest}`, 'unique-smoke-name');
    expect(args).toContain('--network=none');
    expect(args).toContain('--pull=never');
    expect(args).toContain('SL_API_KEY=registry-smoke-not-a-real-key');
    expect(args).not.toContain('--no-healthcheck');
    expect(args.at(-1)).toBe(`${imageName}@${digest}`);
    expect(() => smokeArguments(`${imageName}:latest`, 'test')).toThrow('immutable');
  });

  it('requires the exact server identity and entire tool catalog without missing, extra or duplicate tools', () => {
    const info = { name: 'simplelogin-mcp', version: manifest.version };
    expect(() => verifyDiscovery(info, [...TOOL_NAMES].reverse(), manifest.version)).not.toThrow();
    for (const tools of [
      TOOL_NAMES.slice(1),
      [...TOOL_NAMES, 'unexpected'],
      [...TOOL_NAMES, TOOL_NAMES[0]!],
    ]) {
      expect(() => verifyDiscovery(info, tools, manifest.version)).toThrow('catalog mismatch');
    }
    expect(() =>
      verifyDiscovery({ ...info, version: '0.0.0' }, TOOL_NAMES, manifest.version),
    ).toThrow('identity mismatch');
    expect(() => verifyDiscovery(undefined, TOOL_NAMES, manifest.version)).toThrow(
      'identity mismatch',
    );
  });
});
