// The owner approved only these immutable originals for the one-time historical backfill.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  copyImage,
  git,
  planTag,
  publishTag,
  selectedRelease,
  summary,
} from './docker-hub-mirror.ts';
import {
  digestPattern,
  object,
  repository,
  revisionPattern,
  versionPattern,
} from './mcp-registry.ts';
import { type Identity, PublicRegistry, requirePublicHub } from './mirror-registry.ts';

export interface HistoricalImage extends Identity {
  sourceTag: string;
  tagObject: string;
}
export const historicalImages: HistoricalImage[] = (
  JSON.parse(
    readFileSync(new URL('../docker-hub-history.json', import.meta.url), 'utf8'),
  ) as unknown[]
).map((row) => {
  const { sourceTag, tagObject, revision, digest } = object(row);
  assert(typeof sourceTag === 'string');
  const version = sourceTag.replace(/^v/, '');
  assert(versionPattern.test(version) && typeof digest === 'string' && digestPattern.test(digest));
  assert(typeof revision === 'string' && revisionPattern.test(revision));
  assert(typeof tagObject === 'string' && revisionPattern.test(tagObject));
  return { version, sourceTag, tagObject, revision, digest };
});

const anchor: Identity = {
  version: '1.0.5',
  revision: '810cdbaf161c085cfc7d5377d880cdd9ec92e848',
  digest: 'sha256:282b6580824c44dc1f229a9d16e7acf53201af4740ae8ca4ad7c82da4dde1a03',
};

export function checkHistoryDispatch(env: NodeJS.ProcessEnv, run: typeof git) {
  assert(env['GITHUB_EVENT_NAME'] === 'workflow_dispatch', 'History requires a manual dispatch');
  assert.deepEqual(
    selectedRelease(env, run),
    anchor,
    'History is pinned to the approved v1.0.5 recovery',
  );
}

export function checkHistoryTags(images: HistoricalImage[], run: typeof git) {
  const remote = new Map(
    run(['ls-remote', '--tags', 'origin', 'refs/tags/v*'])
      .split('\n')
      .map((line) => {
        const [sha, ref] = line.split('\t');
        return [ref, sha] as const;
      }),
  );
  for (const image of images) {
    const ref = `refs/tags/v${image.version}`;
    assert.equal(remote.get(ref), image.tagObject, `Remote ${ref} changed`);
    const peeled = remote.get(`${ref}^{}`);
    assert.equal(peeled ?? image.tagObject, image.revision, `Remote ${ref} commit changed`);
  }
  return new Map(images.map((image) => [image.version, image.revision]));
}

async function history(mode: string) {
  assert(mode === 'preview' || mode === 'publish', 'Invalid historical operation');
  checkHistoryDispatch(process.env, git);
  checkHistoryTags(historicalImages, git);
  await requirePublicHub();
  const source = new PublicRegistry('ghcr.io');
  const hub = new PublicRegistry('docker.io');
  for (const image of historicalImages) {
    const { version, revision, digest, sourceTag } = image;
    const selected = { version, revision, digest };
    git(['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']);
    assert.equal(object(JSON.parse(git(['show', `${revision}:package.json`])))['version'], version);
    assert.equal(await source.historicalTagDigest(sourceTag), digest, `GHCR ${sourceTag} changed`);
    const requireSbom = version === '1.0.1' || version === '1.0.2';
    const verify = async (registry: PublicRegistry) => {
      const platforms = await registry.verifyHistorical(selected, sourceTag, requireSbom);
      summary(
        `${registry.host}/${repository}@${digest}: v${version}, commit ${revision}, linux/amd64 ${platforms['amd64']}, linux/arm64 ${platforms['arm64']}; original graph verified.`,
      );
      return platforms;
    };
    const deps = {
      releases: () => checkHistoryTags([image], git),
      tag: async (tag: string) => {
        assert.equal(tag, version, 'Historical writes are exact-version only');
        const existing = await hub.historicalTagDigest(tag);
        if (existing === null) return null;
        assert.equal(existing, digest, `Immutable conflict at docker.io/${repository}:${tag}`);
        return selected;
      },
      verify: () => verify(hub),
    };
    if (mode === 'preview') {
      await verify(source);
      const plan = await planTag(version, selected, deps);
      summary(
        `docker.io/${repository}:${version} — ${plan.action}: ${plan.detail}. Prior digest: ${plan.previous?.digest ?? 'absent'}.`,
      );
    } else {
      await publishTag(
        version,
        selected,
        deps,
        (tag) => copyImage(selected, tag, process.env),
        summary,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  history(process.argv[2] ?? '').catch((error: unknown) => {
    summary(
      `Historical backfill failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exitCode = 1;
  });
}
