import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDockerMcpToolsJson } from '../src/tools/catalog.js';

const REGISTRY_NAME = 'io.github.enthouan/simplelogin-mcp';
const GHCR_IMAGE = 'ghcr.io/enthouan/simplelogin-mcp';
const SERVER_JSON_PATH = 'server.json';

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

describe('MCP registry metadata', () => {
  it('uses the GitHub namespace, current package version, and pinned GHCR OCI image', () => {
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
      version: packageJson.version,
      transport: { type: 'stdio' },
    });

    expectSpecificVersion(metadata.version);
    expectSpecificVersion(ociPackage?.version ?? '');
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

describe('Docker MCP Registry staging metadata', () => {
  it('pins the staged Docker registry entry to the current GHCR release image', () => {
    const packageJson = readJson<PackageJson>('package.json');
    const serverYaml = readRepoFile('registry/docker-mcp/server.yaml');
    const imageTag = new RegExp(`image: ${GHCR_IMAGE}:(\\S+)`).exec(serverYaml)?.[1] ?? '';

    expect(serverYaml).toContain(`image: ${GHCR_IMAGE}:${packageJson.version}`);
    expectSpecificVersion(imageTag);
    expect(serverYaml).toContain(
      'Set commit during the separately approved registry submission so it matches the image source.',
    );
    expect(serverYaml).not.toMatch(/^ {2}commit: [0-9a-f]{40}$/m);
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
