import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderDockerMcpToolsJson } from '../src/tools/catalog.js';

const REGISTRY_NAME = 'io.github.enthouan/simplelogin-mcp';
const GHCR_IMAGE = 'ghcr.io/enthouan/simplelogin-mcp';
const DOCKER_MCP_RELEASE = {
  version: '1.0.0',
  sourceCommit: '3e9b94ae977df377ecf0cdd2e96ef4bcf2a10c68',
} as const;
const SERVER_JSON_PATH = 'server.json';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const RELEASE_SKILL_PATH = '.agents/skills/simplelogin-mcp-release/SKILL.md';
const BUILD_PUSH_ACTION_REFERENCE = /^docker\/build-push-action@[0-9a-f]{40}$/;
const SEPARATE_TRUST_ACTION_REFERENCE =
  /^(?:actions\/attest(?:-[^@/]+)?|sigstore\/cosign-installer|slsa-framework\/[^@]+)@/i;
const SEPARATE_TRUST_COMMAND =
  /(?:^|[;&|]\s*|\s)cosign\s+(?:sign|attest|attach\s+(?:attestation|sbom))(?:\s|$)/im;
const SECRET_LIKE_INPUT =
  /(?:^|[^a-z0-9])(?:api[-_]?key|access[-_]?key(?:[-_]?id)?|auth(?:orization)?|bearer|credentials?|password|passwd|private[-_]?key|secrets?|session(?:[-_]?id)?|signing[-_]?key|ssh[-_]?key|pat|tokens?)(?:$|[^a-z0-9])/i;
const SECRET_LIKE_SUFFIX =
  /(?:apikey|authorization|bearer|credentials?|password|passwd|privatekey|secrets?|sessionid|signingkey|sshkey|tokens?)$/i;
const SECRET_CONTEXT_EXPRESSION = /\$\{\{\s*(?:secrets(?:\.|\[)|github\.token\b)/i;

type YamlMapping = Record<string, unknown>;

interface PackageJson {
  version: string;
}

interface RegistryEnvironmentVariable {
  name: string;
  value?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  transport: {
    type: string;
  };
  environmentVariables?: RegistryEnvironmentVariable[];
}

interface RegistryMetadata {
  name: string;
  title?: string;
  description?: string;
  version: string;
  websiteUrl?: string;
  repository?: {
    url?: string;
    source?: string;
    id?: string;
  };
  packages?: RegistryPackage[];
}

interface DockerMcpStagingMetadata {
  image: string;
  about: {
    title: string;
  };
  source: {
    project: string;
    branch: string;
    commit: string;
  };
}

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}

function expectSpecificVersion(version: string): void {
  expect(version).toBeTruthy();
  expect(version.toLowerCase()).not.toBe('latest');
  expect(version).not.toMatch(/[\^~<>*]|\bx\b|\|\|| - /i);
}

function isYamlMapping(value: unknown): value is YamlMapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionInputString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function splitActionInput(value: unknown, separator: RegExp): string[] {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => {
    const input = actionInputString(entry);
    if (input === undefined) {
      throw new Error('Expected action list input to contain only scalar values');
    }
    return input
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
  });
}

function isSecretLikeInput(value: string): boolean {
  return SECRET_LIKE_INPUT.test(value) || SECRET_LIKE_SUFFIX.test(value.replace(/[^a-z0-9]/gi, ''));
}

function workflowDocument(path: string): YamlMapping {
  const workflow = parse(readRepoFile(path)) as unknown;
  if (!isYamlMapping(workflow) || !isYamlMapping(workflow['jobs'])) {
    throw new Error(`${path} must define a jobs mapping`);
  }
  return workflow;
}

function workflowJobs(workflow: YamlMapping): YamlMapping[] {
  if (!isYamlMapping(workflow['jobs'])) {
    return [];
  }
  return Object.values(workflow['jobs']).filter(isYamlMapping);
}

function workflowSteps(path: string): YamlMapping[] {
  return workflowJobs(workflowDocument(path)).flatMap((job) => {
    if (!isYamlMapping(job) || !Array.isArray(job['steps'])) {
      return [];
    }
    return job['steps'].filter(isYamlMapping);
  });
}

function scalarValuesForKey(value: unknown, key: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => scalarValuesForKey(entry, key));
  }
  if (!isYamlMapping(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([entryKey, entryValue]) => {
    const nested = scalarValuesForKey(entryValue, key);
    if (entryKey !== key) {
      return nested;
    }
    const scalar = actionInputString(entryValue);
    return scalar === undefined ? nested : [scalar, ...nested];
  });
}

function usesSeparateTrustMechanism(workflow: YamlMapping): boolean {
  return (
    scalarValuesForKey(workflow, 'uses').some((value) =>
      SEPARATE_TRUST_ACTION_REFERENCE.test(value),
    ) || scalarValuesForKey(workflow, 'run').some((value) => SEPARATE_TRUST_COMMAND.test(value))
  );
}

function outputMayPublish(output: string): boolean {
  if (output.includes('${{')) {
    return true;
  }

  const attributes = new Map(
    output.split(',').map((attribute) => {
      const [name, ...value] = attribute.split('=');
      return [name?.trim().toLowerCase() ?? '', value.join('=').trim().toLowerCase()];
    }),
  );
  const type = attributes.get('type');
  const push = attributes.get('push');
  return type === 'registry' || (type === 'image' && push !== undefined && push !== 'false');
}

function stepMayPublish(step: YamlMapping): boolean {
  const inputs = step['with'];
  if (!isYamlMapping(inputs)) {
    return false;
  }

  const push = actionInputString(inputs['push']);
  if (push !== undefined && push.toLowerCase() !== 'false') {
    return true;
  }

  return splitActionInput(inputs['outputs'], /\r?\n/).some(outputMayPublish);
}

function publishingBuildStep(): YamlMapping {
  const candidates = workflowSteps(RELEASE_WORKFLOW_PATH).filter((step) => {
    if (!actionInputString(step['uses'])?.startsWith('docker/build-push-action@')) {
      return false;
    }
    return stepMayPublish(step);
  });

  if (candidates.length !== 1) {
    throw new Error('Expected exactly one publishing docker/build-push-action step');
  }
  return candidates[0]!;
}

function stepInputs(step: YamlMapping): YamlMapping {
  if (!isYamlMapping(step['with'])) {
    throw new Error('Publishing docker build step must define action inputs');
  }
  return step['with'];
}

describe('MCP registry metadata', () => {
  it('uses the GitHub namespace, current server version, and pinned GHCR OCI image', () => {
    const packageJson = readJson<PackageJson>('package.json');
    const metadata = readJson<RegistryMetadata>(SERVER_JSON_PATH);
    const [ociPackage] = metadata.packages ?? [];

    expect(metadata.name).toBe(REGISTRY_NAME);
    expect(metadata.title).toBe('simplelogin-mcp');
    expect(metadata.websiteUrl).toBe('https://simplelogin-mcp.com/');
    expect(metadata.version).toBe(packageJson.version);
    expect(metadata.repository).toEqual({
      url: 'https://github.com/enthouan/simplelogin-mcp',
      source: 'github',
      id: '1256322108',
    });
    expect(ociPackage).toMatchObject({
      registryType: 'oci',
      identifier: `${GHCR_IMAGE}:${packageJson.version}`,
      transport: { type: 'stdio' },
    });
    expect(ociPackage).not.toHaveProperty('version');

    expectSpecificVersion(metadata.version);
    expectSpecificVersion(ociPackage?.identifier.split(':').at(-1) ?? '');
  });

  it('keeps the public description within the official registry limit', () => {
    const metadata = readJson<RegistryMetadata>(SERVER_JSON_PATH);

    expect(metadata.description).toBeTruthy();
    expect(metadata.description?.length).toBeLessThanOrEqual(100);
  });

  it('marks required secrets and static stdio environment without committed secret values', () => {
    const metadata = readJson<RegistryMetadata>(SERVER_JSON_PATH);
    const [ociPackage] = metadata.packages ?? [];
    const env = ociPackage?.environmentVariables ?? [];
    const envByName = new Map(env.map((entry) => [entry.name, entry]));

    expect(envByName.get('TRANSPORT')).toMatchObject({ value: 'stdio' });
    expect(envByName.get('SL_API_KEY')).toMatchObject({
      isRequired: true,
      isSecret: true,
    });
    expect(envByName.get('SL_API_KEY')).not.toHaveProperty('value');
    expect(envByName.get('SL_API_KEY')).not.toHaveProperty('default');
    expect(envByName.get('SL_API_URL')).toMatchObject({
      default: 'https://app.simplelogin.io',
    });
  });

  it('keeps Docker image metadata aligned with the registry server name', () => {
    const dockerfile = readRepoFile('Dockerfile');
    expect(dockerfile).toContain(`io.modelcontextprotocol.server.name="${REGISTRY_NAME}"`);

    for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const workflow = readRepoFile(workflowPath);
      expect(workflow.match(/io\.modelcontextprotocol\.server\.name=/g)).toHaveLength(2);
      expect(workflow).toContain(`io.modelcontextprotocol.server.name=${REGISTRY_NAME}`);
    }
  });
});

describe('Published image trust policy', () => {
  it('publishes both supported platforms with explicit max provenance and an SBOM', () => {
    const step = publishingBuildStep();
    const inputs = stepInputs(step);

    expect(actionInputString(step['uses'])).toMatch(BUILD_PUSH_ACTION_REFERENCE);
    expect(actionInputString(inputs['push'])).toBe('true');
    expect(splitActionInput(inputs['platforms'], /(?:\r?\n|,)+/).sort()).toEqual([
      'linux/amd64',
      'linux/arm64',
    ]);
    expect(actionInputString(inputs['provenance'])).toBe('mode=max');
    expect(actionInputString(inputs['sbom'])).toBe('true');
  });

  it('does not expose secret-like values through public publishing build arguments', () => {
    const inputs = stepInputs(publishingBuildStep());
    const buildArgs = splitActionInput(inputs['build-args'], /\r?\n/);
    const hasSecretLikeBuildArg = buildArgs.some((buildArg) => {
      const equals = buildArg.indexOf('=');
      const name = equals === -1 ? buildArg : buildArg.slice(0, equals);
      const value = equals === -1 ? '' : buildArg.slice(equals + 1);
      return (
        isSecretLikeInput(name) || SECRET_CONTEXT_EXPRESSION.test(value) || isSecretLikeInput(value)
      );
    });

    expect(hasSecretLikeBuildArg).toBe(false);
  });

  it('keeps option A on the minimum release permissions without a separate trust mechanism', () => {
    const workflow = workflowDocument(RELEASE_WORKFLOW_PATH);

    expect(workflow['permissions']).toEqual({
      contents: 'read',
      packages: 'write',
    });
    for (const job of workflowJobs(workflow)) {
      expect(job).not.toHaveProperty('permissions');
    }
    expect(usesSeparateTrustMechanism(workflow)).toBe(false);
  });

  it('recognizes representative secret-like build argument names', () => {
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'GH_PAT',
      'NPM_AUTH',
      'AUTHORIZATION',
      'SSH_KEY',
      'SIGNING_KEY',
      'MYTOKEN',
      'MYSECRET',
    ]) {
      expect(isSecretLikeInput(name)).toBe(true);
    }
    expect(isSecretLikeInput('NODE_ENV')).toBe(false);
  });

  it('treats conditional pushes and registry outputs as publishing paths', () => {
    for (const inputs of [
      { push: "${{ github.event_name == 'push' }}" },
      { outputs: 'type=registry' },
      { outputs: 'type=image,push=true' },
    ]) {
      expect(stepMayPublish({ with: inputs })).toBe(true);
    }
    expect(stepMayPublish({ with: { push: false, outputs: 'type=cacheonly' } })).toBe(false);
  });

  it('recognizes representative separate signing and attestation paths', () => {
    for (const step of [
      { uses: 'actions/attest-build-provenance@0123456789abcdef' },
      { uses: 'actions/attest-sbom@0123456789abcdef' },
      { uses: 'sigstore/cosign-installer@0123456789abcdef' },
      {
        uses: 'slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@main',
      },
      { run: 'cosign sign ghcr.io/example/image@sha256:abc' },
      { run: 'cosign attest ghcr.io/example/image@sha256:abc' },
      { run: 'cosign attach sbom --sbom image.spdx.json ghcr.io/example/image@sha256:abc' },
    ]) {
      expect(usesSeparateTrustMechanism({ jobs: { test: { steps: [step] } } })).toBe(true);
    }
    expect(
      usesSeparateTrustMechanism({
        jobs: { verify: { steps: [{ run: 'cosign verify ghcr.io/example/image@sha256:abc' }] } },
      }),
    ).toBe(false);
  });

  it('keeps the operative release skill digest-pinned and platform-complete', () => {
    const releaseSkill = readRepoFile(RELEASE_SKILL_PATH);
    const verificationGate = releaseSkill.indexOf('verify_image_trust() (');
    const releaseCreation = releaseSkill.indexOf('gh release create');

    expect(verificationGate).toBeGreaterThan(-1);
    expect(releaseCreation).toBeGreaterThan(verificationGate);
    for (const requiredInstruction of [
      'imagetools inspect "$image_ref" --raw > "$manifest_file"',
      'pinned_image="${image_ref%@*}@$index_digest"',
      'for platform in linux/amd64 linux/arm64',
      '.Provenance',
      '.buildDefinition.internalParameters.buildConfig',
      '.SBOM',
      '.SPDXID == "SPDXRef-DOCUMENT"',
      '.spdxVersion | startswith("SPDX-")',
      'verify_image_trust ghcr.io/enthouan/simplelogin-mcp:latest',
      'verify_image_trust ghcr.io/enthouan/simplelogin-mcp:X.Y.Z',
      'verify_image_trust ghcr.io/enthouan/simplelogin-mcp:X.Y',
      'verify_image_trust ghcr.io/enthouan/simplelogin-mcp:sha-<full-main-sha>',
    ]) {
      expect(releaseSkill).toContain(requiredInstruction);
    }
  });
});

describe('Docker MCP Registry staging metadata', () => {
  it('pins the staged Docker registry entry to the exact GHCR release source', () => {
    const serverYaml = readRepoFile('registry/docker-mcp/server.yaml');
    const server = parse(serverYaml) as DockerMcpStagingMetadata;
    const imageTag = server.image.split(':').at(-1) ?? '';

    expect(server.image).toBe(`${GHCR_IMAGE}:${DOCKER_MCP_RELEASE.version}`);
    expectSpecificVersion(imageTag);
    expect(server.about.title).toBe('SimpleLogin');
    expect(server.source).toEqual({
      project: 'https://github.com/enthouan/simplelogin-mcp',
      branch: 'main',
      commit: DOCKER_MCP_RELEASE.sourceCommit,
    });
    expect(server.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(serverYaml).toContain('env: SL_API_KEY');
    expect(serverYaml).toContain('name: TRANSPORT\n      value: stdio');
    expect(serverYaml).toContain('project: https://github.com/enthouan/simplelogin-mcp');
    expect(serverYaml).toContain('icon: https://simplelogin-mcp.com/favicon.svg');
    expect(readRepoFile('registry/docker-mcp/readme.md')).toContain(
      'Full documentation: https://simplelogin-mcp.com/',
    );
  });

  it('keeps staged Docker tools in sync with the source tool catalog summaries', () => {
    expect(readRepoFile('registry/docker-mcp/tools.json')).toBe(renderDockerMcpToolsJson());
  });
});
