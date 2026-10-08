import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  type Manifest,
  type PublicationDependencies,
  lookupVersion,
  publishRegistry,
  registryUrl,
  validateRelease,
  verifyEntry,
  verifyImage,
} from '../.github/scripts/mcp-registry.js';

const serverName = 'io.github.enthouan/simplelogin-mcp';
const imageName = 'ghcr.io/enthouan/simplelogin-mcp';
const officialKey = 'io.modelcontextprotocol.registry/official';
const version = '1.2.3';
const platformDigest = `sha256:${'a'.repeat(64)}`;

function manifest(): Manifest {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: serverName,
    version,
    repository: {
      url: 'https://github.com/enthouan/simplelogin-mcp',
      source: 'github',
      id: '1256322108',
    },
    packages: [
      {
        registryType: 'oci',
        identifier: `${imageName}:${version}`,
        transport: { type: 'stdio' },
        environmentVariables: [
          { name: 'TRANSPORT', value: 'stdio' },
          { name: 'SL_API_KEY', isRequired: true, isSecret: true, placeholder: 'sl-your-key-here' },
        ],
      },
    ],
  };
}

function releaseEnvironment(): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'enthouan/simplelogin-mcp',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: `refs/tags/v${version}`,
  };
}

function packageMetadata(input: Manifest): Record<string, unknown> {
  return (input['packages'] as Record<string, unknown>[])[0]!;
}

function environmentMetadata(input: Manifest): Record<string, unknown>[] {
  return packageMetadata(input)['environmentVariables'] as Record<string, unknown>[];
}

function entry(input: Manifest = manifest(), status = 'active', isLatest = true) {
  return {
    server: structuredClone(input),
    _meta: { [officialKey]: { status, isLatest } },
  };
}

function dependencies(input: Manifest = manifest()) {
  return {
    lookup: vi.fn<PublicationDependencies['lookup']>().mockResolvedValue(entry(input)),
    verifyImage: vi.fn<PublicationDependencies['verifyImage']>(),
    publisher: vi.fn<PublicationDependencies['publisher']>(),
    cleanup: vi.fn<PublicationDependencies['cleanup']>(),
    wait: vi.fn<PublicationDependencies['wait']>().mockResolvedValue(undefined),
  } satisfies PublicationDependencies;
}

describe('Registry release guards', () => {
  it('accepts aligned stable release metadata without changing it', () => {
    const input = manifest();
    const before = structuredClone(input);
    expect(validateRelease(input, version, releaseEnvironment())).toBe(input);
    expect(input).toEqual(before);
  });

  it.each([
    ['GITHUB_ACTIONS', undefined],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_REPOSITORY', 'someone/simplelogin-mcp'],
    ['GITHUB_REPOSITORY', 'enthouan/another-repository'],
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_EVENT_NAME', 'workflow_dispatch'],
    ['GITHUB_REF', undefined],
    ['GITHUB_REF', 'refs/heads/main'],
    ['GITHUB_REF', 'refs/tags/1.2.3'],
    ['GITHUB_REF', 'refs/tags/v01.2.3'],
    ['GITHUB_REF', 'refs/tags/v1.02.3'],
    ['GITHUB_REF', 'refs/tags/v1.2.03'],
    ['GITHUB_REF', 'refs/tags/v1.2'],
    ['GITHUB_REF', 'refs/tags/v1.2.3.4'],
    ['GITHUB_REF', 'refs/tags/v1.2.3-rc.1'],
    ['GITHUB_REF', 'refs/tags/v1.2.3+build.1'],
    ['GITHUB_REF', 'refs/tags/v1.2.3;echo unsafe'],
  ])('rejects non-release context %s=%s', (key, value) => {
    expect(() =>
      validateRelease(manifest(), version, { ...releaseEnvironment(), [key]: value }),
    ).toThrow();
  });

  it.each(['1.2.4', undefined, 123])('rejects package version %s', (packageVersion) => {
    expect(() => validateRelease(manifest(), packageVersion, releaseEnvironment())).toThrow(
      'Release versions disagree',
    );
  });

  it.each([
    ['name', 'io.github.someone/simplelogin-mcp', 'namespace'],
    ['version', '1.2.4', 'Release versions disagree'],
    ['_meta', {}, 'Registry-managed metadata'],
    [
      'repository',
      { url: 'https://github.com/someone/server', source: 'github' },
      'source repository',
    ],
    [
      'repository',
      { url: 'https://github.com/enthouan/simplelogin-mcp', source: 'gitlab' },
      'GitHub source',
    ],
    ['packages', [], 'one OCI package'],
    ['packages', [{}, {}], 'one OCI package'],
  ])('rejects unexpected manifest field %s', (key, value, message) => {
    const input = manifest();
    input[key] = value;
    expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(message);
  });

  it.each([
    ['identifier', `${imageName}:latest`, 'OCI tag must match release'],
    ['identifier', `${imageName}:1.2.4`, 'OCI tag must match release'],
    ['registryType', 'npm', 'OCI tag must match release'],
    ['version', version, 'OCI version belongs in the image identifier'],
    ['transport', { type: 'streamable-http' }, 'Expected stdio transport'],
    ['environmentVariables', undefined, 'Expected environment metadata'],
  ])('rejects unexpected OCI package field %s', (key, value, message) => {
    const input = manifest();
    packageMetadata(input)[key] = value;
    expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(message);
  });

  it.each(['value', 'default'])('rejects %s on any secret, including empty values', (field) => {
    for (const value of ['fake-test-value', '']) {
      const input = manifest();
      environmentMetadata(input).push({ name: 'OTHER_SECRET', isSecret: true, [field]: value });
      expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(
        'Secret metadata must not contain values or defaults',
      );
    }
  });

  it.each(['isRequired', 'isSecret'])('requires SL_API_KEY.%s', (field) => {
    const input = manifest();
    environmentMetadata(input)[1]![field] = false;
    expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(
      'SL_API_KEY must be required and secret',
    );
  });

  it('rejects duplicate API key entries that could disguise a committed secret', () => {
    const input = manifest();
    environmentMetadata(input).push({ name: 'SL_API_KEY', value: 'fake-test-value' });
    expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(
      'Environment variable names must be unique strings',
    );
  });

  it.each([undefined, null, 123])('rejects non-string environment variable name %s', (name) => {
    const input = manifest();
    environmentMetadata(input).push({ name, value: 'not-a-secret' });
    expect(() => validateRelease(input, version, releaseEnvironment())).toThrow(
      'Environment variable names must be unique strings',
    );
  });

  it('requires the API key and fixed stdio environment declarations', () => {
    const missingKey = manifest();
    environmentMetadata(missingKey).pop();
    expect(() => validateRelease(missingKey, version, releaseEnvironment())).toThrow(
      'SL_API_KEY must be required and secret',
    );
    const wrongTransport = manifest();
    environmentMetadata(wrongTransport)[0]!['value'] = 'http';
    expect(() => validateRelease(wrongTransport, version, releaseEnvironment())).toThrow(
      'Expected fixed stdio environment',
    );
  });
});

describe('Registry read-only version checks', () => {
  it('uses the stable API, encoded namespace and include_deleted without credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(entry()));
    await expect(lookupVersion(manifest(), request)).resolves.toEqual(entry());
    expect(request).toHaveBeenCalledExactlyOnceWith(
      `${registryUrl}/v0.1/servers/io.github.enthouan%2Fsimplelogin-mcp/versions/${version}?include_deleted=true`,
      {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    );
  });

  it('treats only HTTP 404 as absence', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }));
    await expect(lookupVersion(manifest(), request)).resolves.toBeNull();
  });

  it.each([301, 401, 403, 409, 429, 500, 503])('fails closed for HTTP %i', async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('error', { status }));
    await expect(lookupVersion(manifest(), request)).rejects.toThrow(`HTTP ${status}`);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['null', '[]', '"not an entry"', '{invalid'])(
    'rejects malformed success %s',
    async (body) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      await expect(lookupVersion(manifest(), request)).rejects.toThrow();
    },
  );

  it('does not reinterpret a network failure as absence', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable'));
    await expect(lookupVersion(manifest(), request)).rejects.toThrow('network unavailable');
  });

  it('accepts identical active metadata, including an older version and reordered properties', () => {
    const input = manifest();
    const existing = entry(input, 'active', false);
    existing.server = Object.fromEntries(Object.entries(existing.server).reverse()) as Manifest;
    expect(() => verifyEntry(input, existing)).not.toThrow();
  });

  it.each(['deleted', 'deprecated', 'unknown'])('rejects existing %s versions', (status) => {
    expect(() => verifyEntry(manifest(), entry(manifest(), status))).toThrow('not active');
  });

  it('rejects any immutable metadata mismatch', () => {
    const existing = entry();
    existing.server['description'] = 'Different immutable metadata';
    expect(() => verifyEntry(manifest(), existing)).toThrow('Immutable Registry metadata differs');
  });

  it.each([null, [], {}, { server: manifest(), _meta: {} }])(
    'rejects malformed entries',
    (input) => {
      expect(() => verifyEntry(manifest(), input)).toThrow();
    },
  );
});

function imageFixture() {
  const index = {
    annotations: { 'io.modelcontextprotocol.server.name': serverName },
    manifests: ['amd64', 'arm64'].map((architecture) => ({
      digest: platformDigest,
      platform: { os: 'linux', architecture },
    })),
  };
  const provenance: Record<string, unknown> = { buildConfig: { steps: ['build'] } };
  const sbom: Record<string, unknown> = { SPDXID: 'SPDXRef-DOCUMENT', spdxVersion: 'SPDX-2.3' };
  const raw = () => JSON.stringify(index);
  const digest = () => `sha256:${createHash('sha256').update(raw()).digest('hex')}`;
  const command = vi.fn((program: string, args: string[]): string => {
    expect(program).toBe('docker');
    if (args.at(-1) === '--raw') return raw();
    return JSON.stringify(args.at(-1)?.includes('.Provenance') ? provenance : sbom);
  });
  return { index, provenance, sbom, raw, digest, command };
}

describe('Public release image verification', () => {
  it('binds the public tag to the Docker digest and pins both platforms trust lookups', () => {
    const fixture = imageFixture();
    verifyImage(manifest(), fixture.digest(), fixture.command);
    expect(fixture.command).toHaveBeenNthCalledWith(1, 'docker', [
      'buildx',
      'imagetools',
      'inspect',
      `${imageName}:${version}`,
      '--raw',
    ]);
    const expectedFormats = ['amd64', 'arm64'].flatMap((architecture) => [
      `{{json (index .Provenance "linux/${architecture}").SLSA}}`,
      `{{json (index .SBOM "linux/${architecture}").SPDX}}`,
    ]);
    expect(fixture.command.mock.calls.slice(1)).toEqual(
      expectedFormats.map((format) => [
        'docker',
        ['buildx', 'imagetools', 'inspect', `${imageName}@${fixture.digest()}`, '--format', format],
      ]),
    );
  });

  it('accepts the newer SLSA buildDefinition max-mode configuration', () => {
    const fixture = imageFixture();
    delete fixture.provenance['buildConfig'];
    fixture.provenance['buildDefinition'] = {
      internalParameters: { buildConfig: { steps: ['build'] } },
    };
    expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).not.toThrow();
  });

  it.each(['', 'sha256:abc', `sha256:${'A'.repeat(64)}`, 'latest'])(
    'rejects invalid Docker digest %s',
    (digest) => {
      const fixture = imageFixture();
      expect(() => verifyImage(manifest(), digest, fixture.command)).toThrow(
        'Docker job image digest',
      );
      expect(fixture.command).not.toHaveBeenCalled();
    },
  );

  it('rejects a public tag that resolves to a different image', () => {
    const fixture = imageFixture();
    expect(() => verifyImage(manifest(), platformDigest, fixture.command)).toThrow(
      'does not match the Docker job digest',
    );
    expect(fixture.command).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatching image ownership annotation', () => {
    const fixture = imageFixture();
    fixture.index.annotations['io.modelcontextprotocol.server.name'] = 'io.github.someone/other';
    expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).toThrow(
      'ownership annotation mismatch',
    );
  });

  it.each(['amd64', 'arm64'])('requires exactly one valid linux/%s manifest', (architecture) => {
    for (const mutation of ['missing', 'duplicate', 'invalid-digest']) {
      const fixture = imageFixture();
      const target = fixture.index.manifests.find(
        (item) => item.platform.architecture === architecture,
      )!;
      if (mutation === 'missing') {
        fixture.index.manifests = fixture.index.manifests.filter((item) => item !== target);
      } else if (mutation === 'duplicate') {
        fixture.index.manifests.push(structuredClone(target));
      } else {
        target.digest = 'sha256:invalid';
      }
      expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).toThrow(
        `Missing or duplicate linux/${architecture} manifest`,
      );
    }
  });

  it.each([undefined, {}, null, []])('rejects absent or empty max-mode configuration', (config) => {
    const fixture = imageFixture();
    fixture.provenance['buildConfig'] = config;
    expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).toThrow();
  });

  it.each([
    ['SPDXID', undefined],
    ['SPDXID', 'OTHER-DOCUMENT'],
    ['spdxVersion', undefined],
    ['spdxVersion', 'CycloneDX-1.6'],
  ])('rejects invalid SPDX field %s', (key, value) => {
    const fixture = imageFixture();
    fixture.sbom[key] = value;
    expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).toThrow('SPDX SBOM');
  });

  it('fails if an anonymous image or trust lookup is unavailable', () => {
    const fixture = imageFixture();
    fixture.command.mockImplementation(() => {
      throw new Error('anonymous image unavailable');
    });
    expect(() => verifyImage(manifest(), fixture.digest(), fixture.command)).toThrow(
      'anonymous image unavailable',
    );
  });
});

describe('Single-write Registry publication', () => {
  it('skips authentication and publication for an identical active version', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValue(entry(manifest(), 'active', false));
    await expect(publishRegistry(manifest(), deps)).resolves.toBe('existing');
    expect(deps.lookup).toHaveBeenCalledTimes(1);
    expect(deps.verifyImage).toHaveBeenCalledTimes(1);
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
    expect(deps.wait).not.toHaveBeenCalled();
  });

  it('does not accept an identical entry when its public image verification fails', async () => {
    const deps = dependencies();
    deps.verifyImage.mockImplementation(() => {
      throw new Error('image digest changed');
    });
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow('image digest changed');
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'deleted'])('never publishes over an existing %s', async (scenario) => {
    const deps = dependencies();
    const existing = entry(manifest(), scenario === 'deleted' ? 'deleted' : 'active');
    if (scenario === 'conflict') existing.server['description'] = 'different';
    deps.lookup.mockResolvedValue(existing);
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow();
    expect(deps.verifyImage).not.toHaveBeenCalled();
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it('does not publish after a failed preflight lookup', async () => {
    const deps = dependencies();
    deps.lookup.mockRejectedValue(new Error('HTTP 503'));
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow('HTTP 503');
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('validates image and metadata before minting an OIDC token and publishes exactly once', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValueOnce(null);
    await expect(publishRegistry(manifest(), deps)).resolves.toBe('published');
    expect(deps.publisher.mock.calls).toEqual([
      [['validate', 'server.json']],
      [['login', 'github-oidc', '--registry', registryUrl]],
      [['publish', 'server.json']],
    ]);
    expect(deps.verifyImage.mock.invocationCallOrder[0]).toBeLessThan(
      deps.publisher.mock.invocationCallOrder[0]!,
    );
    expect(deps.publisher.mock.invocationCallOrder[2]).toBeLessThan(
      deps.lookup.mock.invocationCallOrder[1]!,
    );
    expect(deps.lookup.mock.invocationCallOrder[1]).toBeLessThan(
      deps.cleanup.mock.invocationCallOrder[0]!,
    );
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['image', 'manifest'])(
    'does not authenticate when %s validation fails',
    async (stage) => {
      const deps = dependencies();
      deps.lookup.mockResolvedValueOnce(null);
      if (stage === 'image') {
        deps.verifyImage.mockImplementation(() => {
          throw new Error('image validation failed');
        });
      } else {
        deps.publisher.mockImplementation(() => {
          throw new Error('manifest validation failed');
        });
      }
      await expect(publishRegistry(manifest(), deps)).rejects.toThrow(`${stage} validation failed`);
      expect(deps.publisher.mock.calls.some(([args]) => args[0] === 'login')).toBe(false);
      expect(deps.publisher.mock.calls.some(([args]) => args[0] === 'publish')).toBe(false);
    },
  );

  it('cleans credentials when authentication fails without attempting publication', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValueOnce(null);
    deps.publisher.mockImplementation((args) => {
      if (args[0] === 'login') throw new Error('authentication failed');
    });
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow('authentication failed');
    expect(deps.publisher.mock.calls.map(([args]) => args[0])).toEqual(['validate', 'login']);
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
  });

  it('recovers an uncertain publish result by readback without another write', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValueOnce(null);
    deps.publisher.mockImplementation((args) => {
      if (args[0] === 'publish') throw new Error('publisher timed out after acceptance');
    });
    await expect(publishRegistry(manifest(), deps)).resolves.toBe('published');
    expect(deps.publisher.mock.calls.filter(([args]) => args[0] === 'publish')).toHaveLength(1);
    expect(deps.lookup).toHaveBeenCalledTimes(2);
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
  });

  it('retries only verification reads after transient errors or delayed visibility', async () => {
    const deps = dependencies();
    deps.lookup
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(null);
    await expect(publishRegistry(manifest(), deps)).resolves.toBe('published');
    expect(deps.lookup).toHaveBeenCalledTimes(4);
    expect(deps.wait).toHaveBeenCalledTimes(2);
    expect(deps.publisher.mock.calls.filter(([args]) => args[0] === 'publish')).toHaveLength(1);
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails with explicit recovery instructions when the single write remains unconfirmed', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValue(null);
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow(
      'Inspect the exact Registry version before rerunning only the failed Registry job',
    );
    expect(deps.lookup).toHaveBeenCalledTimes(7);
    expect(deps.wait).toHaveBeenCalledTimes(5);
    expect(deps.publisher.mock.calls.filter(([args]) => args[0] === 'publish')).toHaveLength(1);
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on conflicting readback and still cleans credentials', async () => {
    const deps = dependencies();
    const conflict = entry();
    conflict.server['description'] = 'Unexpected metadata';
    deps.lookup.mockResolvedValueOnce(null).mockResolvedValueOnce(conflict);
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow(
      'Immutable Registry metadata differs',
    );
    expect(deps.lookup).toHaveBeenCalledTimes(2);
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails the job if credential cleanup cannot be confirmed', async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValueOnce(null);
    deps.cleanup.mockImplementation(() => {
      throw new Error('Publisher credential cleanup failed');
    });
    await expect(publishRegistry(manifest(), deps)).rejects.toThrow('credential cleanup failed');
  });
});

interface WorkflowStep {
  name: string;
  uses?: string;
  id?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}

interface WorkflowJob {
  needs?: string;
  if?: string;
  permissions: Record<string, string>;
  outputs?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: { docker: WorkflowJob; registry: WorkflowJob; 'release-policy': WorkflowJob };
}

function releaseWorkflow(): ReleaseWorkflow {
  return parse(
    readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
  ) as ReleaseWorkflow;
}

describe('Registry workflow wiring', () => {
  it('checks protected-main ancestry in a read-only job before either publishing job starts', () => {
    const workflow = releaseWorkflow();
    const policy = workflow.jobs['release-policy'];
    expect(policy.permissions).toEqual({ contents: 'read' });
    const checkout = policy.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
    const guard = policy.steps.find((step) => step.run?.includes('merge-base'));
    expect(guard?.if).toBe("startsWith(github.ref, 'refs/tags/')");
    expect(guard?.run).toContain(
      'git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main',
    );
    expect(guard?.run).toContain(
      'git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main',
    );
    expect(workflow.jobs.docker.needs).toBe('release-policy');
    expect(workflow.jobs.registry.needs).toBe('docker');
  });
  it('runs only after Docker success for upstream stable release pushes', () => {
    const workflow = releaseWorkflow();
    const registry = workflow.jobs.registry;
    expect(Object.keys(workflow.on)).toEqual(['push']);
    expect(registry.needs).toBe('docker');
    expect(registry.if).toContain("github.repository == 'enthouan/simplelogin-mcp'");
    expect(registry.if).toContain("github.event_name == 'push'");
    expect(registry.if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(registry.if).toContain("!contains(github.ref_name, '-')");
    expect(registry.if).toContain("!contains(github.ref_name, '+')");
    expect(registry.if).not.toMatch(/always\(\)|failure\(\)/);
    expect(registry.concurrency).toEqual({
      group: 'mcp-registry-${{ github.ref }}',
      'cancel-in-progress': false,
    });
  });

  it('isolates OIDC from Docker write permissions and disables checkout credentials', () => {
    const workflow = releaseWorkflow();
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.docker.permissions).toEqual({ contents: 'read', packages: 'write' });
    expect(workflow.jobs.registry.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    const checkout = workflow.jobs.registry.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(JSON.stringify(workflow.jobs.registry)).not.toMatch(
      /secrets\.|github\.token|MCP_GITHUB_TOKEN/,
    );
  });

  it('passes the completed Docker build digest to publication', () => {
    const workflow = releaseWorkflow();
    const build = workflow.jobs.docker.steps.find((step) => step.id === 'build');
    expect(build?.uses).toMatch(/^docker\/build-push-action@[a-f0-9]{40}$/);
    expect(workflow.jobs.docker.outputs?.['digest']).toBe('${{ steps.build.outputs.digest }}');
    const publish = workflow.jobs.registry.steps.find((step) =>
      step.run?.endsWith('mcp-registry.ts publish'),
    );
    expect(publish?.env?.['RELEASE_IMAGE_DIGEST']).toBe('${{ needs.docker.outputs.digest }}');
  });

  it('installs a version-and-checksum-pinned publisher before publishing, and always logs out', () => {
    const steps = releaseWorkflow().jobs.registry.steps;
    const checkIndex = steps.findIndex((step) => step.run?.endsWith('mcp-registry.ts check'));
    const installIndex = steps.findIndex((step) => step.name === 'Install verified MCP publisher');
    const publishIndex = steps.findIndex((step) => step.run?.endsWith('mcp-registry.ts publish'));
    const cleanupIndex = steps.findIndex((step) => step.run?.endsWith('mcp-registry.ts logout'));
    expect(checkIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(checkIndex);
    expect(publishIndex).toBeGreaterThan(installIndex);
    expect(cleanupIndex).toBeGreaterThan(publishIndex);
    expect(steps[cleanupIndex]?.if).toBe('always()');
    const install = steps[installIndex]!;
    expect(install.env?.['MCP_PUBLISHER_VERSION']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(install.env?.['MCP_PUBLISHER_SHA256']).toMatch(/^[a-f0-9]{64}$/);
    expect(install.run).toContain('releases/download/v${MCP_PUBLISHER_VERSION}/');
    expect(install.run).not.toContain('/latest/');
    expect(install.run).toContain('sha256sum --check --strict');
    expect(install.run!.indexOf('sha256sum --check --strict')).toBeLessThan(
      install.run!.indexOf('tar -xzf'),
    );
    expect(install.run).toContain('--proto-redir');
  });
});
