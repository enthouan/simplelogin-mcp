import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_NAMES } from '../src/tools/catalog.js';
import { CLIENT_SETUPS, VERIFY_PROMPT } from '../website/src/data/clients.js';
import {
  CANONICAL_WEBSITE_URL,
  normalizePublicationUrl,
  resolvePublicationUrl,
} from '../website/src/data/publication.js';
import { REPOSITORY_URL } from '../website/src/data/repository.js';

interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files?: string[];
  scripts: Record<string, string>;
}

const LEGACY_REDIRECTS = {
  'getting-started/api-key': 'getting-started/simplelogin-api-key',
  'simplelogin-api-key': 'getting-started/simplelogin-api-key',
  'concepts/how-it-works': 'guides/how-it-works',
  'getting-started/configuration': 'reference/configuration',
  'getting-started/troubleshooting': 'guides/troubleshooting',
  tools: 'reference/tools',
  'tools/api-coverage': 'reference/api-coverage',
  'tools/workflows': 'guides/workflows',
  project: 'reference',
  'project/contributing': 'reference/contributing',
  'project/security-policy': 'reference/security-policy',
  security: 'guides/security',
  faq: 'guides/faq',
} as const;

let outputRoot = '';
let productionRoot = '';
let canonicalDefaultRoot = '';
let homeHtml = '';
let installHtml = '';
let apiKeyHtml = '';
let howItWorksHtml = '';
let securityHtml = '';
let toolsHtml = '';
let apiCoverageHtml = '';
let workflowsHtml = '';
let clientsHtml = '';
let compatibilityHtml = '';
let configurationHtml = '';
let troubleshootingHtml = '';
let faqHtml = '';
let referenceHtml = '';
let contributingHtml = '';
let reportingIssuesHtml = '';
let securityPolicyHtml = '';
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
  baseUrl: string | undefined,
): Promise<void> {
  const websiteRoot = join(process.cwd(), 'website');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
  };
  if (baseUrl === undefined) delete childEnv['WEBSITE_BASE_URL'];
  else childEnv['WEBSITE_BASE_URL'] = baseUrl;
  delete childEnv['VITEST'];
  delete childEnv['VITEST_POOL_ID'];
  delete childEnv['VITEST_WORKER_ID'];
  delete childEnv['TEST'];
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

beforeAll(async () => {
  productionRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-production-'));
  canonicalDefaultRoot = await mkdtemp(
    join(tmpdir(), 'simplelogin-mcp-starlight-canonical-default-'),
  );
  outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-'));
  await buildWebsiteInFreshProcess(productionRoot, 'https://docs.example.test/simplelogin-mcp');
  await buildWebsiteInFreshProcess(canonicalDefaultRoot, undefined);
  await buildWebsiteInFreshProcess(outputRoot, '');
  [
    homeHtml,
    installHtml,
    apiKeyHtml,
    howItWorksHtml,
    securityHtml,
    toolsHtml,
    apiCoverageHtml,
    workflowsHtml,
    clientsHtml,
    compatibilityHtml,
    configurationHtml,
    troubleshootingHtml,
    faqHtml,
    referenceHtml,
    contributingHtml,
    reportingIssuesHtml,
    securityPolicyHtml,
  ] = await Promise.all([
    readOutputFile('index.html'),
    readOutputFile('getting-started/index.html'),
    readOutputFile('getting-started/simplelogin-api-key/index.html'),
    readOutputFile('guides/how-it-works/index.html'),
    readOutputFile('guides/security/index.html'),
    readOutputFile('reference/tools/index.html'),
    readOutputFile('reference/api-coverage/index.html'),
    readOutputFile('guides/workflows/index.html'),
    readOutputFile('getting-started/clients/index.html'),
    readOutputFile('getting-started/compatibility/index.html'),
    readOutputFile('reference/configuration/index.html'),
    readOutputFile('guides/troubleshooting/index.html'),
    readOutputFile('guides/faq/index.html'),
    readOutputFile('reference/index.html'),
    readOutputFile('reference/contributing/index.html'),
    readOutputFile('reference/reporting-issues/index.html'),
    readOutputFile('reference/security-policy/index.html'),
  ]);
}, 60_000);

afterAll(async () => {
  if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
  if (productionRoot) await rm(productionRoot, { recursive: true, force: true });
  if (canonicalDefaultRoot) await rm(canonicalDefaultRoot, { recursive: true, force: true });
});

describe('Starlight website', () => {
  it('builds a genuine multi-page Starlight documentation site', async () => {
    const files = await listFiles(outputRoot);

    expect(homeHtml).toContain('<meta name="generator" content="Starlight v');
    expect(homeHtml).toContain('class="hero');
    expect(homeHtml).toContain('site-search');
    expect(homeHtml).toContain('href="getting-started/">Get started');
    expect(homeHtml).not.toContain('href="#get-started">Get started');
    expect(files).toContain('pagefind/pagefind.js');
    expect(files).toEqual(
      expect.arrayContaining([
        'index.html',
        '404.html',
        'llms.txt',
        'og-card.png',
        'request-flow.svg',
        'third-party-notices.txt',
        'getting-started/index.html',
        'getting-started/api-key/index.html',
        'getting-started/clients/index.html',
        'getting-started/compatibility/index.html',
        'getting-started/docker/index.html',
        'getting-started/http/index.html',
        'getting-started/simplelogin-api-key/index.html',
        'getting-started/stdio/index.html',
        'guides/how-it-works/index.html',
        'guides/faq/index.html',
        'guides/troubleshooting/index.html',
        'guides/workflows/index.html',
        'guides/security/index.html',
        'reference/index.html',
        'reference/configuration/index.html',
        'reference/tools/index.html',
        'reference/api-coverage/index.html',
        'reference/contributing/index.html',
        'reference/reporting-issues/index.html',
        'reference/security-policy/index.html',
        // Legacy routes remain as static redirects so old links keep working.
        'simplelogin-api-key/index.html',
        'getting-started/configuration/index.html',
        'getting-started/troubleshooting/index.html',
        'tools/index.html',
        'tools/api-coverage/index.html',
        'tools/workflows/index.html',
        'project/index.html',
        'project/contributing/index.html',
        'project/security-policy/index.html',
        'security/index.html',
        'faq/index.html',
        'concepts/how-it-works/index.html',
      ]),
    );
  });

  it('groups the documentation into Get started, Guides, and Reference navigation', async () => {
    const configSource = await readRepoFile('website/astro.config.mjs');
    const renderedGroups = [
      ...referenceHtml.matchAll(/<span class="large [^"]+">([^<]+)<\/span>/g),
    ].map((match) => match[1]!);

    expect(renderedGroups).toEqual(['Get started', 'Guides', 'Reference']);
    expect(configSource).not.toMatch(/label: '(?:Concepts|Project|Tools)'/);

    for (const [label, route] of [
      ['Install and run', 'getting-started/'],
      ['SimpleLogin API key', 'getting-started/simplelogin-api-key/'],
      ['Set up your MCP client', 'getting-started/clients/'],
      ['Compatibility', 'getting-started/compatibility/'],
      ['Docker Compose', 'getting-started/docker/'],
      ['Streamable HTTP', 'getting-started/http/'],
      ['stdio', 'getting-started/stdio/'],
      ['How it works', 'guides/how-it-works/'],
      ['Workflows', 'guides/workflows/'],
      ['Security &amp; Data', 'guides/security/'],
      ['Troubleshooting', 'guides/troubleshooting/'],
      ['FAQ', 'guides/faq/'],
      ['Overview', 'reference/'],
      ['Configuration', 'reference/configuration/'],
      ['Tool catalog', 'reference/tools/'],
      ['API coverage', 'reference/api-coverage/'],
      ['Contributing', 'reference/contributing/'],
      ['Reporting issues and support', 'reference/reporting-issues/'],
      ['Security policy', 'reference/security-policy/'],
    ] as const) {
      expect(referenceHtml).toMatch(
        new RegExp(`<a href="/${route.replaceAll('/', '\\/')}"[^>]*><span[^>]*>${label}<\\/span>`),
      );
    }
  });

  it('renders the open-source Lucide mail icon as a local hero asset', async () => {
    const files = await listFiles(outputRoot);
    const heroMark = await readRepoFile('website/src/assets/simplelogin-mcp-mark.svg');
    const favicon = await readRepoFile('website/public/favicon.svg');
    const socialCard = await readRepoFile('website/public/og-card.svg');
    const notices = await readOutputFile('third-party-notices.txt');

    expect(homeHtml).toMatch(
      /<img[^>]+src="\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"[^>]+alt="simplelogin-mcp mailbox mark"/,
    );
    expect(files.some((path) => /^_astro\/simplelogin-mcp-mark\..+\.svg$/.test(path))).toBe(true);
    expect(heroMark).toContain('https://lucide.dev/icons/mail');
    expect(heroMark).toContain('ISC License');
    expect(heroMark).toContain('fill="#b72570"');
    expect(heroMark).toContain('d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"');
    expect(favicon).toBe(heroMark);
    expect(socialCard).toContain('Full license: /third-party-notices.txt');
    expect(notices).toContain('https://lucide.dev/icons/hammer');
    expect(notices).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(notices).toContain('Permission to use, copy, modify, and/or distribute this software');
  });

  it('keeps the published social image synchronized with its SVG source', async () => {
    const websiteRoot = join(process.cwd(), 'website');
    const generatedPng = join(outputRoot, 'expected-og-card.png');

    try {
      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import sharp from 'sharp'; await sharp('public/og-card.svg').png().toFile(${JSON.stringify(generatedPng)});`,
        ],
        { cwd: websiteRoot },
      );

      expect(await readFile(join(websiteRoot, 'public/og-card.png'))).toEqual(
        await readFile(generatedPng),
      );
    } finally {
      await rm(generatedPng, { force: true });
    }
  });

  it('replaces the text-only architecture sketch with an accessible request-flow diagram', async () => {
    const [diagram, componentSource, productionHowItWorksHtml] = await Promise.all([
      readOutputFile('request-flow.svg'),
      readRepoFile('website/src/components/ArchitectureFlow.astro'),
      readOutputFile('guides/how-it-works/index.html', productionRoot),
    ]);

    expect(howItWorksHtml).not.toContain('MCP client  ── stdio or Streamable HTTP');
    for (const page of [homeHtml, howItWorksHtml]) {
      expect(page).toContain('data-request-flow');
      expect(page).toContain('role="region" aria-label="SimpleLogin request flow diagram"');
      expect(page).toContain('src="/request-flow.svg"');
      expect(page).not.toContain('Where requests and credentials travel');
      expect(page).not.toContain('open the full-size diagram');
    }
    expect(securityHtml).not.toContain('data-request-flow');
    expect(securityHtml).toContain('href="../how-it-works/"');

    expect(productionHowItWorksHtml).toContain('src="/simplelogin-mcp/request-flow.svg"');
    expect(diagram).toContain('role="img" aria-labelledby="title description"');
    expect(diagram).toContain('<title id="title">How a simplelogin-mcp tool call travels</title>');
    expect(diagram).toContain('>How a simplelogin-mcp tool call travels</text>');
    for (const label of ['Tool call', 'Tool result', 'API request', 'API response']) {
      expect(diagram).toContain(`>${label}</text>`);
    }
    expect(diagram).not.toContain('<marker');
    expect(diagram).not.toContain('<line');
    expect(diagram.match(/class="flow-arrow-request"/g)).toHaveLength(2);
    expect(diagram.match(/class="flow-arrow-result"/g)).toHaveLength(2);
    expect(diagram).toContain('holds SL_API_KEY');
    expect(diagram).toContain('receives SL_API_KEY on API calls');
    expect(diagram).toContain('keeps SL_API_KEY out of MCP requests and results');
    expect(diagram).toContain('#b72570');
    expect(diagram).toContain('@media (prefers-color-scheme: dark)');
    expect(diagram).toContain('.canvas { fill: #15121d; }');
    expect(diagram).toContain('.title, .node-title, .detail-title { fill: #fbf7fc; }');
    expect(diagram).toContain('.host-dot, .flow-arrow-request { fill: #ff83bf; }');
    expect(componentSource).toContain('overflow-x: auto');
    expect(componentSource).toContain('background: var(--sl-color-black)');
    expect(componentSource).toContain('tabindex="0"');
    expect(componentSource).toContain('width: max(100%, 52rem)');
    expect(componentSource).toContain('min-width: 52rem');
  });

  it('uses the mailbox mark and site title as the home link', async () => {
    const productionApiKeyHtml = await readOutputFile(
      'getting-started/simplelogin-api-key/index.html',
      productionRoot,
    );

    for (const [page, expectedHref, expectedAssetBase] of [
      [homeHtml, '/', '/'],
      [apiKeyHtml, '/', '/'],
      [productionApiKeyHtml, '/simplelogin-mcp/', '/simplelogin-mcp/'],
    ] as const) {
      const siteTitle = /<a href="([^"]+)" class="site-title[^>]*>([\s\S]*?)<\/a>/.exec(page);

      expect(siteTitle?.[1]).toBe(expectedHref);
      expect(siteTitle?.[2]).toMatch(/<img\b[^>]*\balt(?:=""|(?=\s|>))[^>]*>/);
      expect(siteTitle?.[2]).toMatch(
        new RegExp(
          `src="${expectedAssetBase.replaceAll('/', '\\/')}_astro\\/simplelogin-mcp-mark\\.[^"]+\\.svg"`,
        ),
      );
      expect(siteTitle?.[2]).toContain('simplelogin-mcp');
    }
  });

  it('uses a branded information panel to distinguish the official service', async () => {
    const disclaimer =
      'It is not an official SimpleLogin or Proton AG product, service, or MCP implementation, and it is not affiliated with, endorsed by, or sponsored by SimpleLogin or Proton AG.';
    const productionHomeHtml = await readOutputFile('index.html', productionRoot);

    for (const page of [homeHtml, installHtml, productionHomeHtml]) {
      const normalizedPage = page.replace(/\s+/g, ' ');
      const normalizedText = normalizedPage.replace(/<[^>]+>/g, '');

      expect(normalizedText.split(disclaimer)).toHaveLength(2);
      expect(normalizedPage).toContain(
        'aria-label="Independent integration for SimpleLogin" class="starlight-aside starlight-aside--note"',
      );
      expect(normalizedPage).toContain('is an independent, open-source project.');
      const noticeHtml =
        /<aside aria-label="Independent integration for SimpleLogin"[\s\S]*?<\/aside>/.exec(
          normalizedPage,
        )?.[0] ?? '';
      expect(noticeHtml).not.toContain('antoinemenard.com');
      expect(noticeHtml).not.toContain('Antoine Ménard');
      expect(normalizedPage).toContain('sponsored by SimpleLogin or Proton AG.');
      expect(normalizedPage).not.toMatch(
        /sponsored by <a[^>]*>SimpleLogin<\/a> or <a[^>]*>Proton AG<\/a>\./,
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
    expect(homeHtml).not.toContain('Not affiliated with or endorsed by SimpleLogin or Proton AG.');
    expect(homeHtml).not.toContain('Open source and independently maintained');
    expect(homeHtml).not.toContain('>Star on GitHub<');
    expect(homeHtml).not.toContain('>MIT licensed<');
    expect(homeHtml).not.toContain('>Self-hostable<');
    expect(homeHtml).not.toContain('>Node 24<');
    expect(homeHtml).toContain('rel="external" referrerpolicy="no-referrer"');
    expect(homeHtml).not.toContain('SimpleLogin × Model Context Protocol');
    expect(homeHtml).not.toMatch(/api\.github\.com|shields\.io|\/stargazers/);
    expect(homeHtml).not.toMatch(/\b\d[\d,.]*\s+(?:GitHub\s+)?stars?\b/i);
    const headerHtml = homeHtml.slice(homeHtml.indexOf('<header'), homeHtml.indexOf('</header>'));
    expect(headerHtml).toContain(`<a href="${REPOSITORY_URL}" rel="me"`);
    expect(headerHtml).toContain('>simplelogin-mcp source repository</span>');

    const customCss = await readRepoFile('website/src/styles/custom.css');
    expect(customCss).toMatch(/#ea319f|#ff93c9/);
    expect(customCss).toContain('#b72570');
    expect(customCss).toMatch(/#1b1340|#1b1730/);
    expect(customCss).toContain('.starlight-aside--note {');
    expect(customCss).toContain('--sl-color-asides-border: var(--sl-color-accent)');
    expect(customCss).toContain('--simplelogin-mcp-info-bg: #241a22');
    expect(customCss).toMatch(
      /:root\[data-theme='light'\][\s\S]*?--simplelogin-mcp-info-bg: #fdf0f7;/,
    );
    expect(customCss).toContain('background-color: var(--simplelogin-mcp-info-bg)');
    expect(clientsHtml).toContain(
      'aria-label="Client-tested stdio recipes" class="starlight-aside starlight-aside--note"',
    );
  });

  it('adds the independent project footer to every documentation page', async () => {
    const footerSource = await readRepoFile('website/src/components/Footer.astro');

    for (const page of [homeHtml, installHtml, securityHtml, toolsHtml]) {
      expect(page).toMatch(/class="project-footer(?:\s|")/);
      expect(page).toContain('aria-label="Documentation links"');
      expect(page).toContain(
        'simplelogin-mcp is an open-source project released under the MIT License and maintained by',
      );
      expect(page).toContain('href="https://www.antoinemenard.com"');
      expect(page).toContain('href="https://simplelogin.io/"');
      expect(page).toContain('href="https://proton.me/"');
      expect(page).toContain('href="https://astro.build/"');
      expect(page).toContain('href="https://starlight.astro.build/"');
      expect(page).toContain('Starlight</a> documentation theme');
      expect(page).toContain('href="/reference/"');
      expect(page).toContain('>Reference</a>');
      expect(page).toContain('href="/guides/security/"');
      expect(page).toContain('>Security &amp; Data</a>');
    }

    expect(footerSource).not.toContain('@astrojs/starlight/components/EditLink.astro');
    expect(footerSource).not.toContain('@astrojs/starlight/components/LastUpdated.astro');
    expect(footerSource).toContain('@astrojs/starlight/components/Pagination.astro');
    expect(footerSource).not.toContain('<div class="meta sl-flex">');
    expect(footerSource).toContain('padding-block-start: 4.5rem');
    expect(footerSource).toContain('<div class="project-footer__bar">');
    expect(footerSource).toContain('justify-content: space-between');
    expect(footerSource).not.toContain('max-width: 46rem');
    expect(footerSource).not.toContain('grid-template-columns: minmax(0, 1fr) auto');
  });

  it('renders static repository trust details without build-time GitHub requests', async () => {
    const [repositorySource, repositoryDataSource, websiteReadme] = await Promise.all([
      readRepoFile('website/src/components/RepositoryLink.astro'),
      readRepoFile('website/src/data/repository.ts'),
      readRepoFile('website/README.md'),
    ]);

    for (const page of [referenceHtml, contributingHtml, reportingIssuesHtml]) {
      expect(page).toContain('>Star on GitHub<');
      expect(page).toContain('>MIT licensed<');
      expect(page).toContain('>Self-hostable<');
      expect(page).toContain('>Node 24<');
      expect(page).not.toMatch(/api\.github\.com|GitHub stars|Latest v/);
    }
    expect(reportingIssuesHtml).toContain('>Open an issue<');
    expect(repositorySource).not.toMatch(/fetch|GitHub stars|latestRelease|node:process/);
    expect(repositoryDataSource.trim()).toBe(`export const REPOSITORY_URL = '${REPOSITORY_URL}';`);
    expect(repositorySource).toContain('--sl-card-border: var(--sl-color-gray-5)');
    expect(repositorySource).toContain('--sl-card-bg: var(--sl-color-gray-6)');
    expect(websiteReadme).toContain('Builds do not call the GitHub API');
    expect(websiteReadme).not.toContain('WEBSITE_DISABLE_REPOSITORY_METADATA');
  });

  it('renders every documented procedure as distinct Starlight steps', async () => {
    const [dockerHtml, httpHtml, stdioHtml] = await Promise.all([
      readOutputFile('getting-started/docker/index.html'),
      readOutputFile('getting-started/http/index.html'),
      readOutputFile('getting-started/stdio/index.html'),
    ]);

    expect(stepItemCounts(installHtml)).toEqual([5]);
    expect(stepItemCounts(homeHtml)).toEqual([3]);
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
    const [componentSource, canonicalSource, productionApiCoverageHtml, canonicalApiCoverageHtml] =
      await Promise.all([
        readRepoFile('website/src/components/ApiCoverage.astro'),
        readRepoFile('docs/api-coverage.md'),
        readOutputFile('reference/api-coverage/index.html', productionRoot),
        readOutputFile('reference/api-coverage/index.html', canonicalDefaultRoot),
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
    for (const page of [productionApiCoverageHtml, canonicalApiCoverageHtml]) {
      expect(page).toContain(`href="${REPOSITORY_URL}/blob/main/TOOL_CATALOG.md"`);
      expect(page).toContain(`href="${REPOSITORY_URL}/tree/main/src/tools"`);
    }
  });

  it('publishes reference, contribution, issue-reporting, and private security guidance', async () => {
    const [
      productionReferenceHtml,
      productionContributingHtml,
      productionReportingIssuesHtml,
      productionSecurityPolicyHtml,
      canonicalReferenceHtml,
      canonicalContributingHtml,
      canonicalReportingIssuesHtml,
      canonicalSecurityPolicyHtml,
    ] = await Promise.all([
      readOutputFile('reference/index.html', productionRoot),
      readOutputFile('reference/contributing/index.html', productionRoot),
      readOutputFile('reference/reporting-issues/index.html', productionRoot),
      readOutputFile('reference/security-policy/index.html', productionRoot),
      readOutputFile('reference/index.html', canonicalDefaultRoot),
      readOutputFile('reference/contributing/index.html', canonicalDefaultRoot),
      readOutputFile('reference/reporting-issues/index.html', canonicalDefaultRoot),
      readOutputFile('reference/security-policy/index.html', canonicalDefaultRoot),
    ]);

    expect(referenceHtml).toContain('self-hostable, MIT-licensed open source project');
    expect(referenceHtml).toContain('Technical reference');
    expect(referenceHtml).toContain('Repository policies');
    expect(referenceHtml).toContain('href="api-coverage/"');
    expect(referenceHtml).toContain('href="reporting-issues/"');
    expect(referenceHtml).toContain('href="security-policy/"');
    expect(contributingHtml).toContain('Keep live credentials out of contribution artifacts');
    expect(contributingHtml).toContain('pnpm install --frozen-lockfile');
    expect(contributingHtml).toContain('pnpm website:check');
    expect(contributingHtml).toContain('pnpm format:check');
    expect(stepItemCounts(contributingHtml)).toEqual([5]);
    expect(reportingIssuesHtml).toContain('Choose the right channel');
    expect(reportingIssuesHtml).toContain('Prepare a reproducible issue');
    expect(reportingIssuesHtml).toContain('SL_API_KEY');
    expect(reportingIssuesHtml).toContain('MCP_AUTH_TOKEN');
    expect(reportingIssuesHtml).toContain('authorization headers');
    expect(reportingIssuesHtml).toContain('private account data');
    expect(stepItemCounts(reportingIssuesHtml)).toEqual([6]);
    expect(securityPolicyHtml).toContain('Do not open a public vulnerability report');
    expect(securityPolicyHtml).toMatch(/Security → Report a\s+vulnerability/);
    expect(securityPolicyHtml).toContain('SL_API_KEY');
    expect(securityPolicyHtml).toContain('MCP_AUTH_TOKEN');
    expect(stepItemCounts(securityPolicyHtml)).toEqual([4]);

    for (const page of [
      productionReferenceHtml,
      productionContributingHtml,
      productionReportingIssuesHtml,
      canonicalReferenceHtml,
      canonicalContributingHtml,
      canonicalReportingIssuesHtml,
    ]) {
      expect(page).toContain(`href="${REPOSITORY_URL}"`);
    }
    for (const page of [productionReportingIssuesHtml, canonicalReportingIssuesHtml]) {
      expect(page).toContain(`href="${REPOSITORY_URL}/issues/new/choose"`);
      expect(page).toContain('Open an issue');
    }
    for (const page of [productionSecurityPolicyHtml, canonicalSecurityPolicyHtml]) {
      expect(page).not.toContain('/security/advisories/new');
    }
  });

  it('keeps critical website policy guidance aligned with repository policy files', async () => {
    const [contributing, security, support, websiteContributing, websiteSecurity] =
      await Promise.all([
        readRepoFile('CONTRIBUTING.md'),
        readRepoFile('SECURITY.md'),
        readRepoFile('SUPPORT.md'),
        readRepoFile('website/src/content/docs/reference/contributing.mdx'),
        readRepoFile('website/src/content/docs/reference/security-policy.mdx'),
      ]);

    expect(contributing).toContain('pnpm website:check');
    expect(websiteContributing).toContain('pnpm website:check');
    for (const policy of [security, support, websiteSecurity]) {
      expect(policy).toMatch(/vulnerab/i);
      expect(policy).toMatch(/not (?:publish|open a public)/i);
    }
  });

  it('redirects every previous documentation route to its canonical page', async () => {
    for (const [legacyRoute, canonicalRoute] of Object.entries(LEGACY_REDIRECTS)) {
      const [localRedirect, productionRedirect] = await Promise.all([
        readOutputFile(`${legacyRoute}/index.html`),
        readOutputFile(`${legacyRoute}/index.html`, productionRoot),
      ]);

      expect(localRedirect).toContain(`content="0;url=/${canonicalRoute}/"`);
      expect(localRedirect).toContain('<meta name="robots" content="noindex">');
      expect(productionRedirect).toContain(`content="0;url=/simplelogin-mcp/${canonicalRoute}/"`);
      expect(productionRedirect).toContain(
        `href="https://docs.example.test/simplelogin-mcp/${canonicalRoute}/"`,
      );
    }
  });

  it('prevents the enhanced tool catalog form from submitting', async () => {
    const catalogSource = await readRepoFile('website/src/components/ToolCatalog.astro');

    expect(catalogSource).toContain(
      "controls.addEventListener('submit', (event) => event.preventDefault())",
    );
  });

  it('leads with an alias-creation demo and client-first onboarding', async () => {
    const homepageSource = await readRepoFile('website/src/content/docs/index.mdx');
    const demoStart = homeHtml.indexOf('Let your MCP client create an alias for you');
    const clientStart = homeHtml.indexOf('Pick your MCP client');
    const workflowStart = homeHtml.indexOf('Useful by design');
    const demoHtml = homeHtml.slice(demoStart, clientStart);

    expect(demoStart).toBeGreaterThan(0);
    expect(clientStart).toBeGreaterThan(demoStart);
    expect(workflowStart).toBeGreaterThan(clientStart);
    expect(demoHtml).toContain('Alias creation example prompt');
    expect(demoHtml).toContain('Can you create a new random SimpleLogin alias for me?');
    expect(demoHtml).toContain('alias_create_random');
    expect(demoHtml).not.toContain('This changes your SimpleLogin account');
    expect(demoHtml).not.toContain('account_get_stats');
    expect(homeHtml).not.toContain('Where requests and credentials travel');
    expect(homeHtml).toContain(
      `<a href="reference/tools/">See all ${TOOL_CATALOG.length} tools</a>`,
    );

    for (const [href, label] of [
      ['guides/workflows/', 'Follow the workflow guide'],
      ['reference/tools/', `Browse all ${TOOL_CATALOG.length} tools`],
    ] as const) {
      expect(homeHtml).toMatch(
        new RegExp(
          `<a class="sl-link-button[^"]*primary[^"]*" href="${href}">[\\s\\S]*?${label}[\\s\\S]*?<\\/a>`,
        ),
      );
    }

    const githubHeroAction =
      /<a class="sl-link-button[^"]*secondary[^"]*"[^>]*href="https:\/\/github\.com\/enthouan\/simplelogin-mcp"[^>]*>[\s\S]*?View on GitHub<\/a>/.exec(
        homeHtml,
      )?.[0] ?? '';
    expect(githubHeroAction).not.toBe('');
    expect(githubHeroAction).toContain('<svg');
    expect(githubHeroAction.indexOf('<svg')).toBeLessThan(
      githubHeroAction.indexOf('View on GitHub'),
    );
    expect(githubHeroAction).toContain('rel="external"');
    expect(githubHeroAction).toContain('referrerpolicy="no-referrer"');
    expect(homepageSource).toMatch(
      /- text: View on GitHub\s+link: https:\/\/github\.com\/enthouan\/simplelogin-mcp\s+icon: github/,
    );

    const homepageClients = CLIENT_SETUPS.map((client) => client.key);
    const homepageClientPositions = homepageClients.map((client) =>
      homeHtml.indexOf(`href="getting-started/clients/#${client}"`),
    );

    expect(homepageClientPositions.every((position) => position > 0)).toBe(true);
    expect(homepageClientPositions).toEqual(
      [...homepageClientPositions].sort((first, second) => first - second),
    );
    const detailedClientPositions = CLIENT_SETUPS.map((client) =>
      clientsHtml.indexOf(`id="${client.key}"`),
    );
    expect(detailedClientPositions.every((position) => position > 0)).toBe(true);
    expect(detailedClientPositions).toEqual(
      [...detailedClientPositions].sort((first, second) => first - second),
    );
    for (const client of CLIENT_SETUPS) {
      expect(clientsHtml).toContain(`data-client-key="${client.key}"`);
      expect(homeHtml).toContain(`href="getting-started/clients/#${client.key}"`);
      expect(homeHtml).toContain(`>${client.label}</span>`);
    }

    expect(homeHtml).toMatch(/generic transport\s+requirements/);
    expect(homeHtml).toContain('href="getting-started/compatibility/#transport-requirements"');
    expect(homeHtml).not.toContain('Generic MCP');
    expect(clientsHtml).not.toContain('Generic MCP');
    expect(compatibilityHtml).toContain('Generic MCP');
    expect(homeHtml).toContain('Each tested label means the documented local stdio recipe');
    expect(homeHtml.match(/Client tested —/g)).toHaveLength(CLIENT_SETUPS.length);
    expect(homeHtml).toContain('discovered all 27 tools');
    expect(homeHtml).not.toContain(VERIFY_PROMPT);
    expect(clientsHtml).toContain(VERIFY_PROMPT);
    expect(homeHtml).not.toContain('Do not call any other tool');
    expect(clientsHtml).toContain('Client-tested stdio recipes');
    expect(clientsHtml).toContain('The Streamable HTTP examples are');
    expect(compatibilityHtml).toContain('Configuration reviewed');
    expect(compatibilityHtml).toContain('It has not been represented as a live interoperability');
  });

  it('pairs homepage cards and detailed client sections with recognizable icons', async () => {
    const homepageSource = await readRepoFile('website/src/content/docs/index.mdx');
    const clientSetupSource = await readRepoFile('website/src/components/ClientSetup.astro');
    const customCss = await readRepoFile('website/src/styles/custom.css');
    const notices = await readRepoFile('website/public/third-party-notices.txt');
    const productionFiles = await listFiles(productionRoot);
    const productionCss = (
      await Promise.all(
        productionFiles
          .filter((path) => path.endsWith('.css'))
          .map((path) => readOutputFile(path, productionRoot)),
      )
    ).join('\n');
    const clientIcons = {
      'claude-desktop': 'claude',
      'claude-code': 'claude',
      codex: 'openai',
      opencode: 'opencode',
      'vs-code': 'vscode',
    } as const;

    expect(homeHtml.match(/data-client-icon=/g)).toHaveLength(6);
    for (const [client, icon] of Object.entries(clientIcons)) {
      expect(homepageSource).toMatch(
        new RegExp(`href="getting-started/clients/#${client}"\\s+data-client-icon="${icon}"`),
      );
      expect(homeHtml).toMatch(
        new RegExp(
          `<a[^>]+href="getting-started/clients/#${client}"[^>]+data-client-icon="${icon}"`,
        ),
      );
    }
    expect(homepageSource).toMatch(
      /href="getting-started\/compatibility\/"\s+data-client-icon="evidence"/,
    );
    expect(homeHtml).toMatch(
      /<a[^>]+href="getting-started\/compatibility\/"[^>]+data-client-icon="evidence"/,
    );
    for (const client of CLIENT_SETUPS) {
      expect(clientsHtml).toContain(
        `data-client-key="${client.key}" data-client-icon="${client.icon}"`,
      );
    }
    expect(clientSetupSource).toContain('tab.dataset.clientIcon = icon');

    for (const icon of ['claude', 'openai', 'vscode', 'opencode', 'evidence']) {
      const source = await readRepoFile(`website/src/assets/client-icons/${icon}.svg`);
      expect(source).toContain('<svg');
      expect(source).toContain('<title>');
      expect(customCss).toContain(`a[data-client-icon='${icon}']`);
      expect(customCss).toContain(`url('../assets/client-icons/${icon}.svg')`);
      expect(productionCss).toContain(`[data-client-icon=${icon}]`);
    }

    expect(customCss).toContain('.sl-link-card a[data-client-icon] .title::before');
    expect(customCss).toContain('.sl-markdown-content h2#codex');
    expect(customCss).toContain('.sl-markdown-content h2#vs-code');
    expect(customCss).toContain('--client-heading-icon');
    expect(customCss).toContain('mask: var(--client-heading-icon) center / contain no-repeat');
    expect(customCss).toContain('background-color: currentColor');
    expect(customCss).toContain('mask: var(--client-card-icon) center / contain no-repeat');
    expect(productionCss.match(/--client-card-icon:url\("data:image\/svg\+xml,/g)).toHaveLength(5);
    expect(productionCss).not.toContain("url('/client-icons/");
    expect(productionCss).not.toContain('url("/client-icons/');
    expect(notices).toContain('Simple Icons client marks');
    expect(notices).toContain('OpenCode');
    expect(notices).toContain('Lucide Mail, Clipboard Check, and Hammer icons');
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
    expect(openCode.secretNote).toContain('local stdio recipe has been maintainer-tested');
    expect(openCode.secretNote).toContain('HTTP example remains documentation-reviewed');

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

  it('ships the supporting architecture, configuration, troubleshooting, and FAQ content', () => {
    expect(howItWorksHtml).toContain('MCP client');
    expect(howItWorksHtml).toContain('simplelogin-mcp');
    expect(howItWorksHtml).toContain('SimpleLogin');
    expect(howItWorksHtml).toContain('Request lifecycle');
    expect(securityHtml).toContain('Credential boundaries');
    expect(configurationHtml).toContain('SL_API_KEY');
    expect(configurationHtml).toContain('MCP_AUTH_TOKEN');
    expect(configurationHtml).toContain('Keep <code dir="auto">SL_API_URL</code> on HTTPS');
    expect(securityHtml).toContain('Use HTTPS for the SimpleLogin API');
    expect(faqHtml).toContain('Plain HTTP leaves it unencrypted');
    expect(troubleshootingHtml).toContain('Unauthorized');
    expect(troubleshootingHtml).toContain('Forbidden origin');
    expect(faqHtml).toContain('When should I use simplelogin-mcp?');
    expect(faqHtml).toContain('When should I use SimpleLogin directly?');
    expect(faqHtml).toContain('How are <code dir="auto">SL_API_KEY</code> and');
    expect(faqHtml).toContain('<code dir="auto">MCP_AUTH_TOKEN</code> different?');
    expect(faqHtml).toMatch(
      /maintained by <a href="https:\/\/www\.antoinemenard\.com">Antoine\s+Ménard<\/a>/,
    );
  });

  it('publishes and links a dedicated SimpleLogin API key guide', async () => {
    const [
      localShortRedirectHtml,
      productionShortRedirectHtml,
      localRootRedirectHtml,
      productionRootRedirectHtml,
    ] = await Promise.all([
      readOutputFile('getting-started/api-key/index.html'),
      readOutputFile('getting-started/api-key/index.html', productionRoot),
      readOutputFile('simplelogin-api-key/index.html'),
      readOutputFile('simplelogin-api-key/index.html', productionRoot),
    ]);

    expect(apiKeyHtml).toContain('Get a SimpleLogin API key');
    expect(apiKeyHtml).toContain('https://app.simplelogin.io/dashboard/api_key');
    expect(apiKeyHtml).toContain('Open SimpleLogin API Keys');
    expect(apiKeyHtml).toContain('Independent integration for SimpleLogin');
    expect(apiKeyHtml).toContain('Before you begin');
    expect(apiKeyHtml).toContain('New API Key');
    expect(apiKeyHtml).toContain('the oldest unused keys and then the oldest used keys');
    expect(apiKeyHtml).toContain('Copy the new key immediately');
    expect(apiKeyHtml).toContain('only makes the complete key available on this screen');
    expect(apiKeyHtml).toContain('SL_API_KEY');
    expect(apiKeyHtml).toContain('SL_API_URL');
    expect(apiKeyHtml).toContain('MCP_AUTH_TOKEN');
    expect(apiKeyHtml).toContain('Self-hosted SimpleLogin');
    expect(apiKeyHtml).toContain('Rotate or revoke a key');
    expect(apiKeyHtml).toContain('revoke every API key on the account');
    expect(apiKeyHtml).toContain('Troubleshooting');
    expect(apiKeyHtml).toContain('Official SimpleLogin references');
    expect(apiKeyHtml).toContain('Continue setup');
    expect(apiKeyHtml).toContain('href="../clients/"');
    expect(apiKeyHtml).toContain('href="../../reference/configuration/"');
    expect(apiKeyHtml).toContain('href="../../guides/security/"');
    expect(stepItemCounts(apiKeyHtml)).toEqual([7, 5]);
    expect(apiKeyHtml).toMatch(
      /<a class="sl-link-button[^"]*primary[^"]*" href="https:\/\/app\.simplelogin\.io\/dashboard\/api_key">[\s\S]*?Open SimpleLogin API Keys[\s\S]*?<\/a>/,
    );
    expect(apiKeyHtml).toContain(
      'aria-label="Independent integration for SimpleLogin" class="starlight-aside starlight-aside--note"',
    );
    expect(apiKeyHtml).toContain(
      'aria-label="Treat the key like a password" class="starlight-aside starlight-aside--danger"',
    );
    expect(homeHtml).toContain('href="getting-started/simplelogin-api-key/"');
    expect(installHtml).toContain('href="simplelogin-api-key/"');
    expect(clientsHtml).toContain('href="../simplelogin-api-key/"');
    expect(configurationHtml).toContain('href="../../getting-started/simplelogin-api-key/"');
    for (const redirect of [localShortRedirectHtml, localRootRedirectHtml]) {
      expect(redirect).toContain('url=/getting-started/simplelogin-api-key');
    }
    for (const redirect of [productionShortRedirectHtml, productionRootRedirectHtml]) {
      expect(redirect).toContain('url=/simplelogin-mcp/getting-started/simplelogin-api-key');
    }
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
      'pnpm install --frozen-lockfile',
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
    expect(readme).toContain('"TRANSPORT": "stdio"');

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

  it('makes credential and HTTP exposure guidance prominent and complete', () => {
    const warningStart = homeHtml.indexOf('aria-label="Protect both credentials"');
    const workflowStart = homeHtml.indexOf('Useful by design');
    const catalogStart = homeHtml.indexOf('One canonical, searchable tool catalog');

    expect(homeHtml).toContain('SL_API_KEY</code> grants full control');
    expect(homeHtml).toContain('<code dir="auto">MCP_AUTH_TOKEN</code> is a');
    expect(homeHtml).toContain('Supported public or LAN HTTP deployments keep the token');
    expect(warningStart).toBeGreaterThan(0);
    expect(warningStart).toBeLessThan(workflowStart);
    expect(warningStart).toBeLessThan(catalogStart);

    expect(securityHtml).toContain('can read and change the SimpleLogin account');
    expect(securityHtml).toContain('refuses to start on a non-loopback address');
    expect(securityHtml).toContain('terminate TLS at a reverse proxy');
    expect(securityHtml).toContain('not CORS configuration and not authentication');
  });

  it('uses Starlight tabs and Expressive Code copy controls without custom replacements', async () => {
    const quickClientHtml = installHtml.slice(
      installHtml.indexOf('data-client-setups'),
      installHtml.indexOf('id="choose-a-deployment-shape"'),
    );
    const quickClientTabs = [...quickClientHtml.matchAll(/<a role="tab"/g)];
    const quickClientPanels = [
      ...quickClientHtml.matchAll(/<div id="tab-panel-[^"]+"[^>]+role="tabpanel"/g),
    ];
    const transportTabs = [...clientsHtml.matchAll(/<a role="tab"/g)];
    const transportPanels = [
      ...clientsHtml.matchAll(/<div id="tab-panel-[^"]+"[^>]+role="tabpanel"/g),
    ];
    const httpClients = CLIENT_SETUPS.filter((client) => 'http' in client);
    const homeCopyButtons = [...homeHtml.matchAll(/title="Copy to clipboard"/g)];
    const clientCopyButtons = [...clientsHtml.matchAll(/title="Copy to clipboard"/g)];
    const installMethodsSource = await readRepoFile('website/src/components/InstallMethods.astro');
    const clientSetupSource = await readRepoFile('website/src/components/ClientSetup.astro');
    const clientRecipeSource = await readRepoFile('website/src/components/ClientRecipe.astro');
    const detailedClientSource = await readRepoFile(
      'website/src/content/docs/getting-started/clients.mdx',
    );
    const headSource = await readRepoFile('website/src/components/Head.astro');

    expect(homeHtml).not.toContain('<starlight-tabs');
    expect(clientsHtml).toContain('<starlight-tabs');
    expect(quickClientTabs).toHaveLength(CLIENT_SETUPS.length);
    expect(quickClientPanels).toHaveLength(CLIENT_SETUPS.length);
    expect(transportTabs).toHaveLength(httpClients.length * 2);
    expect(transportPanels).toHaveLength(httpClients.length * 2);
    expect(clientsHtml.match(/>Local stdio<\/a>/g)).toHaveLength(httpClients.length);
    expect(clientsHtml.match(/>Streamable HTTP<\/a>/g)).toHaveLength(httpClients.length);
    expect(homeCopyButtons.length).toBeGreaterThanOrEqual(1);
    expect(clientCopyButtons.length).toBeGreaterThanOrEqual(CLIENT_SETUPS.length * 2);
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End'])
      expect(clientsHtml).toContain(key);
    expect(clientsHtml).toContain('data-copied="Copied!"');
    expect(clientsHtml).toContain('role="tablist"');
    expect(clientsHtml).toContain('aria-labelledby');
    expect(installHtml).toContain('<noscript>');
    expect(installHtml).toContain('JavaScript is disabled');
    expect(clientsHtml).not.toContain('All client recipes are expanded below');
    expect(clientsHtml).toContain('id="starlight__on-this-page"');
    for (const client of CLIENT_SETUPS) {
      expect(clientsHtml).toContain(`id="${client.key}"`);
      expect(clientsHtml).toContain(`href="#${client.key}"`);
    }
    expect(installMethodsSource).not.toContain('<script>');
    expect(clientSetupSource).toContain('<script>');
    expect(clientSetupSource).toContain("customElements.whenDefined('starlight-tabs')");
    expect(clientSetupSource).toContain("window.addEventListener('hashchange'");
    expect(clientSetupSource).toContain('[data-client-setups] > starlight-tabs');
    expect(installMethodsSource).toContain("from '@astrojs/starlight/components'");
    expect(clientSetupSource).toContain("from '@astrojs/starlight/components'");
    expect(clientRecipeSource).toContain('Tabs syncKey="client-transport"');
    expect(clientRecipeSource).toContain('[data-client-recipe] starlight-tabs');
    expect(clientRecipeSource).toContain('Streamable HTTP configuration');
    expect(detailedClientSource).not.toContain('ClientSetup');
    expect(
      detailedClientSource.match(/^## (?:Codex|Claude Code|Claude Desktop|VS Code|OpenCode)$/gm),
    ).toHaveLength(CLIENT_SETUPS.length);
    expect(headSource).toContain('Copy failed. Select the code and copy it manually.');
    expect(headSource).toContain("querySelector<HTMLElement>('[aria-live]')");
    expect(headSource).toContain('{ capture: true }');
    expect(headSource).toContain("querySelectorAll('.feedback')");
  });

  it('keeps custom CSS focused on brand tokens and specialized visualizations', async () => {
    const [
      customCss,
      homepageSource,
      compatibilitySource,
      installMethodSource,
      catalogPreviewSource,
      componentFiles,
    ] = await Promise.all([
      readRepoFile('website/src/styles/custom.css'),
      readRepoFile('website/src/content/docs/index.mdx'),
      readRepoFile('website/src/content/docs/getting-started/compatibility.mdx'),
      readRepoFile('website/src/components/InstallMethod.astro'),
      readRepoFile('website/src/components/ToolCatalogPreview.astro'),
      listFiles(join(process.cwd(), 'website/src/components')),
    ]);

    expect(homepageSource).toContain('CardGrid');
    expect(homepageSource).toContain('Steps');
    expect(homepageSource).toContain('LinkCard');
    expect(homepageSource).toContain('LinkButton');
    expect(installMethodSource).toContain('Code');
    expect(componentFiles).not.toContain('CopyableCode.astro');
    for (const icon of [
      'puzzle',
      'laptop',
      'padlock',
      'approve-check-circle',
      'random',
      'magnifier',
      'email',
      'setting',
    ]) {
      expect(homepageSource).toContain(`icon="${icon}"`);
    }
    expect(compatibilitySource).toContain("import { Badge } from '@astrojs/starlight/components'");
    expect(compatibilitySource).not.toContain('Current evidence is intentionally conservative');
    expect(
      compatibilitySource.match(
        /<Badge text="Tested" aria-label="Client tested" title="Client tested" variant="success"/g,
      ),
    ).toHaveLength(5);
    expect(compatibilitySource).toContain(
      '<Badge text="Implemented" aria-label="Protocol implemented" title="Protocol implemented" variant="note" size="small" style={{ whiteSpace: \'nowrap\' }} />',
    );
    expect(compatibilitySource.match(/style=\{\{ whiteSpace: 'nowrap' \}\}/g)).toHaveLength(6);
    expect(compatibilitySource).toContain('<div className="compatibility-matrix">');
    expect(catalogPreviewSource).toContain('https://lucide.dev/icons/hammer');
    expect(catalogPreviewSource).toContain('m15 12-9.373 9.373');
    expect(catalogPreviewSource).not.toContain('<Icon');
    expect(catalogPreviewSource).not.toContain('>✓</span>');
    expect(customCss).toContain('html[data-has-hero] .card-grid:first-of-type > .card:first-child');
    expect(customCss).toContain('--sl-card-bg: var(--sl-color-blue-low)');
    expect(customCss).toContain('.compatibility-matrix th:last-child');
    for (const obsoleteSelector of ['.copyable-code', '.home-facts', '.workflow-list']) {
      expect(customCss).not.toContain(obsoleteSelector);
    }
    expect(customCss).not.toContain('--simplelogin-mcp-button-hover-ring');
    expect(customCss).toContain('--simplelogin-mcp-button-hover-shadow: rgb(255 131 191 / 24%)');
    expect(customCss).toMatch(
      /:root\[data-theme='light'\][\s\S]*?--simplelogin-mcp-button-hover-shadow: rgb\(100 19 63 \/ 28%\);/,
    );
    expect(customCss).not.toContain('color-scheme:');
    expect(customCss).toContain('.sl-markdown-content a:not(.sl-link-button):hover');
    expect(customCss).toContain('.project-footer a:not(.project-footer__name):hover');
    expect(customCss).toContain('text-decoration-line: none');
    expect(customCss).toContain('.sl-link-button:is(.primary, .secondary) {');
    expect(customCss).toContain('transition: box-shadow 150ms ease');
    expect(customCss).toContain('.sl-link-button:is(.primary, .secondary):hover {');
    expect(customCss).toContain('0 0 0 2px var(--sl-color-black)');
    expect(customCss).toContain('0 0 0 5px var(--sl-color-accent)');
    expect(customCss).toContain('0 8px 22px var(--simplelogin-mcp-button-hover-shadow)');
    expect(customCss).toContain("[data-client-setups] [role='tab'][data-client-icon]");
    expect(customCss).toContain('.sl-markdown-content h2#opencode');
    expect(customCss).not.toMatch(/^\s*\[role='tab'\]/m);
    expect(customCss.split('\n').length).toBeLessThan(320);
  });

  it('resolves every generated internal page, asset, and fragment', async () => {
    const htmlFiles = (await listFiles(outputRoot)).filter((path) => path.endsWith('.html'));
    const legacyRedirectPaths = new Set(
      Object.keys(LEGACY_REDIRECTS).map((route) => `${route}/index.html`),
    );
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

        if (!legacyRedirectPaths.has(htmlPath)) {
          expect(
            legacyRedirectPaths.has(targetPath),
            `${htmlPath}: canonical content links through legacy route ${reference}`,
          ).toBe(false);
        }

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
    expect(homeHtml).not.toContain('property="og:image"');
    expect(homeHtml).not.toContain('name="twitter:image"');
    expect(robots).toBe('User-agent: *\nDisallow: /\n');
    expect(files.some((path) => path.startsWith('sitemap'))).toBe(false);
  });

  it('adds canonical, Open Graph, robots, and Starlight sitemap data for a real HTTPS URL', async () => {
    const productionHtml = await readOutputFile('index.html', productionRoot);
    const productionApiKeyHtml = await readOutputFile(
      'getting-started/simplelogin-api-key/index.html',
      productionRoot,
    );
    const canonicalDefaultHtml = await readOutputFile('index.html', canonicalDefaultRoot);
    const robots = await readOutputFile('robots.txt', productionRoot);
    const notFoundHtml = await readOutputFile('404.html', productionRoot);
    const sitemapIndex = await readOutputFile('sitemap-index.xml', productionRoot);
    const sitemap = await readOutputFile('sitemap-0.xml', productionRoot);
    const websiteReadme = await readRepoFile('website/README.md');
    const socialCard = await readRepoFile('website/public/og-card.svg');
    const canonical = 'https://docs.example.test/simplelogin-mcp/';
    const apiKeyCanonical = `${canonical}getting-started/simplelogin-api-key/`;

    expect(productionHtml).toContain(`<link rel="canonical" href="${canonical}"/>`);
    expect(productionHtml).toContain(`<meta property="og:url" content="${canonical}"/>`);
    expect(productionApiKeyHtml).toContain(`<link rel="canonical" href="${apiKeyCanonical}"/>`);
    expect(productionApiKeyHtml).toContain(
      `<meta property="og:url" content="${apiKeyCanonical}"/>`,
    );
    expect(productionHtml).toContain('<meta name="robots" content="index, follow"/>');
    expect(productionHtml).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(productionHtml).toContain(
      '<meta property="og:image" content="https://docs.example.test/simplelogin-mcp/og-card.png"/>',
    );
    expect(productionHtml).toContain(
      '<meta name="twitter:image" content="https://docs.example.test/simplelogin-mcp/og-card.png"/>',
    );
    expect(productionHtml).toContain('<meta property="og:image:width" content="1200"/>');
    expect(productionHtml).toContain('<meta property="og:image:height" content="630"/>');
    expect(productionHtml).toContain('href="/simplelogin-mcp/_astro/');
    expect(productionHtml).toContain(
      '<link rel="shortcut icon" href="/simplelogin-mcp/favicon.svg"',
    );
    expect(productionHtml).not.toContain('<link rel="shortcut icon" href="/favicon.svg"');
    expect(productionHtml).toContain('href="getting-started/clients/"');
    expect(productionHtml).toMatch(
      /src="\/simplelogin-mcp\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"/,
    );
    expect(productionHtml).not.toMatch(
      /href="\/(?:concepts|faq|getting-started|guides|project|reference|security|simplelogin-api-key|tools)(?:\/|")/,
    );
    expect(productionHtml).toContain(`href="${REPOSITORY_URL}"`);
    expect(productionHtml).toContain('View on GitHub</a>');
    expect(productionHtml).not.toContain('>Star on GitHub<');
    expect(productionHtml).not.toContain('>Node 24<');
    expect(canonicalDefaultHtml).toContain(`href="${REPOSITORY_URL}"`);
    expect(canonicalDefaultHtml).toContain(
      `<link rel="canonical" href="${CANONICAL_WEBSITE_URL}"/>`,
    );
    expect(canonicalDefaultHtml).toContain(
      `<meta property="og:url" content="${CANONICAL_WEBSITE_URL}"/>`,
    );
    expect(canonicalDefaultHtml).toContain('View on GitHub</a>');
    expect(canonicalDefaultHtml).not.toContain('>Star on GitHub<');
    expect(canonicalDefaultHtml).not.toContain('>Node 24<');
    expect(canonicalDefaultHtml).not.toMatch(/\b\d[\d,.]* GitHub stars\b/);
    expect(notFoundHtml).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(notFoundHtml).not.toContain('<meta name="robots" content="index, follow"/>');
    expect(notFoundHtml).not.toContain('rel="canonical"');
    expect(notFoundHtml).not.toContain('property="og:url"');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`${canonical}sitemap-index.xml`);
    expect(sitemapIndex).toContain(`${canonical}sitemap-0.xml`);
    expect(sitemap).toContain(`<loc>${apiKeyCanonical}</loc>`);
    expect(sitemap).not.toContain(`<loc>${canonical}simplelogin-api-key/</loc>`);
    expect(sitemap).not.toContain(`<loc>${canonical}getting-started/api-key/</loc>`);
    expect(sitemap).not.toContain('/404/');
    expect(websiteReadme).toContain('origin-root `/robots.txt`');
    expect(socialCard).toContain(`${TOOL_CATALOG.length} tools`);
  });

  it('publishes machine-readable documentation discovery without a false local origin', async () => {
    const localLlms = await readOutputFile('llms.txt');
    const productionLlms = await readOutputFile('llms.txt', productionRoot);
    const canonicalRoutes = [
      'getting-started/clients',
      'getting-started/compatibility',
      'getting-started/docker',
      'getting-started/http',
      'getting-started/stdio',
      'getting-started/simplelogin-api-key',
      'guides/how-it-works',
      'guides/workflows',
      'guides/security',
      'guides/troubleshooting',
      'guides/faq',
      'reference',
      'reference/configuration',
      'reference/tools',
      'reference/api-coverage',
      'reference/contributing',
      'reference/reporting-issues',
      'reference/security-policy',
    ];

    expect(localLlms).toContain('# simplelogin-mcp');
    expect(localLlms).not.toContain('https://docs.example.test');
    for (const route of canonicalRoutes) {
      expect(localLlms).toContain(`(/${route}/)`);
      expect(productionLlms).toContain(`(https://docs.example.test/simplelogin-mcp/${route}/)`);
    }
    for (const legacyRoute of [
      'concepts/how-it-works',
      'getting-started/api-key',
      'getting-started/configuration',
      'getting-started/troubleshooting',
      'tools',
      'tools/api-coverage',
      'tools/workflows',
      'project',
      'project/contributing',
      'project/security-policy',
      'security',
      'simplelogin-api-key',
      'faq',
    ]) {
      expect(localLlms).not.toContain(`](/${legacyRoute}/)`);
      expect(productionLlms).not.toContain(
        `](https://docs.example.test/simplelogin-mcp/${legacyRoute}/)`,
      );
    }
    expect(productionLlms).toContain('must never be placed in a prompt');
  });

  it('rejects unsafe or ambiguous publication URLs before writing output', () => {
    expect(resolvePublicationUrl(undefined, true)?.href).toBe(CANONICAL_WEBSITE_URL);
    expect(resolvePublicationUrl('', true)).toBeUndefined();
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
