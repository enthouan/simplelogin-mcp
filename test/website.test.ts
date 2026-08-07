import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_NAMES } from '../src/tools/catalog.js';
import { buildWebsite } from '../website/scripts/build.js';

interface PackageJson {
  scripts: Record<string, string>;
}

let outputRoot = '';
let html = '';

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

async function readOutputFile(path: string): Promise<string> {
  return readFile(join(outputRoot, path), 'utf8');
}

beforeAll(async () => {
  outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-website-'));
  await buildWebsite({ outputDir: outputRoot, baseUrl: '' });
  html = await readOutputFile('index.html');
});

afterAll(async () => {
  if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
});

describe('website build', () => {
  it('renders the canonical tool catalog exactly once in its coverage inventory', () => {
    const renderedNames = [...html.matchAll(/data-tool-name="([^"]+)"/g)].map((match) => match[1]!);

    expect(renderedNames).toEqual(TOOL_NAMES);
    expect(new Set(renderedNames).size).toBe(TOOL_CATALOG.length);
    expect(html).toContain(`data-tool-count="${TOOL_CATALOG.length}"`);
    expect(html).toContain(
      `${TOOL_CATALOG.length} tools across ${new Set(TOOL_CATALOG.map((tool) => tool.category)).size} focused areas`,
    );

    for (const category of new Set(TOOL_CATALOG.map((tool) => tool.category))) {
      const expectedCount = TOOL_CATALOG.filter((tool) => tool.category === category).length;
      expect(html).toContain(`id="tool-group-${category}"`);
      expect(html).toContain(`aria-label="${expectedCount} tools"`);
    }
  });

  it('has no unresolved templates, remote runtime assets, analytics, or release-version drift', async () => {
    const template = await readRepoFile('website/src/index.html');

    expect(html).not.toMatch(/{{[A-Z_]+}}/);
    expect(template).not.toMatch(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/);
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/i);
    expect(html).not.toMatch(/analytics|googletagmanager|segment\.com|posthog/i);
    expect(html).not.toMatch(/sl-[A-Za-z0-9]{20,}/);
  });

  it('keeps Docker, HTTP, and stdio examples aligned with repository contracts', async () => {
    const [readme, compose, config, packageSource] = await Promise.all([
      readRepoFile('README.md'),
      readRepoFile('docker-compose.yml'),
      readRepoFile('src/config.ts'),
      readRepoFile('package.json'),
    ]);
    const packageJson = JSON.parse(packageSource) as PackageJson;

    for (const phrase of [
      'docker compose up -d',
      'docker compose ps',
      'curl http://localhost:3000/health',
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'TRANSPORT=http',
      'HOST=127.0.0.1',
      'PORT=3000',
      'TRANSPORT": "stdio',
      'dist/index.js',
    ]) {
      expect(html, `website snippet: ${phrase}`).toContain(phrase);
      expect(readme, `README contract: ${phrase}`).toContain(phrase);
    }

    expect(compose).toContain('- TRANSPORT=http');
    expect(compose).toContain('- HOST=0.0.0.0');
    expect(compose).toContain('${SIMPLELOGIN_MCP_HOST_BIND_IP:-127.0.0.1}');
    expect(compose).toContain('MCP_AUTH_TOKEN');
    expect(config).toContain("HOST: z.string().min(1).default('127.0.0.1')");
    expect(config).toContain('PORT: z.coerce.number().int().min(1).max(65535).default(3000)');
    expect(packageJson.scripts['build']).toBe('tsc -p tsconfig.build.json');
    expect(packageJson.scripts['start']).toBe('node dist/index.js');
  });

  it('makes credential and HTTP exposure guidance prominent and complete', () => {
    const securityStart = html.indexOf('id="security"');
    const toolsStart = html.indexOf('id="tools"');

    expect(html).toContain('SL_API_KEY</code> grants full SimpleLogin account control');
    expect(html).toContain('MCP_AUTH_TOKEN</code> protects the HTTP server');
    expect(html).toContain('refuses an unauthenticated\n                non-loopback bind');
    expect(html).toContain('Terminate TLS at a reverse\n                proxy');
    expect(html).toContain('origin allowlist, not a CORS or authentication configuration');
    expect(securityStart).toBeGreaterThan(0);
    expect(securityStart).toBeLessThan(toolsStart);
  });

  it('resolves every local asset and in-page link with unique fragment targets', async () => {
    const idMatches = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
    const ids = new Set(idMatches);
    expect(ids.size).toBe(idMatches.length);

    const hrefs = [...html.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1]!);
    for (const href of hrefs) {
      if (href.startsWith('#')) {
        expect(ids.has(href.slice(1)), `missing fragment target ${href}`).toBe(true);
      } else if (href.startsWith('https://')) {
        expect(new URL(href).protocol).toBe('https:');
      } else {
        await expect(stat(join(outputRoot, href))).resolves.toBeTruthy();
      }
    }

    const scriptSources = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    for (const source of scriptSources) {
      await expect(stat(join(outputRoot, source))).resolves.toBeTruthy();
    }

    const externalAnchors = [...html.matchAll(/<a[^>]+href="(https:[^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(externalAnchors).toEqual([
      'https://simplelogin.io/',
      'https://modelcontextprotocol.io/',
    ]);
    expect(html).not.toMatch(/<a[^>]+href="https:\/\/(?:github\.com\/enthouan|ghcr\.io)/);
  });

  it('ships semantic install tabs, labeled copy controls, and a no-JavaScript fallback', async () => {
    const app = await readOutputFile('app.js');
    const styles = await readOutputFile('styles.css');
    const tabs = [
      ...html.matchAll(/<button\s+id="tab-[^"]+"[\s\S]*?role="tab"[\s\S]*?<\/button>/g),
    ];
    const panels = [...html.matchAll(/role="tabpanel"/g)];
    const copyButtons = [...html.matchAll(/class="copy-button"/g)];

    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);
    expect(copyButtons).toHaveLength(3);
    expect(html).not.toMatch(/<section[^>]+role="tabpanel"[^>]+hidden/);

    for (const method of ['docker', 'http', 'stdio']) {
      expect(html).toContain(`id="tab-${method}"`);
      expect(html).toContain(`aria-controls="panel-${method}"`);
      expect(html).toContain(`id="panel-${method}"`);
      expect(html).toContain(`aria-labelledby="tab-${method}"`);
      expect(html).toContain(`data-copy-target="snippet-${method}"`);
      expect(html).toContain(`id="snippet-${method}"`);
    }

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(app).toContain(key);
    for (const state of ['Copying…', 'Copied', 'Copy failed']) expect(app).toContain(state);
    expect(app).toContain("document.documentElement.classList.add('js')");
    expect(styles).toMatch(/\.tab-list\s*{[\s\S]*?display: none;/);
    expect(styles).toMatch(/\.js \.tab-list\s*{[\s\S]*?display: grid;/);
    expect(styles).toMatch(/\.install-card :focus-visible\s*{[\s\S]*?outline-color: #8fc6ff;/);
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition-duration: 0.01ms !important');
    expect(styles).toContain('animation-duration: 0.01ms !important');
  });

  it('includes core metadata and keeps an unconfigured build out of search indexes', async () => {
    const robots = await readOutputFile('robots.txt');

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<meta\s+name="description"/);
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:title"');
    expect(html).toMatch(/<meta\s+property="og:description"/);
    expect(html).toContain('<link rel="icon" href="favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(robots).toBe('User-agent: *\nDisallow: /\n');
    await expect(stat(join(outputRoot, 'sitemap.xml'))).rejects.toThrow();
  });

  it('adds canonical, Open Graph, robots, and sitemap data only for a real HTTPS base URL', async () => {
    const productionRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-website-production-'));

    try {
      await buildWebsite({
        outputDir: productionRoot,
        baseUrl: 'https://docs.example.test/simplelogin-mcp',
      });
      const productionHtml = await readFile(join(productionRoot, 'index.html'), 'utf8');
      const robots = await readFile(join(productionRoot, 'robots.txt'), 'utf8');
      const sitemap = await readFile(join(productionRoot, 'sitemap.xml'), 'utf8');
      const canonical = 'https://docs.example.test/simplelogin-mcp/';

      expect(productionHtml).toContain(`<link rel="canonical" href="${canonical}" />`);
      expect(productionHtml).toContain(`<meta property="og:url" content="${canonical}" />`);
      expect(productionHtml).toContain('<meta name="robots" content="index, follow" />');
      expect(robots).toContain('Allow: /');
      expect(robots).toContain(`${canonical}sitemap.xml`);
      expect(sitemap).toContain(`<loc>${canonical}</loc>`);
    } finally {
      await rm(productionRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe or ambiguous publication URLs before writing output', async () => {
    await expect(buildWebsite({ baseUrl: 'http://example.test' })).rejects.toThrow(
      'must use https',
    );
    await expect(buildWebsite({ baseUrl: 'https://user:secret@example.test' })).rejects.toThrow(
      'must not include credentials',
    );
    await expect(buildWebsite({ baseUrl: 'https://example.test/?preview=1' })).rejects.toThrow(
      'must not include a query string or fragment',
    );
  });

  it('keeps the website out of runtime packages and Docker build context', async () => {
    const [dockerIgnore, packageSource] = await Promise.all([
      readRepoFile('.dockerignore'),
      readRepoFile('package.json'),
    ]);
    const packageJson = JSON.parse(packageSource) as { files?: string[] };

    expect(dockerIgnore.split('\n')).toContain('website');
    expect(packageJson.files).not.toContain('website');
  });
});
