import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDockerMcpToolsJson } from '../src/tools/catalog.js';

const REGISTRY_NAME = 'io.github.enthouan/simplelogin-mcp';
const GHCR_IMAGE = 'ghcr.io/enthouan/simplelogin-mcp';
const RELEASE_COMMITS = {
  '0.7.0': '7b5ad0d9f81d0fb3753b46266c77c60d9d994eb4',
} as const;

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
  version?: string;
  transport: {
    type: string;
  };
  environmentVariables?: RegistryEnvironmentVariable[];
}

interface RegistryMetadata {
  name: string;
  version: string;
  repository?: {
    url?: string;
    source?: string;
    id?: string;
  };
  packages?: RegistryPackage[];
}

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}

function readOptionalRegistryMetadata(): RegistryMetadata | null {
  if (!existsSync(join(process.cwd(), 'server.json'))) {
    return null;
  }

  return readJson<RegistryMetadata>('server.json');
}

function expectSpecificVersion(version: string): void {
  expect(version).toBeTruthy();
  expect(version.toLowerCase()).not.toBe('latest');
  expect(version).not.toMatch(/[\^~<>*]|\bx\b|\|\|| - /i);
}

describe('MCP registry metadata', () => {
  it('does not carry a root manifest for the unverifiable 0.7.0 image', () => {
    const packageJson = readJson<PackageJson>('package.json');
    const metadata = readOptionalRegistryMetadata();
    const readiness = readRepoFile('docs/registry-readiness.md').replace(/\s+/g, ' ');

    if (metadata === null) {
      expect(readiness).toContain('Do not commit or publish root `server.json` for `0.7.0`');
      expect(readiness).toContain(`${GHCR_IMAGE}:X.Y.Z`);
      return;
    }

    const [ociPackage] = metadata.packages ?? [];

    expect(metadata.name).toBe(REGISTRY_NAME);
    expect(metadata.version).toBe(packageJson.version);
    expect(metadata.version).not.toBe('0.7.0');
    expect(metadata.repository).toEqual({
      url: 'https://github.com/enthouan/simplelogin-mcp',
      source: 'github',
      id: '1256322108',
    });
    expect(ociPackage).toMatchObject({
      registryType: 'oci',
      identifier: `${GHCR_IMAGE}:${packageJson.version}`,
      version: packageJson.version,
      transport: { type: 'stdio' },
    });

    expectSpecificVersion(metadata.version);
    expectSpecificVersion(ociPackage?.version ?? '');
    expectSpecificVersion(ociPackage?.identifier.split(':').at(-1) ?? '');
  });

  it('marks required secrets when an official MCP manifest exists', () => {
    const metadata = readOptionalRegistryMetadata();

    if (metadata === null) {
      expect(metadata).toBeNull();
      return;
    }

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

describe('Docker MCP Registry staging metadata', () => {
  it('pins the staged Docker registry entry to the current GHCR release image', () => {
    const packageJson = readJson<PackageJson>('package.json');
    const serverYaml = readRepoFile('registry/docker-mcp/server.yaml');
    const imageTag = new RegExp(`image: ${GHCR_IMAGE}:(\\S+)`).exec(serverYaml)?.[1] ?? '';
    const expectedReleaseCommit =
      RELEASE_COMMITS[packageJson.version as keyof typeof RELEASE_COMMITS];

    expect(serverYaml).toContain(`image: ${GHCR_IMAGE}:${packageJson.version}`);
    expectSpecificVersion(imageTag);
    expect(serverYaml).toContain(`commit: ${expectedReleaseCommit}`);
    expect(serverYaml).toContain('env: SL_API_KEY');
    expect(serverYaml).toContain('name: TRANSPORT\n      value: stdio');
    expect(serverYaml).toContain('project: https://github.com/enthouan/simplelogin-mcp');
  });

  it('keeps staged Docker tools in sync with the source tool catalog summaries', () => {
    expect(readRepoFile('registry/docker-mcp/tools.json')).toBe(renderDockerMcpToolsJson());
  });
});
