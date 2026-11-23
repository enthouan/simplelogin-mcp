import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  MissingContent,
  PublicRegistry,
  requirePublicHub,
} from '../.github/scripts/mirror-registry.js';

const revision = 'a'.repeat(40);
const version = '1.0.5';
const manifestType = 'application/vnd.oci.image.manifest.v1+json';
const indexType = 'application/vnd.oci.image.index.v1+json';
const source = 'https://github.com/enthouan/simplelogin-mcp';
const hash = (raw: string) => 'sha256:' + createHash('sha256').update(raw).digest('hex');
const spdx = 'https://spdx.dev/Document';
const slsa = 'https://slsa.dev/provenance/v1';

interface FixtureOptions {
  metadata?: Record<string, string>;
  runtime?: Record<string, string>;
  subject?: string;
  ociSubject?: string;
  target?: string;
  predicateType?: string;
  statementTypes?: Record<string, string>;
  provenance?: unknown;
  sbom?: unknown;
  omit?: string;
  omitOn?: string;
  duplicateArch?: boolean;
  mediaType?: string;
  badSize?: boolean;
}
// Store the original bytes, including noncanonical JSON whitespace, in a fake distribution API.
function graph(opts: FixtureOptions = {}) {
  const resources = new Map<string, string>();
  const labels = {
    'io.modelcontextprotocol.server.name': 'io.github.enthouan/simplelogin-mcp',
    'org.opencontainers.image.licenses': 'MIT',
    'org.opencontainers.image.source': source,
    'org.opencontainers.image.version': version,
    'org.opencontainers.image.revision': revision,
  };
  const put = (kind: string, mediaType: string, body: unknown) => {
    const raw = JSON.stringify(body, null, 2) + '\n';
    const digest = hash(raw);
    resources.set(kind + '/' + digest, raw);
    return { mediaType, digest, size: Buffer.byteLength(raw) };
  };
  const manifests = [];
  const platforms: Record<string, string> = {};
  for (const architecture of ['amd64', 'arm64']) {
    const platform = { os: 'linux', architecture };
    const config = put('blobs', 'application/vnd.oci.image.config.v1+json', {
      ...platform,
      config: {
        Cmd: ['node', 'dist/index.js'],
        User: 'node',
        Healthcheck: { Test: ['CMD', 'node', 'dist/healthcheck.js'] },
        Labels: { ...labels, ...opts.runtime },
      },
    });
    const layer = put(
      'blobs',
      'application/vnd.oci.image.layer.v1.tar+gzip',
      'compressed content ' + architecture,
    );
    const image = put('manifests', manifestType, {
      schemaVersion: 2,
      mediaType: manifestType,
      config,
      layers: [{ ...layer, size: opts.badSize ? 1 : layer.size }],
    });
    platforms[architecture] = image.digest;
    manifests.push({ ...image, platform });
    if (opts.duplicateArch && architecture === 'amd64') manifests.push({ ...image, platform });
    const layers = [slsa, spdx]
      .filter(
        (type) => type !== opts.omit || (opts.omitOn !== undefined && opts.omitOn !== architecture),
      )
      .map((type) => ({
        ...put('blobs', 'application/vnd.in-toto+json', {
          _type: 'https://in-toto.io/Statement/v1',
          subject: [
            {
              name: 'pkg:docker/ghcr.io/enthouan/simplelogin-mcp',
              digest: { sha256: opts.subject ?? image.digest.slice(7) },
            },
          ],
          predicateType: opts.statementTypes?.[type] ?? type,
          predicate:
            type === slsa
              ? (opts.provenance ?? {
                  buildDefinition: {
                    internalParameters: { buildConfig: { llbDefinition: ['original build'] } },
                  },
                })
              : (opts.sbom ?? { SPDXID: 'SPDXRef-DOCUMENT', spdxVersion: 'SPDX-2.3' }),
        }),
        annotations: {
          'in-toto.io/predicate-type': opts.predicateType ?? opts.statementTypes?.[type] ?? type,
        },
      }));
    const att = put('manifests', manifestType, {
      schemaVersion: 2,
      mediaType: manifestType,
      config: put('blobs', 'application/vnd.oci.empty.v1+json', {}),
      layers,
      subject: { ...image, digest: opts.ociSubject ?? image.digest },
    });
    manifests.push({
      ...att,
      platform: { os: 'unknown', architecture: 'unknown' },
      annotations: {
        'vnd.docker.reference.digest': opts.target ?? image.digest,
        'vnd.docker.reference.type': 'attestation-manifest',
      },
    });
  }
  const index = put('manifests', indexType, {
    schemaVersion: 2,
    mediaType: opts.mediaType ?? indexType,
    annotations: { ...labels, ...opts.metadata },
    manifests,
  });
  resources.set('manifests/' + version, resources.get('manifests/' + index.digest)!);
  const request = vi.fn<typeof fetch>((url, init) => {
    const parsed = new URL(url instanceof Request ? url.url : String(url));
    if (parsed.hostname === 'auth.docker.io') {
      expect(init?.headers).toBeUndefined();
      return Promise.resolve(Response.json({ token: 'anonymous-token' }));
    }
    expect(parsed.hostname).toBe('registry-1.docker.io');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer anonymous-token');
    const path = parsed.pathname.replace('/v2/enthouan/simplelogin-mcp/', '');
    const raw = resources.get(path);
    return Promise.resolve(
      raw === undefined
        ? Response.json(
            { errors: [{ code: path.startsWith('blobs/') ? 'BLOB_UNKNOWN' : 'MANIFEST_UNKNOWN' }] },
            { status: 404 },
          )
        : new Response(raw, { headers: { 'docker-content-digest': hash(raw) } }),
    );
  });
  return {
    registry: new PublicRegistry('docker.io', request),
    selected: { version, revision, digest: index.digest },
    platforms,
    resources,
    request,
  };
}

describe('anonymous OCI mirror verification', () => {
  it('checks exact index bytes, every platform, config, layer, attestation manifest and subject', async () => {
    const { registry, selected, platforms, request, resources } = graph();
    expect(await registry.tag(version)).toEqual(selected);
    expect(await registry.verify(selected)).toEqual(platforms);
    const reads = new Set(
      request.mock.calls
        .map(
          ([url]) => (url instanceof Request ? url.url : String(url)).split('/simplelogin-mcp/')[1],
        )
        .filter(Boolean),
    );
    expect(reads).toEqual(new Set(resources.keys()));
    expect(await registry.tag('latest')).toBeNull();
  });

  it('detects any missing descendant behind an identical digest, including a single platform layer', async () => {
    for (const key of graph().resources.keys()) {
      if (!key.includes('sha256:')) continue;
      const { registry, selected, resources } = graph();
      resources.delete(key);
      await expect(registry.verify(selected)).rejects.toBeInstanceOf(MissingContent);
    }
  });

  it('detects corrupt bytes even when the registry returns a self-consistent header', async () => {
    const { registry, selected, resources } = graph();
    resources.set(
      [...resources.keys()].find((k) => k.startsWith('blobs/'))!,
      '{}',
    );
    await expect(registry.verify(selected)).rejects.toThrow('Content digest mismatch');
  });

  it.each<[string, FixtureOptions]>([
    ['missing SBOM', { omit: spdx }],
    ['missing arm64 SBOM', { omit: spdx, omitOn: 'arm64' }],
    ['missing provenance', { omit: slsa }],
    ['mismatched statement subject', { subject: 'd'.repeat(64) }],
    ['changed OCI subject', { ociSubject: 'sha256:' + 'd'.repeat(64) }],
    ['orphaned attestation', { target: 'sha256:' + 'd'.repeat(64) }],
    ['mislabeled predicate', { predicateType: 'unknown' }],
    ['arbitrary provenance predicate', { statementTypes: { [slsa]: 'provenance' } }],
    ['arbitrary SBOM predicate', { statementTypes: { [spdx]: 'sbom' } }],
    [
      'min-mode provenance',
      { provenance: { buildDefinition: { internalParameters: { buildConfig: {} } } } },
    ],
    ['malformed SBOM', { sbom: { SPDXID: 'SPDXRef-other' } }],
    ['flattened index', { mediaType: manifestType }],
    ['duplicate platform', { duplicateArch: true }],
    ['descriptor size mismatch', { badSize: true }],
    ['index owner', { metadata: { 'io.modelcontextprotocol.server.name': 'other' } }],
    ['index license', { metadata: { 'org.opencontainers.image.licenses': 'other' } }],
    ['platform source', { runtime: { 'org.opencontainers.image.source': 'other' } }],
    ['platform revision', { runtime: { 'org.opencontainers.image.revision': 'b'.repeat(40) } }],
    ['platform version', { runtime: { 'org.opencontainers.image.version': '1.0.6' } }],
  ])('rejects %s even with a new valid index digest', async (_, options) => {
    const { registry, selected } = graph(options);
    await expect(registry.verify(selected)).rejects.toThrow();
  });

  it.each([401, 403, 404, 200])(
    'rejects auth failures or ambiguous successful/absent tag reads (%i)',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: 'anonymous' }))
        .mockResolvedValueOnce(new Response('not a registry response', { status }));
      await expect(new PublicRegistry('docker.io', request).tag(version)).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([429, 503, 'network'])(
    'bounds transient %s reads without treating them as absence',
    async (status) => {
      const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
      const read = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: 'anonymous' }));
      if (typeof status === 'number')
        read.mockImplementation(() => Promise.resolve(new Response(null, { status })));
      else read.mockRejectedValue(new TypeError('network'));
      await expect(new PublicRegistry('docker.io', read, wait).tag(version)).rejects.toThrow();
      expect(read).toHaveBeenCalledTimes(4);
      expect(wait.mock.calls).toEqual([[1000], [2000]]);
    },
  );

  it('requires the specific, already public Docker Hub repository before writing', async () => {
    const record = { name: 'simplelogin-mcp', namespace: 'enthouan', is_private: false };
    await requirePublicHub(() => Promise.resolve(Response.json(record)));
    for (const response of [
      Response.json({}, { status: 404 }),
      Response.json({ ...record, is_private: true }),
      Response.json({ ...record, namespace: 'other' }),
    ]) {
      await expect(requirePublicHub(() => Promise.resolve(response))).rejects.toThrow();
    }
  });

  it('honors Retry-After and defers long rate limits to a later mirror run', async () => {
    for (const seconds of [4, 300]) {
      const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
      const read = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: 'anonymous' }))
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { 'retry-after': String(seconds) } }),
        )
        .mockResolvedValueOnce(
          Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 }),
        );
      const tag = new PublicRegistry('docker.io', read, wait).tag(version);
      if (seconds === 4) {
        await expect(tag).resolves.toBeNull();
        expect(wait).toHaveBeenCalledExactlyOnceWith(4000);
      } else {
        await expect(tag).rejects.toThrow('requested delay');
        expect(wait).not.toHaveBeenCalled();
      }
    }
  });

  it('confirms an empty Hub namespace separately and refuses a private or missing repository', async () => {
    for (const provisioned of [true, false]) {
      const read = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: 'anonymous' }))
        .mockResolvedValueOnce(
          Response.json({ errors: [{ code: 'NAME_UNKNOWN' }] }, { status: 404 }),
        )
        .mockResolvedValueOnce(
          provisioned
            ? Response.json({ name: 'simplelogin-mcp', namespace: 'enthouan', is_private: false })
            : Response.json({}, { status: 404 }),
        );
      const tag = new PublicRegistry('docker.io', read).tag(version);
      if (provisioned) await expect(tag).resolves.toBeNull();
      else await expect(tag).rejects.toThrow('provisioning');
      expect(read.mock.calls[2]?.[0]).toBe(
        'https://hub.docker.com/v2/namespaces/enthouan/repositories/simplelogin-mcp',
      );
    }
  });
});
