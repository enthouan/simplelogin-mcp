import { expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_NAMES } from '../../src/tools/catalog.js';
import { CLIENT_SETUPS } from '../../website/src/data/clients.js';
import { REPOSITORY_URL } from '../../website/src/data/repository.js';
import {
  apiCoverageHtml,
  homeHtml,
  installHtml,
  readOutputFile,
  readRepoFile,
  toolsHtml,
} from './support.js';
import type { PackageJson } from './support.js';

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('\u007f', '\n');
}

function installCopyPayload(html: string, method: 'docker' | 'http' | 'stdio'): string {
  const start = html.indexOf(`data-install-method="${method}"`);
  const end = html.indexOf('data-install-method="', start + 1);
  const methodHtml = html.slice(start, end === -1 ? undefined : end);
  const encoded = /data-code="([^"]*)"/.exec(methodHtml)?.[1];

  if (!encoded) throw new Error(`Missing generated copy payload for ${method}`);
  return decodeHtmlAttribute(encoded);
}

export function registerCatalogAndRuntimeContracts(): void {
  it('renders the canonical tool catalog exactly once in the full reference', () => {
    const renderedNames = [...toolsHtml.matchAll(/data-tool-name="([^"]+)"/g)].map(
      (match) => match[1]!,
    );

    expect(renderedNames).toEqual(TOOL_NAMES);
    expect(new Set(renderedNames).size).toBe(TOOL_CATALOG.length);
    expect(toolsHtml).toContain(`data-tool-count="${TOOL_CATALOG.length}"`);
    expect(toolsHtml).toContain(`${TOOL_CATALOG.length} supported tools across five focused areas`);

    for (const category of new Set(TOOL_CATALOG.map((tool) => tool.category))) {
      const expectedCount = TOOL_CATALOG.filter((tool) => tool.category === category).length;
      expect(toolsHtml).toContain(`id="tool-group-${category}"`);
      expect(toolsHtml).toContain(`aria-label="${expectedCount} tools"`);
      expect(toolsHtml.match(new RegExp(`href="#tool-group-${category}"`, 'g'))).toHaveLength(2);
    }

    expect(toolsHtml).toContain('id="starlight__on-this-page"');
    expect(toolsHtml).toContain('id="starlight__on-this-page--mobile"');

    for (const tool of TOOL_CATALOG) {
      expect(toolsHtml).toContain(`id="${tool.name}"`);
      expect(toolsHtml).toContain(`href="#${tool.name}"`);
    }

    expect(toolsHtml).toContain('data-catalog-search');
    expect(toolsHtml).toContain('data-catalog-category');
    expect(toolsHtml).toContain('data-catalog-behavior');
    expect(toolsHtml).toContain('Read only');
    expect(toolsHtml).toContain('Writes data');
    expect(toolsHtml).toContain('Destructive');
    expect(toolsHtml).toContain('Example prompt:');
    expect(toolsHtml).toContain('Inputs');
    expect(toolsHtml).toContain('Required');
    expect(toolsHtml).toContain('Optional');
  });

  it('renders API coverage from the canonical repository document', async () => {
    const [componentSource, canonicalSource] = await Promise.all([
      readRepoFile('website/src/components/ApiCoverage.astro'),
      readRepoFile('docs/api-coverage.md'),
    ]);

    expect(componentSource).toContain(
      "import { compiledContent } from '../../../docs/api-coverage.md'",
    );
    expect(apiCoverageHtml).toContain('rendered from the repository’s canonical API coverage');
    expect(apiCoverageHtml).toContain('Status Legend');
    expect(apiCoverageHtml).toContain('Coverage Matrix');
    expect(apiCoverageHtml).toContain('Explicit Non-Goals');
    expect(apiCoverageHtml).toContain('Deferred Areas To Revisit');
    expect(apiCoverageHtml).toContain('alias_create_random');
    expect(apiCoverageHtml.match(/class="api-coverage-table" tabindex="0"/g)).toHaveLength(2);
    expect(apiCoverageHtml.match(/<h1\b/g)).toHaveLength(1);
    for (const [slug, label] of [
      ['status-legend', 'Status Legend'],
      ['coverage-matrix', 'Coverage Matrix'],
      ['explicit-non-goals', 'Explicit Non-Goals'],
      ['deferred-areas-to-revisit', 'Deferred Areas To Revisit'],
    ] as const) {
      expect(apiCoverageHtml).toContain(`<h2 id="${slug}">${label}</h2>`);
      expect(apiCoverageHtml.match(new RegExp(`href="#${slug}"`, 'g'))).toHaveLength(2);
    }
    expect(apiCoverageHtml).toContain('id="starlight__on-this-page"');
    expect(apiCoverageHtml).toContain('id="starlight__on-this-page--mobile"');
    expect(canonicalSource).toContain('# SimpleLogin API Coverage and Scope');
    expect(canonicalSource).toContain('| **Supported** |');
    expect(apiCoverageHtml).toContain(`href="${REPOSITORY_URL}/blob/main/TOOL_CATALOG.md"`);
    expect(apiCoverageHtml).toContain(`href="${REPOSITORY_URL}/tree/main/src/tools"`);
  });

  it('prevents the enhanced tool catalog form from submitting', async () => {
    const catalogSource = await readRepoFile('website/src/components/ToolCatalog.astro');

    expect(catalogSource).toContain(
      "controls.addEventListener('submit', (event) => event.preventDefault())",
    );
  });

  it('ships the tested OpenCode stdio setup using an environment reference', () => {
    const openCode = CLIENT_SETUPS.find((client) => client.key === 'opencode');

    expect(openCode).toBeDefined();
    if (!openCode?.http) throw new Error('Missing OpenCode setup');
    expect(openCode.label).toBe('OpenCode');

    const config = JSON.parse(openCode.code) as {
      $schema: string;
      mcp: { servers: { simplelogin: unknown } };
    };
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.mcp.servers.simplelogin).toEqual({
      type: 'local',
      command: ['node', '/absolute/path/to/simplelogin-mcp/dist/index.js'],
      environment: {
        TRANSPORT: 'stdio',
        SL_API_KEY: '{env:SL_API_KEY}',
      },
    });
    expect(openCode.docsUrl).toBe('https://opencode.ai/v2/docs/mcp-servers');
    expect(openCode.secretNote).toContain('Configuration guidance is not a live interoperability');
    expect(openCode.secretNote).toContain('compatibility matrix for current evidence');

    const httpConfig = JSON.parse(openCode.http.code) as {
      mcp: { servers: { simplelogin: unknown } };
    };
    expect(httpConfig.mcp.servers.simplelogin).toEqual({
      type: 'remote',
      url: 'http://127.0.0.1:3000/mcp',
      oauth: false,
      headers: {
        Authorization: 'Bearer {env:SIMPLELOGIN_MCP_BEARER_TOKEN}',
      },
    });
  });

  it('keeps the tested Codex stdio setup free of a stored API key', () => {
    const codex = CLIENT_SETUPS.find((client) => client.key === 'codex');

    expect(codex).toBeDefined();
    expect(codex?.code).toContain('env_vars = ["SL_API_KEY"]');
    expect(codex?.code).not.toContain('SL_API_KEY =');
    expect(codex?.secretNote).toContain('without storing its value in TOML');
  });

  it('uses the homepage catalog preview width to show four tools per category', async () => {
    const previewHtml =
      /<figure class="catalog-preview[^"]*"[\s\S]*?<\/figure>/.exec(homeHtml)?.[0] ?? '';
    const previewSource = await readRepoFile('website/src/components/ToolCatalogPreview.astro');

    expect(previewHtml).not.toBe('');
    for (const category of new Set(TOOL_CATALOG.map((tool) => tool.category))) {
      const previewedTools = TOOL_CATALOG.filter((tool) => tool.category === category).slice(0, 4);
      for (const tool of previewedTools) expect(previewHtml).toContain(tool.name);
      expect(previewHtml).toContain(`href="reference/tools/#tool-group-${category}"`);
    }
    expect(previewSource).toMatch(/\.catalog-preview \{[\s\S]*?--catalog-preview-bg: #15121d;/);
    expect(previewSource).toMatch(
      /:global\(:root\[data-theme='light'\]\) \.catalog-preview \{[\s\S]*?--catalog-preview-bg: #ffffff;[\s\S]*?--catalog-preview-surface: #fdf0f7;/,
    );
    expect(previewSource).not.toContain('color-scheme');
    expect(previewSource).toContain('background: var(--catalog-preview-code-bg)');
    expect(previewSource).toContain('color: var(--sl-color-accent-high)');
    expect(previewSource).toContain('color: var(--sl-color-text-accent)');
  });

  it('keeps Docker, HTTP, and stdio examples aligned with repository contracts', async () => {
    const [readme, compose, config, packageSource, installSource, dockerHtml, httpHtml, stdioHtml] =
      await Promise.all([
        readRepoFile('README.md'),
        readRepoFile('docker-compose.yml'),
        readRepoFile('src/config.ts'),
        readRepoFile('package.json'),
        readRepoFile('website/src/data/install.ts'),
        readOutputFile('getting-started/docker/index.html'),
        readOutputFile('getting-started/http/index.html'),
        readOutputFile('getting-started/stdio/index.html'),
      ]);
    const packageJson = JSON.parse(packageSource) as PackageJson;
    const installPages = [installHtml, dockerHtml, httpHtml, stdioHtml]
      .join('\n')
      .replaceAll('&quot;', '"');

    for (const phrase of [
      'docker compose up -d',
      'docker compose ps',
      'curl http://localhost:3000/health',
      'pnpm install --filter simplelogin-mcp --frozen-lockfile',
      'pnpm build',
      'TRANSPORT=http',
      'HOST=127.0.0.1',
      'PORT=3000',
      'dist/index.js',
    ]) {
      expect(installPages, `website snippet: ${phrase}`).toContain(phrase);
      expect(readme, `README contract: ${phrase}`).toContain(phrase);
    }
    expect(installSource).toContain('"TRANSPORT": "stdio"');
    expect(readme).toContain('TRANSPORT=stdio');

    expect(installHtml).toContain('data-install-method="docker"');
    expect(installHtml).toContain('data-install-method="http"');
    expect(installHtml).toContain('data-install-method="stdio"');
    expect(httpHtml).toContain('. ./.env');

    const dockerCopy = installCopyPayload(installHtml, 'docker');
    const httpCopy = installCopyPayload(installHtml, 'http');
    expect(dockerCopy).toContain('${EDITOR:-vi} .env');
    expect(dockerCopy).toContain('Set SL_API_KEY in .env before starting.');
    expect(dockerCopy).toContain('Set MCP_AUTH_TOKEN in .env before starting.');
    expect(dockerCopy.indexOf('${EDITOR:-vi} .env')).toBeLessThan(
      dockerCopy.indexOf('docker compose up -d'),
    );
    expect(httpCopy).toContain('${EDITOR:-vi} .env');
    expect(httpCopy).toContain('git clone https://github.com/enthouan/simplelogin-mcp.git');
    expect(httpCopy).toContain('Set SL_API_KEY in .env before starting.');
    expect(httpCopy.indexOf('${EDITOR:-vi} .env')).toBeLessThan(httpCopy.indexOf('pnpm start'));
    expect(installPages).not.toMatch(/SL_API_KEY=sl-[^\s<]+\s+pnpm start/);
    expect(homeHtml).toContain('Pick your MCP client');
    expect(compose).toContain('- TRANSPORT=http');
    expect(compose).toContain('- HOST=0.0.0.0');
    expect(compose).toContain('${SIMPLELOGIN_MCP_HOST_BIND_IP:-127.0.0.1}');
    expect(compose).toContain('MCP_AUTH_TOKEN');
    expect(config).toContain("HOST: z.string().min(1).default('127.0.0.1')");
    expect(config).toContain('PORT: z.coerce.number().int().min(1).max(65535).default(3000)');
    expect(packageJson.scripts['build']).toBe('tsc -p tsconfig.build.json');
    expect(packageJson.scripts['start']).toBe('node dist/index.js');
  });
}
