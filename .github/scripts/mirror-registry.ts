// Read the release graph anonymously. Registry tokens here only grant public pull access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  digestPattern,
  object,
  repository,
  revisionPattern,
  serverName,
  versionPattern,
} from './mcp-registry.ts';

const indexType = 'application/vnd.oci.image.index.v1+json';
const manifestType = 'application/vnd.oci.image.manifest.v1+json';
const endpoints = {
  'ghcr.io': ['https://ghcr.io', 'https://ghcr.io/token?service=ghcr.io'],
  'docker.io': [
    'https://registry-1.docker.io',
    'https://auth.docker.io/token?service=registry.docker.io',
  ],
} as const;

export class MissingContent extends Error {}
class TransientRead extends Error {
  retryAfterMs = 0;
}

export async function retryRead<T>(
  read: () => Promise<T>,
  retryMissing = false,
  wait: (ms: number) => Promise<void> = delay,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      // The outer write read-back handles propagation; individual requests handle transport.
      if (
        attempt >= 2 ||
        !(retryMissing ? error instanceof MissingContent : error instanceof TransientRead)
      )
        throw error;
      await wait(
        Math.max(1000 * 2 ** attempt, error instanceof TransientRead ? error.retryAfterMs : 0),
      );
    }
  }
}

async function publicGet(
  request: typeof fetch,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await request(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      ...options,
    });
  } catch {
    throw new TransientRead('Network failure during anonymous registry read');
  }
  if ([408, 429].includes(response.status) || response.status >= 500) {
    await response.body?.cancel();
    const error = new TransientRead(`Anonymous read returned HTTP ${response.status}`);
    const after = response.headers.get('retry-after');
    if (after) {
      const ms = /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
      if (ms > 30_000)
        throw new Error(`${error.message}. Retry after the server's requested delay.`);
      if (ms > 0) error.retryAfterMs = ms;
    }
    throw error;
  }
  return response;
}

async function publicJson(response: Response) {
  const raw = await response.text().catch(() => {
    throw new TransientRead('Interrupted anonymous JSON response');
  });
  return object(JSON.parse(raw));
}

export async function requirePublicHub(request: typeof fetch = fetch): Promise<void> {
  await retryRead(async () => {
    const response = await publicGet(
      request,
      'https://hub.docker.com/v2/namespaces/enthouan/repositories/simplelogin-mcp',
    );
    assert(
      response.ok,
      `Public Docker Hub repository lookup failed (HTTP ${response.status}). Confirm owner provisioning.`,
    );
    const repo = await publicJson(response);
    assert(
      repo['namespace'] === 'enthouan' &&
        repo['name'] === 'simplelogin-mcp' &&
        repo['is_private'] === false,
      'Expected the provisioned public Docker Hub repository',
    );
  });
}

interface Descriptor {
  digest: string;
  size: number;
  mediaType: string;
}
function descriptor(value: unknown): Descriptor {
  const { digest, size, mediaType } = object(value);
  assert(typeof digest === 'string' && digestPattern.test(digest), 'Invalid descriptor digest');
  assert(
    typeof size === 'number' && Number.isSafeInteger(size) && size >= 0,
    'Invalid descriptor size',
  );
  assert(typeof mediaType === 'string' && mediaType.length > 0, 'Missing descriptor media type');
  return { digest, size, mediaType };
}

export interface Identity {
  version: string;
  revision: string;
  digest: string;
}

function imageLabels(value: unknown) {
  const labels = object(value);
  assert(
    labels['io.modelcontextprotocol.server.name'] === serverName,
    'MCP image ownership mismatch',
  );
  assert(
    labels['org.opencontainers.image.source'] === `https://github.com/${repository}`,
    'Image source mismatch',
  );
  assert(labels['org.opencontainers.image.licenses'] === 'MIT', 'Image license mismatch');
  const version = labels['org.opencontainers.image.version'];
  const revision = labels['org.opencontainers.image.revision'];
  assert(typeof version === 'string' && versionPattern.test(version), 'Invalid image version');
  assert(typeof revision === 'string' && revisionPattern.test(revision), 'Invalid image revision');
  return { version, revision };
}

function objects(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value), 'Expected a descriptor or subject list');
  return value.map(object);
}

function attestation(
  layer: Record<string, unknown>,
  value: unknown,
  subject: string,
  requireMaxProvenance: boolean,
): 'provenance' | 'sbom' | undefined {
  const statement = object(value);
  assert(
    statement['_type'] === 'https://in-toto.io/Statement/v0.1' ||
      statement['_type'] === 'https://in-toto.io/Statement/v1',
    'Invalid in-toto statement',
  );
  const subjects = objects(statement['subject']);
  assert(
    subjects.length > 0 &&
      subjects.every(
        (s) =>
          typeof s['name'] === 'string' &&
          s['name'].length > 0 &&
          object(s['digest'])['sha256'] === subject.slice(7),
      ),
    'Attestation subject differs from platform manifest',
  );
  const type = statement['predicateType'];
  assert(
    typeof type === 'string' && object(layer['annotations'])['in-toto.io/predicate-type'] === type,
    'Attestation predicate type mismatch',
  );
  const predicate = object(statement['predicate']);
  if (type === 'https://spdx.dev/Document') {
    assert(
      predicate['SPDXID'] === 'SPDXRef-DOCUMENT' &&
        typeof predicate['spdxVersion'] === 'string' &&
        /^SPDX-\d+\.\d+$/.test(predicate['spdxVersion']),
      'Invalid SPDX SBOM',
    );
    return 'sbom';
  }
  if (type === 'https://slsa.dev/provenance/v0.2' || type === 'https://slsa.dev/provenance/v1') {
    if (requireMaxProvenance) {
      const config = type.endsWith('/v1')
        ? object(object(predicate['buildDefinition'])['internalParameters'])['buildConfig']
        : predicate['buildConfig'];
      assert(Object.keys(object(config)).length > 0, 'Missing max-mode provenance');
    }
    return 'provenance';
  }
  return undefined;
}

function attestationTarget(
  item: Record<string, unknown>,
  manifest: Record<string, unknown>,
  manifests: Record<string, unknown>[],
): string | undefined {
  const annotations = object(item['annotations'] ?? {});
  if (annotations['vnd.docker.reference.type'] !== 'attestation-manifest') {
    assert(manifest['subject'] === undefined, 'Unexpected runtime manifest subject');
    return undefined;
  }
  const target = annotations['vnd.docker.reference.digest'];
  assert(
    typeof target === 'string' && digestPattern.test(target),
    'Invalid BuildKit attestation target',
  );
  if (manifest['subject'] !== undefined) {
    const subject = descriptor(manifest['subject']);
    assert(
      subject.digest === target &&
        manifests.some(
          (m) =>
            m['digest'] === target &&
            m['size'] === subject.size &&
            m['mediaType'] === subject.mediaType,
        ),
      'OCI attestation subject mismatch',
    );
  }
  return target;
}

function runtimeArchitecture(
  item: Record<string, unknown>,
  image: Record<string, unknown>,
  expected: Identity,
  historicalTag?: string,
) {
  const platform = object(item['platform']);
  const arch = platform['architecture'];
  assert(
    platform['os'] === 'linux' && (arch === 'amd64' || arch === 'arm64'),
    'Unexpected runtime platform',
  );
  assert(image['os'] === 'linux' && image['architecture'] === arch, 'Config platform mismatch');
  const runtime = object(image['config']);
  if (historicalTag) {
    const labels = object(runtime['Labels']);
    assert.equal(labels['org.opencontainers.image.source'], `https://github.com/${repository}`);
    assert.equal(labels['org.opencontainers.image.revision'], expected.revision);
    assert.equal(labels['org.opencontainers.image.version'], historicalTag);
    const health = object(runtime['Healthcheck'])['Test'];
    const commands = [
      'wget -qO- http://localhost:3000/health || exit 1',
      `node -e "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"`,
    ];
    assert(
      Array.isArray(health) &&
        health.length === 2 &&
        health[0] === 'CMD-SHELL' &&
        typeof health[1] === 'string' &&
        commands.includes(health[1]),
      'Unexpected historical HTTP health check',
    );
  } else {
    assert.deepEqual(
      imageLabels(runtime['Labels']),
      { version: expected.version, revision: expected.revision },
      'Config identity mismatch',
    );
    assert.deepEqual(
      object(runtime['Healthcheck'])['Test'],
      ['CMD', 'node', 'dist/healthcheck.js'],
      'Unexpected image health check',
    );
  }
  assert(runtime['User'] === 'node', 'Unexpected image user');
  assert.deepEqual(runtime['Cmd'], ['node', 'dist/index.js'], 'Unexpected image command');
  return arch;
}

export class PublicRegistry {
  readonly host: keyof typeof endpoints;
  private request: typeof fetch;
  private wait: (ms: number) => Promise<void>;
  private token = '';
  private refreshAt = 0;

  constructor(
    host: keyof typeof endpoints,
    request: typeof fetch = fetch,
    wait: (ms: number) => Promise<void> = delay,
  ) {
    this.host = host;
    this.request = request;
    this.wait = wait;
  }

  private async pullToken() {
    if (Date.now() >= this.refreshAt) {
      const url = `${endpoints[this.host][1]}&scope=repository:${repository}:pull`;
      const response = await publicGet(this.request, url);
      assert(response.ok, `Anonymous authorization failed (HTTP ${response.status})`);
      const { token } = await publicJson(response);
      assert(typeof token === 'string' && token.length > 0, 'Missing anonymous pull token');
      this.token = token;
      this.refreshAt = Date.now() + 45_000;
    }
    return this.token;
  }

  private read(kind: 'manifests' | 'blobs', ref: string, keep: boolean, expected?: Descriptor) {
    return retryRead(
      async () => {
        const url = `${endpoints[this.host][0]}/v2/${repository}/${kind}/${ref}`;
        const response = await publicGet(this.request, url, {
          headers: {
            Authorization: `Bearer ${await this.pullToken()}`,
            Accept: kind === 'manifests' ? `${indexType}, ${manifestType}` : '*/*',
          },
          // Blob storage may redirect to a CDN. Fetch strips authorization across origins.
          redirect: kind === 'blobs' ? 'follow' : 'error',
        });
        if (response.status === 404) {
          const errors = objects((await publicJson(response))['errors']);
          const code = kind === 'manifests' ? 'MANIFEST_UNKNOWN' : 'BLOB_UNKNOWN';
          // A provisioned but empty Hub repository can have no Distribution namespace yet.
          // Only a tag lookup can use this response, after independent public Hub confirmation.
          if (
            this.host === 'docker.io' &&
            kind === 'manifests' &&
            !digestPattern.test(ref) &&
            errors.length > 0 &&
            errors.every((entry) => entry['code'] === 'NAME_UNKNOWN')
          ) {
            await requirePublicHub(this.request);
            throw new MissingContent(`No manifests in the provisioned Docker Hub repository`);
          }
          assert(
            errors.length > 0 && errors.every((entry) => entry['code'] === code),
            'Ambiguous registry 404',
          );
          throw new MissingContent(`${this.host} missing ${kind}/${ref}`);
        }
        assert(
          response.status === 200 && response.body,
          `Anonymous ${kind} read failed (HTTP ${response.status})`,
        );
        const hash = createHash('sha256');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            size += chunk.length;
            hash.update(chunk);
            if (keep) chunks.push(chunk);
          }
        } catch {
          throw new TransientRead(`Interrupted ${kind}/${ref} read`);
        }
        const digest = `sha256:${hash.digest('hex')}`;
        const header = response.headers.get('docker-content-digest');
        assert(header === null || header === digest, 'Registry content digest header mismatch');
        if (digestPattern.test(ref)) assert(ref === digest, `Content digest mismatch for ${ref}`);
        if (expected) assert(size === expected.size, `Descriptor size mismatch for ${ref}`);
        return {
          digest,
          json: keep ? object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) : {},
        };
      },
      false,
      this.wait,
    );
  }

  private async rawIndex(ref: string) {
    const { digest, json } = await this.read('manifests', ref, true);
    assert(
      json['schemaVersion'] === 2 && json['mediaType'] === indexType,
      'Expected an OCI image index',
    );
    assert(json['subject'] === undefined, 'Unexpected release index subject');
    return { digest, json };
  }

  private async index(ref: string) {
    assert(
      ref === 'latest' || versionPattern.test(ref) || digestPattern.test(ref),
      'Invalid index ref',
    );
    const { digest, json } = await this.rawIndex(ref);
    return {
      identity: { ...imageLabels(json['annotations']), digest },
      manifests: objects(json['manifests']),
    };
  }

  async tag(ref: string): Promise<Identity | null> {
    try {
      return (await this.index(ref)).identity;
    } catch (error) {
      if (error instanceof MissingContent) return null;
      throw error;
    }
  }

  // Early GHCR tags used a leading v and stored identity only in each platform config.
  async historicalTagDigest(tag: string): Promise<string | null> {
    assert(versionPattern.test(tag.replace(/^v/, '')), 'Expected an exact historical tag');
    try {
      return (await this.rawIndex(tag)).digest;
    } catch (error) {
      if (error instanceof MissingContent) return null;
      throw error;
    }
  }

  async verifyHistorical(expected: Identity, sourceTag: string, requireSbom: boolean) {
    assert(
      digestPattern.test(expected.digest) && revisionPattern.test(expected.revision),
      'Invalid historical identity',
    );
    assert(
      versionPattern.test(expected.version) && sourceTag.replace(/^v/, '') === expected.version,
      'Invalid historical version',
    );
    const { json } = await this.rawIndex(expected.digest);
    return this.verifyManifests(expected, objects(json['manifests']), { sourceTag, requireSbom });
  }

  // Hash every referenced byte, including compressed filesystem layers. Only JSON is buffered.
  async verify(expected: Identity): Promise<Record<string, string>> {
    const { identity, manifests } = await this.index(expected.digest);
    assert.deepEqual(identity, expected, 'Index differs from selected release');
    return this.verifyManifests(expected, manifests);
  }

  private async verifyManifests(
    expected: Identity,
    manifests: Record<string, unknown>[],
    history?: { sourceTag: string; requireSbom: boolean },
  ): Promise<Record<string, string>> {
    const requireSbom = history?.requireSbom ?? true;
    const platforms: Record<string, string> = {};
    const evidence = new Map<string, Set<string>>();
    for (const item of manifests) {
      const desc = descriptor(item);
      assert(desc.mediaType === manifestType, 'Unsupported index descriptor');
      const { json } = await this.read('manifests', desc.digest, true, desc);
      assert(
        json['mediaType'] === desc.mediaType && json['schemaVersion'] === 2,
        'Invalid OCI manifest',
      );
      const config = descriptor(json['config']);
      const { json: image } = await this.read('blobs', config.digest, true, config);
      const target = attestationTarget(item, json, manifests);
      if (target === undefined) {
        const arch = runtimeArchitecture(item, image, expected, history?.sourceTag);
        assert(!(arch in platforms), 'Duplicate runtime platform');
        platforms[arch] = desc.digest;
      } else if (!evidence.has(target)) {
        evidence.set(target, new Set());
      }
      const layers = objects(json['layers']);
      assert(layers.length > 0, 'Missing manifest layers');
      for (const layer of layers) {
        const blob = descriptor(layer);
        const { json: content } = await this.read('blobs', blob.digest, target !== undefined, blob);
        if (target !== undefined) {
          assert(blob.mediaType === 'application/vnd.in-toto+json', 'Unexpected attestation layer');
          const type = attestation(layer, content, target, requireSbom);
          if (type !== undefined) evidence.get(target)!.add(type);
        }
      }
    }
    assert.deepEqual(Object.keys(platforms).sort(), ['amd64', 'arm64'], 'Missing release platform');
    for (const digest of Object.values(platforms)) {
      const types = evidence.get(digest);
      assert(
        types?.has('provenance') && (!requireSbom || types.has('sbom')),
        `Missing provenance or SBOM for ${digest}`,
      );
    }
    assert(evidence.size === 2, 'Unexpected attestation target');
    return platforms;
  }
}
