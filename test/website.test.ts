import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_NAMES } from '../src/tools/catalog.js';
import { normalizePublicationUrl } from '../website/src/data/publication.js';
import {
  REPOSITORY_URL,
  REPOSITORY_VISIBILITY_ENV,
  resolveRepositoryUrl,
} from '../website/src/data/repository.js';

interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files?: string[];
  scripts: Record<string, string>;
}

let outputRoot = '';
let productionRoot = '';
let publicRepositoryRoot = '';
let homeHtml = '';
let installHtml = '';
let securityHtml = '';
let toolsHtml = '';
const execFileAsync = promisify(execFile);

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

async function readOutputFile(path: string, root = outputRoot): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(root, absolutePath);
      return [relative(root, absolutePath).split(sep).join('/')];
    }),
  );
  return files.flat().sort();
}

async function buildWebsiteInFreshProcess(
  outputDir: string,
  baseUrl: string,
  repositoryPublic = false,
): Promise<void> {
  const websiteRoot = join(process.cwd(), 'website');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    WEBSITE_BASE_URL: baseUrl,
  };
  delete childEnv['VITEST'];
  delete childEnv['VITEST_POOL_ID'];
  delete childEnv['VITEST_WORKER_ID'];
  delete childEnv['TEST'];
  delete childEnv[REPOSITORY_VISIBILITY_ENV];
  if (repositoryPublic) childEnv[REPOSITORY_VISIBILITY_ENV] = 'true';
  // Exercise the config guard against ambient values injected by Vitest, shells, or CI runners.
  childEnv['BASE_URL'] = '/ambient-base-that-must-not-leak/';

  await execFileAsync(
    process.execPath,
    [
      join(websiteRoot, 'node_modules/astro/bin/astro.mjs'),
      'build',
      '--outDir',
      outputDir,
      '--force',
    ],
    {
      cwd: websiteRoot,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

function outputPathForUrl(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  if (decoded === '/') return 'index.html';
  if (decoded.endsWith('/')) return `${decoded.slice(1)}index.html`;
  return decoded.slice(1);
}

function collectIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
}

function stepItemCounts(html: string): number[] {
  return [...html.matchAll(/<ol role="list" class="sl-steps">([\s\S]*?)<\/ol>/g)].map(
    (match) => [...match[1]!.matchAll(/<li>/g)].length,
  );
}

beforeAll(async () => {
  productionRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-production-'));
  publicRepositoryRoot = await mkdtemp(
    join(tmpdir(), 'simplelogin-mcp-starlight-public-repository-'),
  );
  outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-'));
  await buildWebsiteInFreshProcess(productionRoot, 'https://docs.example.test/simplelogin-mcp');
  await buildWebsiteInFreshProcess(
    publicRepositoryRoot,
    'https://docs.example.test/simplelogin-mcp',
    true,
  );
  await buildWebsiteInFreshProcess(outputRoot, '');
  [homeHtml, installHtml, securityHtml, toolsHtml] = await Promise.all([
    readOutputFile('index.html'),
    readOutputFile('getting-started/index.html'),
    readOutputFile('guides/security/index.html'),
    readOutputFile('reference/tools/index.html'),
  ]);
}, 60_000);

afterAll(async () => {
  if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
  if (productionRoot) await rm(productionRoot, { recursive: true, force: true });
  if (publicRepositoryRoot) await rm(publicRepositoryRoot, { recursive: true, force: true });
});

describe('Starlight website', () => {
  it('builds a genuine multi-page Starlight documentation site', async () => {
    const files = await listFiles(outputRoot);

    expect(homeHtml).toContain('<meta name="generator" content="Starlight v');
    expect(homeHtml).toContain('class="hero');
    expect(homeHtml).toContain('site-search');
    expect(files).toContain('pagefind/pagefind.js');
    expect(files).toEqual(
      expect.arrayContaining([
        'index.html',
        '404.html',
        'getting-started/index.html',
        'getting-started/docker/index.html',
        'getting-started/http/index.html',
        'getting-started/stdio/index.html',
        'guides/workflows/index.html',
        'guides/security/index.html',
        'reference/tools/index.html',
      ]),
    );
  });

  it('renders the open-source Lucide mail icon as a local hero asset', async () => {
    const files = await listFiles(outputRoot);
    const heroMark = await readRepoFile('website/src/assets/simplelogin-mcp-mark.svg');

    expect(homeHtml).toMatch(
      /<img[^>]+src="\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"[^>]+alt="simplelogin-mcp"/,
    );
    expect(files.some((path) => /^_astro\/simplelogin-mcp-mark\..+\.svg$/.test(path))).toBe(true);
    expect(heroMark).toContain('https://lucide.dev/icons/mail');
    expect(heroMark).toContain('ISC License');
    expect(heroMark).toContain('d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"');
  });

  it('uses a caution panel to credit the developer and distinguish the official service', async () => {
    const disclaimer =
      'It is not an official SimpleLogin or Proton product, service, or MCP implementation, and it is not affiliated with, endorsed by, or sponsored by SimpleLogin or Proton.';
    const productionHomeHtml = await readOutputFile('index.html', productionRoot);

    for (const page of [homeHtml, installHtml, productionHomeHtml]) {
      const normalizedPage = page.replace(/\s+/g, ' ');
      const normalizedText = normalizedPage.replace(/<[^>]+>/g, '');

      expect(normalizedText.split(disclaimer)).toHaveLength(2);
      expect(normalizedPage).toContain(
        'aria-label="Independent project" class="starlight-aside starlight-aside--caution"',
      );
      expect(normalizedPage).toContain(
        'is an independent, community-maintained project developed by',
      );
      expect(normalizedPage).toMatch(
        /<a[^>]+href="https:\/\/www\.antoinemenard\.com"[^>]*>Antoine Ménard<\/a>/,
      );
      expect(normalizedPage).toMatch(
        /sponsored by <a href="https:\/\/simplelogin\.io\/">SimpleLogin<\/a> or <a href="https:\/\/proton\.me\/">Proton<\/a>\./,
      );
      expect(normalizedPage).toMatch(/Looking for SimpleLogin['’]s official service\?/);
      expect(normalizedPage).toMatch(
        /<a[^>]+href="https:\/\/simplelogin\.io\/"[^>]*>SimpleLogin<\/a>/,
      );
      expect(normalizedPage.indexOf('It is not an official')).toBeGreaterThan(
        normalizedPage.indexOf('<h1'),
      );
    }

    expect(homeHtml).toContain(`href="${REPOSITORY_URL}"`);
    expect(homeHtml).not.toContain('affiliation-notice');
    expect(homeHtml).not.toContain('Not affiliated with or endorsed by SimpleLogin or Proton.');
    expect(homeHtml).toContain('Independent MCP integration for SimpleLogin');
    expect(homeHtml).toContain('>Star on GitHub<');
    expect(homeHtml).toContain('rel="external" referrerpolicy="no-referrer"');
    expect(homeHtml).not.toContain('SimpleLogin × Model Context Protocol');
    expect(homeHtml).not.toMatch(/api\.github\.com|shields\.io|\/stargazers/);
    expect(homeHtml).not.toMatch(/\b\d[\d,.]*\s+(?:GitHub\s+)?stars?\b/i);
    expect(resolveRepositoryUrl(undefined, undefined)).toBe(REPOSITORY_URL);
    expect(resolveRepositoryUrl(new URL('https://docs.example.test/'), undefined)).toBeUndefined();
    expect(resolveRepositoryUrl(new URL('https://docs.example.test/'), 'true')).toBe(
      REPOSITORY_URL,
    );

    const customCss = await readRepoFile('website/src/styles/custom.css');
    expect(customCss).toMatch(/#ea319f|#ff93c9/);
    expect(customCss).toContain('#22c0e8');
    expect(customCss).toMatch(/#1b1340|#1b1730/);
  });

  it('renders every documented procedure as distinct Starlight steps', async () => {
    const [dockerHtml, httpHtml, stdioHtml, workflowsHtml] = await Promise.all([
      readOutputFile('getting-started/docker/index.html'),
      readOutputFile('getting-started/http/index.html'),
      readOutputFile('getting-started/stdio/index.html'),
      readOutputFile('guides/workflows/index.html'),
    ]);

    expect(stepItemCounts(installHtml)).toEqual([4]);
    expect(stepItemCounts(dockerHtml)).toEqual([4]);
    expect(stepItemCounts(httpHtml)).toEqual([4]);
    expect(stepItemCounts(stdioHtml)).toEqual([4]);
    expect(stepItemCounts(workflowsHtml)).toEqual([4, 3, 3, 3]);
  });

  it('renders the canonical tool catalog exactly once in the full reference', () => {
    const renderedNames = [...toolsHtml.matchAll(/data-tool-name="([^"]+)"/g)].map(
      (match) => match[1]!,
    );

    expect(renderedNames).toEqual(TOOL_NAMES);
    expect(new Set(renderedNames).size).toBe(TOOL_CATALOG.length);
    expect(toolsHtml).toContain(`data-tool-count="${TOOL_CATALOG.length}"`);
    expect(toolsHtml).toContain(`${TOOL_CATALOG.length} tools across five focused areas`);

    for (const category of new Set(TOOL_CATALOG.map((tool) => tool.category))) {
      const expectedCount = TOOL_CATALOG.filter((tool) => tool.category === category).length;
      expect(toolsHtml).toContain(`id="tool-group-${category}"`);
      expect(toolsHtml).toContain(`aria-label="${expectedCount} tools"`);
    }
  });

  it('uses the homepage catalog preview width to show four tools per category', () => {
    const previewHtml =
      /<figure class="catalog-preview[^"]*"[\s\S]*?<\/figure>/.exec(homeHtml)?.[0] ?? '';

    expect(previewHtml).not.toBe('');
    for (const category of new Set(TOOL_CATALOG.map((tool) => tool.category))) {
      const previewedTools = TOOL_CATALOG.filter((tool) => tool.category === category).slice(0, 4);
      for (const tool of previewedTools) expect(previewHtml).toContain(tool.name);
    }
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
      expect(homeHtml, `website snippet: ${phrase}`).toContain(phrase);
      expect(readme, `README contract: ${phrase}`).toContain(phrase);
    }

    expect(installHtml).toContain('data-install-method="docker"');
    expect(installHtml).toContain('data-install-method="http"');
    expect(installHtml).toContain('data-install-method="stdio"');
    expect(homeHtml).toContain('. ./.env');
    expect(homeHtml).not.toMatch(/SL_API_KEY=sl-[^\s<]+\s+pnpm start/);
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
    const warningStart = homeHtml.indexOf('aria-label="Protect both credentials"');
    const workflowStart = homeHtml.indexOf('Useful by design');
    const catalogStart = homeHtml.indexOf('One canonical tool catalog');

    expect(homeHtml).toContain('SL_API_KEY</code> grants full control');
    expect(homeHtml).toContain('<code dir="auto">MCP_AUTH_TOKEN</code> is a');
    expect(homeHtml).toContain('public or LAN HTTP belongs behind TLS');
    expect(warningStart).toBeGreaterThan(0);
    expect(warningStart).toBeLessThan(workflowStart);
    expect(warningStart).toBeLessThan(catalogStart);

    expect(securityHtml).toContain('full programmatic access to a SimpleLogin account');
    expect(securityHtml).toContain('refuses to start on a non-loopback address');
    expect(securityHtml).toContain('terminate TLS at a reverse proxy');
    expect(securityHtml).toContain('not CORS configuration and not authentication');
  });

  it('ships keyboard-complete Starlight tabs plus explicit clipboard states', async () => {
    const tabs = [...homeHtml.matchAll(/<a role="tab"/g)];
    const panels = [...homeHtml.matchAll(/<div id="tab-panel-[^"]+"[^>]+role="tabpanel"/g)];
    const copyButtons = [...homeHtml.matchAll(/aria-label="Copy [^"]+"/g)];
    const installMethodsSource = await readRepoFile('website/src/components/InstallMethods.astro');

    expect(homeHtml).toContain('<starlight-tabs');
    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);
    expect(copyButtons).toHaveLength(3);
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(homeHtml).toContain(key);
    for (const state of ['Copying…', 'Copied', 'Copy failed']) expect(homeHtml).toContain(state);
    expect(homeHtml).toContain('Installation method');
    expect(homeHtml).toContain('aria-controls');
    expect(homeHtml).toContain('role="status" aria-live="polite"');
    expect(homeHtml).toContain('<noscript>');
    expect(homeHtml).toContain('JavaScript is disabled');
    expect(homeHtml).toContain('Installation guides without JavaScript');
    expect(installMethodsSource).toMatch(/destination\.focus\(\);\s*destination\.click\(\);/);
  });

  it('resolves every generated internal page, asset, and fragment', async () => {
    const htmlFiles = (await listFiles(outputRoot)).filter((path) => path.endsWith('.html'));
    const htmlByPath = new Map(
      await Promise.all(htmlFiles.map(async (path) => [path, await readOutputFile(path)] as const)),
    );

    for (const [htmlPath, html] of htmlByPath) {
      const sourceUrl = new URL(`https://local.test/${htmlPath}`);
      const references = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1]!);

      for (const reference of references) {
        if (
          reference.startsWith('https://') ||
          reference.startsWith('mailto:') ||
          reference.startsWith('data:')
        ) {
          continue;
        }

        const targetUrl = new URL(reference, sourceUrl);
        const targetPath = outputPathForUrl(targetUrl.pathname);
        await expect(
          stat(join(outputRoot, targetPath)),
          `${htmlPath}: ${reference}`,
        ).resolves.toBeTruthy();

        if (targetUrl.hash && targetPath.endsWith('.html')) {
          const targetHtml = htmlByPath.get(targetPath) ?? (await readOutputFile(targetPath));
          expect(
            collectIds(targetHtml).has(decodeURIComponent(targetUrl.hash.slice(1))),
            `${htmlPath}: missing fragment ${reference}`,
          ).toBe(true);
        }
      }
    }
  });

  it('uses local runtime assets and contains no analytics, real secrets, or release-version copy', async () => {
    const websiteSources = (
      await Promise.all(
        [
          'website/src/content/docs',
          'website/src/components',
          'website/src/data',
          'website/src/styles',
        ].map(async (directory) =>
          Promise.all(
            (await listFiles(join(process.cwd(), directory))).map((path) =>
              readRepoFile(posix.join(directory, path)),
            ),
          ),
        ),
      )
    )
      .flat()
      .join('\n');

    expect(homeHtml).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/i);
    expect(homeHtml).not.toMatch(/googletagmanager|segment\.com|posthog|plausible\.io/i);
    expect(homeHtml).not.toMatch(/sl-[A-Za-z0-9]{20,}/);
    expect(websiteSources).not.toMatch(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/);
    expect(homeHtml).not.toMatch(/<a[^>]+href="https:\/\/ghcr\.io/);
  });

  it('keeps unconfigured builds out of indexes and adds no false canonical URL', async () => {
    const robots = await readOutputFile('robots.txt');
    const files = await listFiles(outputRoot);

    expect(homeHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(homeHtml).toMatch(/<meta\s+name="description"/);
    expect(homeHtml).toContain('<meta property="og:type" content="website"/>');
    expect(homeHtml.match(/<meta property="og:type"/g)).toHaveLength(1);
    expect(homeHtml).toContain('<meta name="twitter:card" content="summary"/>');
    expect(homeHtml.match(/<meta name="twitter:card"/g)).toHaveLength(1);
    expect(homeHtml).toContain('<meta property="og:title"');
    expect(homeHtml).toMatch(/<meta\s+property="og:description"/);
    expect(homeHtml).toContain('<link rel="shortcut icon" href="/favicon.svg"');
    expect(homeHtml).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(homeHtml).not.toContain('rel="canonical"');
    expect(homeHtml).not.toContain('property="og:url"');
    expect(robots).toBe('User-agent: *\nDisallow: /\n');
    expect(files.some((path) => path.startsWith('sitemap'))).toBe(false);
  });

  it('adds canonical, Open Graph, robots, and Starlight sitemap data for a real HTTPS URL', async () => {
    const productionHtml = await readOutputFile('index.html', productionRoot);
    const publicRepositoryHtml = await readOutputFile('index.html', publicRepositoryRoot);
    const robots = await readOutputFile('robots.txt', productionRoot);
    const notFoundHtml = await readOutputFile('404.html', productionRoot);
    const sitemapIndex = await readOutputFile('sitemap-index.xml', productionRoot);
    const sitemap = await readOutputFile('sitemap-0.xml', productionRoot);
    const websiteReadme = await readRepoFile('website/README.md');
    const canonical = 'https://docs.example.test/simplelogin-mcp/';

    expect(productionHtml).toContain(`<link rel="canonical" href="${canonical}"/>`);
    expect(productionHtml).toContain(`<meta property="og:url" content="${canonical}"/>`);
    expect(productionHtml).toContain('<meta name="robots" content="index, follow"/>');
    expect(productionHtml).toContain('href="/simplelogin-mcp/_astro/');
    expect(productionHtml).toContain(
      '<link rel="shortcut icon" href="/simplelogin-mcp/favicon.svg"',
    );
    expect(productionHtml).not.toContain('<link rel="shortcut icon" href="/favicon.svg"');
    expect(productionHtml).toContain('href="/simplelogin-mcp/getting-started/docker/"');
    expect(productionHtml).toMatch(
      /src="\/simplelogin-mcp\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"/,
    );
    expect(productionHtml).not.toMatch(/href="\/(?:getting-started|guides|reference)\//);
    expect(productionHtml).not.toMatch(
      /<a[^>]+href="https:\/\/github\.com\/enthouan\/simplelogin-mcp"/,
    );
    expect(productionHtml).not.toContain('>Star on GitHub<');
    expect(publicRepositoryHtml).toContain(`href="${REPOSITORY_URL}"`);
    expect(publicRepositoryHtml).toContain('>Star on GitHub<');
    expect(notFoundHtml).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(notFoundHtml).not.toContain('<meta name="robots" content="index, follow"/>');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`${canonical}sitemap-index.xml`);
    expect(sitemapIndex).toContain(`${canonical}sitemap-0.xml`);
    expect(sitemap).not.toContain('/404/');
    expect(websiteReadme).toContain('origin-root `/robots.txt`');
  });

  it('rejects unsafe or ambiguous publication URLs before writing output', () => {
    expect(() => normalizePublicationUrl('http://example.test')).toThrow('must use https');
    expect(() => normalizePublicationUrl('https://user:secret@example.test')).toThrow(
      'must not include credentials',
    );
    expect(() => normalizePublicationUrl('https://example.test/?preview=1')).toThrow(
      'must not include a query string or fragment',
    );
    expect(() => normalizePublicationUrl('https://example.test/path?')).toThrow(
      'must not include a query string or fragment',
    );
    expect(() => normalizePublicationUrl('https://example.test/path#')).toThrow(
      'must not include a query string or fragment',
    );
    expect(() => normalizePublicationUrl('https://example.test//cdn.example/')).toThrow(
      'must not use a protocol-relative path',
    );
    expect(() => normalizePublicationUrl('https://example.test/%2fcdn/')).toThrow(
      'contains an unsafe path separator',
    );
    expect(() => normalizePublicationUrl('https://example.test/docs%2Dsite/')).toThrow(
      'must not contain percent-encoded path segments',
    );
    expect(() => normalizePublicationUrl('https://example.test/%2e/foo/')).toThrow(
      'must not contain percent-encoded path segments',
    );
    expect(() => normalizePublicationUrl('https://example.test/foo/%2e%2e/bar/')).toThrow(
      'must not contain percent-encoded path segments',
    );
    expect(() => normalizePublicationUrl('https://example.test/docs site/')).toThrow(
      'must not contain percent-encoded path segments',
    );
    expect(() => normalizePublicationUrl('https://example.test/café/')).toThrow(
      'must not contain percent-encoded path segments',
    );
    expect(() => normalizePublicationUrl('https://example.test/foo//bar/')).toThrow(
      'must not contain repeated path separators',
    );
  });

  it('keeps website packages and output out of the MCP runtime artifact', async () => {
    const [dockerIgnore, dockerfile, packageSource, websitePackageSource] = await Promise.all([
      readRepoFile('.dockerignore'),
      readRepoFile('Dockerfile'),
      readRepoFile('package.json'),
      readRepoFile('website/package.json'),
    ]);
    const packageJson = JSON.parse(packageSource) as PackageJson;
    const websitePackageJson = JSON.parse(websitePackageSource) as PackageJson;

    expect(dockerIgnore.split('\n')).toContain('website');
    expect(packageJson.files).not.toContain('website');
    for (const dependency of ['@astrojs/check', '@astrojs/starlight', 'astro', 'sharp']) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency);
      expect(packageJson.devDependencies).not.toHaveProperty(dependency);
      expect(websitePackageJson.devDependencies).toHaveProperty(dependency);
    }
    expect(dockerfile).toContain('pnpm install --filter simplelogin-mcp --frozen-lockfile');
    expect(dockerfile).toContain(
      'pnpm install --filter simplelogin-mcp --prod --frozen-lockfile --ignore-scripts',
    );
  });
});
