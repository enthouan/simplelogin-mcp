import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_NAMES } from '../src/tools/catalog.js';
import { CLIENT_SETUPS, VERIFY_PROMPT } from '../website/src/data/clients.js';
import { CANONICAL_WEBSITE_URL } from '../website/src/data/publication.js';
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
let homeHtml = '';
let installHtml = '';
let apiKeyHtml = '';
let howItWorksHtml = '';
let securityHtml = '';
let operationsHtml = '';
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
let removeOutputRootAfterTests = false;
const execFileAsync = promisify(execFile);
const useBuiltWebsite = process.env['WEBSITE_TEST_USE_DIST'] === '1';

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

async function buildWebsiteInFreshProcess(outputDir: string): Promise<void> {
  const websiteRoot = join(process.cwd(), 'website');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
  };
  delete childEnv['VITEST'];
  delete childEnv['VITEST_POOL_ID'];
  delete childEnv['VITEST_WORKER_ID'];
  delete childEnv['TEST'];

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

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ogSourceDigest(template: Uint8Array, renderer: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update('simplelogin-mcp-og-image-v1\0');
  hash.update(template);
  hash.update('\0renderer\0');
  hash.update(renderer);
  return hash.digest('hex');
}

function pngDimensions(image: Buffer): { height: number; width: number } {
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
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
  if (useBuiltWebsite) {
    outputRoot = join(process.cwd(), 'website', 'dist');
    await stat(join(outputRoot, 'index.html')).catch(() => {
      throw new Error(
        'WEBSITE_TEST_USE_DIST=1 requires a completed `pnpm website:build` in website/dist.',
      );
    });
  } else {
    outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-'));
    removeOutputRootAfterTests = true;
    await buildWebsiteInFreshProcess(outputRoot);
  }
  [
    homeHtml,
    installHtml,
    apiKeyHtml,
    howItWorksHtml,
    securityHtml,
    operationsHtml,
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
    readOutputFile('guides/operations/index.html'),
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
  if (removeOutputRootAfterTests && outputRoot) {
    await rm(outputRoot, { recursive: true, force: true });
  }
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
        '_headers',
        '_redirects',
        'index.html',
        '404.html',
        'client-icons.css',
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
        'guides/operations/index.html',
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
      ['Operations', 'guides/operations/'],
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
    const socialCard = await readRepoFile('website/og-image.html');
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
    expect(socialCard).toContain('data-social-card');
    expect(socialCard).toContain('Full license: public/third-party-notices.txt');
    expect(socialCard).toContain('Manage aliases from');
    expect(socialCard).toContain('Self-hosted, auditable alias automation.');
    expect(socialCard).toContain('27 tools');
    expect(socialCard).toContain('Independent');
    expect(socialCard).toContain('community project');
    expect(socialCard).toContain('--og-canvas: #fff4f9');
    expect(notices).toContain('https://lucide.dev/icons/mail');
    expect(notices).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(notices).toContain('Permission to use, copy, modify, and/or distribute this software');
  });

  it('keeps the browser-rendered social image synchronized with its sources', async () => {
    const [template, renderer, manifestSource, image] = await Promise.all([
      readFile(join(process.cwd(), 'website/og-image.html')),
      readFile(join(process.cwd(), 'website/scripts/render-og-image.ts')),
      readRepoFile('website/og-image.manifest.json'),
      readFile(join(process.cwd(), 'website/public/og-card.png')),
    ]);
    const manifest = JSON.parse(manifestSource) as {
      height: number;
      imageSha256: string;
      schemaVersion: number;
      sourceSha256: string;
      width: number;
    };

    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(manifest).toEqual({
      schemaVersion: 1,
      width: 1_200,
      height: 630,
      sourceSha256: ogSourceDigest(template, renderer),
      imageSha256: sha256(image),
    });
    expect(pngDimensions(image)).toEqual({ width: 1_200, height: 630 });
  });

  it('replaces the text-only architecture sketch with an accessible request-flow diagram', async () => {
    const [diagram, componentSource] = await Promise.all([
      readOutputFile('request-flow.svg'),
      readRepoFile('website/src/components/ArchitectureFlow.astro'),
    ]);

    expect(howItWorksHtml).not.toContain('MCP client  ── stdio or Streamable HTTP');
    expect(homeHtml).not.toContain('data-request-flow');
    expect(howItWorksHtml).toContain('data-request-flow');
    expect(howItWorksHtml).toContain('role="region" aria-label="SimpleLogin request flow diagram"');
    expect(howItWorksHtml).toContain('src="/request-flow.svg"');
    expect(howItWorksHtml).not.toContain('Where requests and credentials travel');
    expect(howItWorksHtml).not.toContain('open the full-size diagram');
    expect(securityHtml).not.toContain('data-request-flow');
    expect(securityHtml).toContain('href="../how-it-works/"');

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

  it('uses the mailbox mark and site title as the home link', () => {
    for (const page of [homeHtml, apiKeyHtml]) {
      const siteTitle = /<a href="([^"]+)" class="site-title[^>]*>([\s\S]*?)<\/a>/.exec(page);

      expect(siteTitle?.[1]).toBe('/');
      expect(siteTitle?.[2]).toMatch(/<img\b[^>]*\balt(?:=""|(?=\s|>))[^>]*>/);
      expect(siteTitle?.[2]).toMatch(/src="\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"/);
      expect(siteTitle?.[2]).toContain('simplelogin-mcp');
    }
  });

  it('uses a branded information panel to distinguish the official service', async () => {
    const disclaimer =
      'It is not an official SimpleLogin or Proton AG product, service, or MCP implementation, and it is not affiliated with, endorsed by, or sponsored by SimpleLogin or Proton AG.';

    for (const page of [homeHtml, installHtml]) {
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
    const [footerSource, astroConfig, homepageSource] = await Promise.all([
      readRepoFile('website/src/components/Footer.astro'),
      readRepoFile('website/astro.config.mjs'),
      readRepoFile('website/src/content/docs/index.mdx'),
    ]);

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
    expect(footerSource).toContain('@astrojs/starlight/components/LastUpdated.astro');
    expect(footerSource).toContain('@astrojs/starlight/components/Pagination.astro');
    expect(footerSource).toContain('<div class="meta sl-flex">');
    expect(footerSource).not.toContain('padding-block-start: 4.5rem');
    expect(astroConfig).toContain('lastUpdated: true');
    expect(homepageSource).toContain('lastUpdated: false');
    expect(footerSource).toContain('<div class="project-footer__bar">');
    expect(footerSource).toContain('justify-content: space-between');
    expect(footerSource).not.toContain('max-width: 46rem');
    expect(footerSource).not.toContain('grid-template-columns: minmax(0, 1fr) auto');
  });

  it('omits misleading wrapper timestamps from imported and generated reference pages', async () => {
    const wrapperPaths = [
      'website/src/content/docs/reference/tools.mdx',
      'website/src/content/docs/reference/api-coverage.mdx',
      'website/src/content/docs/reference/contributing.mdx',
      'website/src/content/docs/reference/reporting-issues.mdx',
      'website/src/content/docs/reference/security-policy.mdx',
    ];
    const [astroConfig, ...wrapperSources] = await Promise.all([
      readRepoFile('website/astro.config.mjs'),
      ...wrapperPaths.map(readRepoFile),
    ]);

    expect(astroConfig).toMatch(/^\s+lastUpdated: true,$/m);
    for (const source of wrapperSources) {
      expect(source).toMatch(/^lastUpdated: false$/m);
    }
    for (const page of [
      toolsHtml,
      apiCoverageHtml,
      contributingHtml,
      reportingIssuesHtml,
      securityPolicyHtml,
    ]) {
      expect(page).not.toContain('Last updated:');
    }
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

    expect(stepItemCounts(installHtml)).toEqual([4]);
    expect(stepItemCounts(homeHtml)).toEqual([3]);
    expect(stepItemCounts(dockerHtml)).toEqual([4]);
    expect(stepItemCounts(httpHtml)).toEqual([4]);
    expect(stepItemCounts(stdioHtml)).toEqual([4]);
    expect(stepItemCounts(workflowsHtml)).toEqual([5, 4, 3, 4, 3]);
    expect(workflowsHtml).toContain('The five-stage pattern');
    expect(workflowsHtml).toContain('Discover');
    expect(workflowsHtml).toContain('Inspect');
    expect(workflowsHtml).toContain('Propose');
    expect(workflowsHtml).toContain('Approve');
    expect(workflowsHtml).toContain('Verify');
    expect(dockerHtml).toContain('Pin long-lived deployments');
    expect(dockerHtml).toContain('The quick start uses the moving');
    expect(dockerHtml).toContain('>latest</code> image tag');
    expect(dockerHtml).toContain('SIMPLELOGIN_MCP_IMAGE_TAG');
    expect(dockerHtml).toContain('href="../../guides/operations/"');
  });

  it('publishes an accurate operations runbook for every supported deployment shape', () => {
    expect(operationsHtml).toMatch(/<h1 id="_top"[^>]*>Operate simplelogin-mcp<\/h1>/);
    for (const [slug, heading] of [
      ['before-a-change', 'Before a change'],
      ['inspect-a-running-service', 'Inspect a running service'],
      ['upgrade-the-published-image', 'Upgrade the published image'],
      ['roll-back', 'Roll back'],
      ['rotate-credentials', 'Rotate credentials'],
      ['stop-or-remove-the-service', 'Stop or remove the service'],
      ['state-backup-and-retention', 'State, backup, and retention'],
      ['upgrade-a-source-or-stdio-installation', 'Upgrade a source or stdio installation'],
    ] as const) {
      expect(operationsHtml).toContain(`<h2 id="${slug}">${heading}</h2>`);
      expect(operationsHtml).toContain(`href="#${slug}"`);
    }

    for (const boundary of [
      'SIMPLELOGIN_MCP_IMAGE_TAG',
      'SL_API_KEY',
      'MCP_AUTH_TOKEN',
      'docker compose images simplelogin-mcp',
      'docker compose pull simplelogin-mcp',
      'docker compose up -d --force-recreate simplelogin-mcp',
      'docker compose stop simplelogin-mcp',
      'docker compose down',
      'curl http://127.0.0.1:3000/health',
      'account_get_stats',
      'docker-compose.local.yml',
      'git clone --branch vX.Y.Z --depth 1',
    ]) {
      expect(operationsHtml).toContain(boundary);
    }

    expect(operationsHtml).toContain('stateless and creates a fresh MCP server and transport');
    expect(operationsHtml).toContain('does not undo SimpleLogin mutations');
    expect(operationsHtml).toContain('does not reload changed');
    expect(operationsHtml).not.toMatch(/\/healthz|\/readyz|auth_whoami|auth_token_info|TRELLO_/);
  });

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

  it('makes wide documentation tables keyboard focusable', () => {
    for (const page of [compatibilityHtml, configurationHtml, securityHtml, securityPolicyHtml]) {
      expect(page).toContain('<table tabindex="0">');
    }

    expect(apiCoverageHtml.match(/class="api-coverage-table" tabindex="0"/g)).toHaveLength(2);
    expect(apiCoverageHtml).not.toContain('<table tabindex="0">');
  });

  it('publishes reference, contribution, issue-reporting, and private security guidance', () => {
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
    expect(contributingHtml).toContain('Development Commands');
    expect(contributingHtml).toContain('Dependency Maintenance');
    expect(reportingIssuesHtml).toContain('What To Include');
    expect(reportingIssuesHtml).toContain('Support Boundaries');
    expect(reportingIssuesHtml).toContain('SL_API_KEY');
    expect(reportingIssuesHtml).toContain('MCP_AUTH_TOKEN');
    expect(reportingIssuesHtml).toContain('authorization headers');
    expect(reportingIssuesHtml).toContain('account details');
    expect(securityPolicyHtml).toContain('Do not open a public vulnerability report');
    expect(securityPolicyHtml).toMatch(/Security → Report a\s+vulnerability/);
    expect(securityPolicyHtml).toContain('Credential risk model');
    expect(securityPolicyHtml).toContain('Network exposure model');
    expect(securityPolicyHtml).toContain('SL_API_KEY');
    expect(securityPolicyHtml).toContain('MCP_AUTH_TOKEN');
    expect(securityPolicyHtml).toContain('<table tabindex="0">');

    for (const page of [referenceHtml, contributingHtml, reportingIssuesHtml]) {
      expect(page).toContain(`href="${REPOSITORY_URL}"`);
    }
    expect(reportingIssuesHtml).toContain(`href="${REPOSITORY_URL}/issues/new/choose"`);
    expect(reportingIssuesHtml).toContain('Open an issue');
    expect(securityPolicyHtml).not.toContain('/security/advisories/new');
  });

  it('keeps critical website policy guidance aligned with repository policy files', async () => {
    const [
      contributing,
      security,
      support,
      policyComponent,
      websiteContributing,
      websiteSupport,
      websiteSecurity,
    ] = await Promise.all([
      readRepoFile('CONTRIBUTING.md'),
      readRepoFile('SECURITY.md'),
      readRepoFile('SUPPORT.md'),
      readRepoFile('website/src/components/PolicyContent.astro'),
      readRepoFile('website/src/content/docs/reference/contributing.mdx'),
      readRepoFile('website/src/content/docs/reference/reporting-issues.mdx'),
      readRepoFile('website/src/content/docs/reference/security-policy.mdx'),
    ]);

    expect(contributing).toContain('pnpm website:check');
    expect(policyComponent).toContain("from '../../../CONTRIBUTING.md'");
    expect(policyComponent).toContain("from '../../../SUPPORT.md'");
    expect(policyComponent).toContain("from '../../../SECURITY.md'");
    expect(websiteContributing).toContain('<PolicyContent source="contributing" />');
    expect(websiteSupport).toContain('<PolicyContent source="support" />');
    expect(websiteSecurity).toContain('<PolicyContent source="security" />');
    for (const policy of [security, support]) {
      expect(policy).toMatch(/vulnerab/i);
      expect(policy).toMatch(/not (?:publish|open a public)/i);
    }
  });

  it('redirects every previous documentation route to its canonical page', async () => {
    for (const [legacyRoute, canonicalRoute] of Object.entries(LEGACY_REDIRECTS)) {
      const redirect = await readOutputFile(`${legacyRoute}/index.html`);

      expect(redirect).toContain(`content="0;url=/${canonicalRoute}/"`);
      expect(redirect).toContain('<meta name="robots" content="noindex">');
      expect(redirect).toContain(`href="${CANONICAL_WEBSITE_URL}${canonicalRoute}/"`);
    }
  });

  it('ships Cloudflare-native redirects and conservative security headers', async () => {
    const [redirects, headers] = await Promise.all([
      readOutputFile('_redirects'),
      readOutputFile('_headers'),
    ]);

    for (const [legacyRoute, canonicalRoute] of Object.entries(LEGACY_REDIRECTS)) {
      expect(redirects).toContain(`/${legacyRoute} /${canonicalRoute}/ 301`);
      expect(redirects).toContain(`/${legacyRoute}/ /${canonicalRoute}/ 301`);
    }

    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain(
      'Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    );
    expect(headers).not.toContain('Content-Security-Policy:');
  });

  it('prevents the enhanced tool catalog form from submitting', async () => {
    const catalogSource = await readRepoFile('website/src/components/ToolCatalog.astro');

    expect(catalogSource).toContain(
      "controls.addEventListener('submit', (event) => event.preventDefault())",
    );
  });

  it('shows the live alias-creation example before the client picker', async () => {
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
    expect(homeHtml).toContain('href="guides/faq/#do-all-tools-work-on-every-simplelogin-plan"');
    const usefulByDesign = homeHtml.slice(
      homeHtml.indexOf('Useful by design'),
      homeHtml.indexOf('One canonical, searchable tool catalog'),
    );
    expect(usefulByDesign).toContain('contact_list → contact_create');
    expect(usefulByDesign).not.toContain('contact_create → contact_set_blocked');

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
    expect(homeHtml).toContain('The documented local stdio recipes connected');
    expect(homeHtml).not.toContain('Client tested —');
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
    const clientIconSource = await readRepoFile('website/src/pages/client-icons.css.ts');
    const customCss = await readRepoFile('website/src/styles/custom.css');
    const astroConfig = await readRepoFile('website/astro.config.mjs');
    const notices = await readRepoFile('website/public/third-party-notices.txt');
    const websitePackage = JSON.parse(await readRepoFile('website/package.json')) as PackageJson;
    const builtFiles = await listFiles(outputRoot);
    const clientIconCss = await readOutputFile('client-icons.css');
    const builtCss = (
      await Promise.all(
        builtFiles.filter((path) => path.endsWith('.css')).map((path) => readOutputFile(path)),
      )
    ).join('\n');
    const clientIcons = {
      'claude-desktop': 'claude',
      'claude-code': 'claude',
      codex: 'openai',
      opencode: 'opencode',
      'vs-code': 'vscode',
    } as const;
    const iconSources = {
      claude: ['fab', 'claude'],
      evidence: ['fas', 'clipboard-check'],
      openai: ['fab', 'openai'],
      opencode: ['fas', 'robot'],
      vscode: ['fas', 'code'],
    } as const;

    expect(homeHtml.match(/data-client-icon=/g)).toHaveLength(6);
    expect(homeHtml).toMatch(/<link rel="stylesheet" href="\/client-icons\.css"\s*\/>/);
    expect(astroConfig).toContain("href: '/client-icons.css'");
    expect(websitePackage.devDependencies).toMatchObject({
      '@fortawesome/free-brands-svg-icons': '7.3.1',
      '@fortawesome/free-solid-svg-icons': '7.3.1',
    });
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
    expect(customCss).toMatch(/\[data-client-setups\] \[role='tab'\] \{[^}]*white-space: nowrap;/);

    expect(clientIconSource).toContain("from '@fortawesome/free-brands-svg-icons'");
    expect(clientIconSource).toContain("from '@fortawesome/free-solid-svg-icons'");
    expect(clientIconCss).toContain('Font Awesome Free 7.3.1');
    expect(clientIconCss).toContain('CC BY 4.0');
    expect(clientIconCss).toContain('https://fontawesome.com/license/free');
    expect(clientIconCss.match(/data:image\/svg\+xml/g)).toHaveLength(5);
    expect(clientIconCss).not.toMatch(/url\(["']?https?:/);

    for (const [icon, [prefix, iconName]] of Object.entries(iconSources)) {
      expect(customCss).toContain(`a[data-client-icon='${icon}']`);
      expect(customCss).toContain(`var(--client-icon-${icon})`);
      expect(builtCss).toContain(`[data-client-icon=${icon}]`);
      expect(clientIconCss).toContain(`/* ${icon}: ${prefix} ${iconName} */`);
      expect(clientIconCss).toContain(`--client-icon-${icon}:`);
      await expect(
        stat(join(process.cwd(), `website/src/assets/client-icons/${icon}.svg`)),
      ).rejects.toThrow();
    }

    expect(customCss).toContain('.sl-link-card a[data-client-icon] .title::before');
    expect(customCss).toContain('.sl-markdown-content h2#codex');
    expect(customCss).toContain('.sl-markdown-content h2#vs-code');
    expect(customCss).toContain('--client-heading-icon');
    expect(customCss).toContain('mask: var(--client-heading-icon) center / contain no-repeat');
    expect(customCss).toContain('background-color: currentColor');
    expect(customCss).toContain('mask: var(--client-card-icon) center / contain no-repeat');
    expect(builtFiles.some((path) => path.startsWith('client-icons/'))).toBe(false);
    expect(builtCss).not.toContain("url('/client-icons/");
    expect(builtCss).not.toContain('url("/client-icons/');
    expect(notices).not.toContain('Font Awesome');
    expect(notices).toContain('Lucide Mail icon');
    expect(notices).not.toContain('Clipboard Check');
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

  it('keeps the tested Codex stdio setup free of a stored API key', () => {
    const codex = CLIENT_SETUPS.find((client) => client.key === 'codex');

    expect(codex).toBeDefined();
    expect(codex?.code).toContain('env_vars = ["SL_API_KEY"]');
    expect(codex?.code).not.toContain('SL_API_KEY =');
    expect(codex?.secretNote).toContain('without storing its value in TOML');
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
    expect(configurationHtml).toMatch(/API\s+redirects are rejected/);
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
    const [shortRedirectHtml, rootRedirectHtml] = await Promise.all([
      readOutputFile('getting-started/api-key/index.html'),
      readOutputFile('simplelogin-api-key/index.html'),
    ]);

    expect(apiKeyHtml).toContain('Get a SimpleLogin API key');
    expect(apiKeyHtml).toContain('https://app.simplelogin.io/dashboard/api_key');
    expect(apiKeyHtml).toContain('Open SimpleLogin API Keys');
    expect(apiKeyHtml).toContain('Independent integration for SimpleLogin');
    expect(apiKeyHtml).toContain('Before you begin');
    expect(apiKeyHtml).toContain('New API Key');
    expect(apiKeyHtml).toContain('the oldest unused keys and then the oldest used keys');
    expect(apiKeyHtml).toContain('Creating a key may remove older keys');
    expect(apiKeyHtml.indexOf('Creating a key may remove older keys')).toBeGreaterThan(
      apiKeyHtml.indexOf('Troubleshooting'),
    );
    expect(apiKeyHtml).toContain('implementation evidence, not a stable product contract');
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
    for (const redirect of [shortRedirectHtml, rootRedirectHtml]) {
      expect(redirect).toContain('url=/getting-started/simplelogin-api-key');
      expect(redirect).toContain(
        `href="${CANONICAL_WEBSITE_URL}getting-started/simplelogin-api-key/"`,
      );
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
    const quickClientHtml = installHtml.slice(installHtml.indexOf('data-client-setups'));
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
    const footerSource = await readRepoFile('website/src/components/Footer.astro');
    const codeBlockEnhancementsSource = await readRepoFile(
      'website/src/components/CodeBlockEnhancements.astro',
    );
    const routeDataSource = await readRepoFile('website/src/starlightRouteData.ts');
    const astroConfig = await readRepoFile('website/astro.config.mjs');

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
    expect(footerSource).toContain(
      "import CodeBlockEnhancements from './CodeBlockEnhancements.astro'",
    );
    expect(footerSource).toContain('<CodeBlockEnhancements />');
    expect(footerSource).not.toContain('Copy failed. Select the code and copy it manually.');
    expect(codeBlockEnhancementsSource).toContain(
      'Copy failed. Select the code and copy it manually.',
    );
    expect(codeBlockEnhancementsSource).toContain("querySelector<HTMLElement>('[aria-live]')");
    expect(codeBlockEnhancementsSource).toContain('{ capture: true }');
    expect(codeBlockEnhancementsSource).toContain("querySelectorAll('.feedback')");
    expect(codeBlockEnhancementsSource).toContain('<style is:global>');
    expect(codeBlockEnhancementsSource).toContain("button[data-copy-error='true']");
    expect(astroConfig).toContain("routeMiddleware: './src/starlightRouteData.ts'");
    expect(astroConfig).not.toContain('Head:');
    expect(astroConfig).not.toContain('PageSidebar:');
    expect(routeDataSource).toContain('getApiCoverageHeadings');
    expect(routeDataSource).not.toContain('matchAll(/<h2');
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
    expect(catalogPreviewSource).toContain("import { Icon } from '@astrojs/starlight/components'");
    expect(catalogPreviewSource).toContain('<Icon name="puzzle" size="1.1rem" />');
    expect(catalogPreviewSource).not.toContain('https://lucide.dev/icons/hammer');
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

    expect(homeHtml).not.toMatch(/<script[^>]+src="https?:/i);
    expect(homeHtml).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
    expect(homeHtml).not.toMatch(/googletagmanager|segment\.com|posthog|plausible\.io/i);
    expect(homeHtml).not.toMatch(/sl-[A-Za-z0-9]{20,}/);
    expect(websiteSources).not.toMatch(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/);
    expect(homeHtml).not.toMatch(/<a[^>]+href="https:\/\/ghcr\.io/);
  });

  it('builds canonical production metadata without a publication environment variable', async () => {
    const robots = await readOutputFile('robots.txt');
    const notFoundHtml = await readOutputFile('404.html');
    const sitemapIndex = await readOutputFile('sitemap-index.xml');
    const sitemap = await readOutputFile('sitemap-0.xml');
    const websiteReadme = await readRepoFile('website/README.md');
    const socialCard = await readRepoFile('website/og-image.html');
    const files = await listFiles(outputRoot);
    const apiKeyCanonical = `${CANONICAL_WEBSITE_URL}getting-started/simplelogin-api-key/`;

    expect(homeHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(homeHtml).toMatch(/<meta\s+name="description"/);
    expect(homeHtml).toContain('<meta property="og:type" content="website"/>');
    expect(homeHtml.match(/<meta property="og:type"/g)).toHaveLength(1);
    expect(installHtml).toContain('<meta property="og:type" content="article"/>');
    expect(installHtml.match(/<meta property="og:type"/g)).toHaveLength(1);
    const structuredData = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(homeHtml);
    expect(structuredData).not.toBeNull();
    expect(JSON.parse(structuredData![1]!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'simplelogin-mcp',
      url: CANONICAL_WEBSITE_URL,
      description:
        'An independent MCP server for existing SimpleLogin users to create aliases, inspect alias activity metadata, manage routing, and use reverse aliases.',
    });
    expect(installHtml).not.toContain('type="application/ld+json"');
    expect(homeHtml).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(homeHtml.match(/<meta name="twitter:card"/g)).toHaveLength(1);
    expect(homeHtml).toContain('<meta property="og:title"');
    expect(homeHtml).toMatch(/<meta\s+property="og:description"/);
    expect(homeHtml).toContain('<link rel="shortcut icon" href="/favicon.svg"');
    expect(homeHtml).toContain('<meta name="robots" content="index, follow"/>');
    expect(homeHtml).toContain(`<link rel="canonical" href="${CANONICAL_WEBSITE_URL}"/>`);
    expect(homeHtml).toContain(`<meta property="og:url" content="${CANONICAL_WEBSITE_URL}"/>`);
    expect(apiKeyHtml).toContain(`<link rel="canonical" href="${apiKeyCanonical}"/>`);
    expect(apiKeyHtml).toContain(`<meta property="og:url" content="${apiKeyCanonical}"/>`);
    expect(homeHtml).toContain(
      `<meta property="og:image" content="${CANONICAL_WEBSITE_URL}og-card.png"/>`,
    );
    expect(homeHtml).toContain(
      `<meta name="twitter:image" content="${CANONICAL_WEBSITE_URL}og-card.png"/>`,
    );
    expect(homeHtml).toContain('<meta property="og:image:width" content="1200"/>');
    expect(homeHtml).toContain('<meta property="og:image:height" content="630"/>');
    expect(homeHtml).toContain(`href="${REPOSITORY_URL}"`);
    expect(homeHtml).toContain('View on GitHub</a>');
    expect(homeHtml).not.toContain('>Star on GitHub<');
    expect(homeHtml).not.toContain('>Node 24<');
    expect(homeHtml).not.toMatch(/\b\d[\d,.]* GitHub stars\b/);
    expect(notFoundHtml).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(notFoundHtml).not.toContain('<meta name="robots" content="index, follow"/>');
    expect(notFoundHtml).not.toContain('rel="canonical"');
    expect(notFoundHtml).not.toContain('property="og:url"');
    expect(robots).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL_WEBSITE_URL}sitemap-index.xml\n`,
    );
    expect(sitemapIndex).toContain(`${CANONICAL_WEBSITE_URL}sitemap-0.xml`);
    expect(sitemap).toContain(`<loc>${apiKeyCanonical}</loc>`);
    expect(sitemap).toContain(`<loc>${CANONICAL_WEBSITE_URL}guides/operations/</loc>`);
    expect(sitemap).not.toContain(`<loc>${CANONICAL_WEBSITE_URL}simplelogin-api-key/</loc>`);
    expect(sitemap).not.toContain(`<loc>${CANONICAL_WEBSITE_URL}getting-started/api-key/</loc>`);
    expect(sitemap).not.toContain('/404/');
    expect(files).toContain('sitemap-index.xml');
    expect(files).toContain('sitemap-0.xml');
    expect(websiteReadme).toContain('origin root, so its generated `/robots.txt`');
    expect(websiteReadme).toContain('No website publication or base-URL environment variable');
    expect(socialCard).toContain(`${TOOL_CATALOG.length} tools`);
  });

  it('publishes machine-readable documentation discovery at the canonical origin', async () => {
    const llms = await readOutputFile('llms.txt');
    const llmsSource = await readRepoFile('website/src/pages/llms.txt.ts');
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
      'guides/operations',
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

    expect(llms).toContain('# simplelogin-mcp');
    for (const route of canonicalRoutes) {
      expect(llms).toContain(`(${CANONICAL_WEBSITE_URL}${route}/)`);
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
      expect(llms).not.toContain(`](${CANONICAL_WEBSITE_URL}${legacyRoute}/)`);
    }
    expect(llms).toContain('must never be placed in a prompt');
    expect(llms).toContain('## Source');
    expect(llms).toContain(`- [GitHub repository](${REPOSITORY_URL})`);
    expect(llms).toContain('- [SimpleLogin](https://simplelogin.io/)');
    expect(llmsSource).toContain("'Content-Type': 'text/plain; charset=utf-8'");
  });

  it('uses portable Astro commands without custom publication modes', async () => {
    const [
      rootPackage,
      websitePackage,
      playwrightConfig,
      astroConfig,
      robotsSource,
      websiteReadme,
    ] = await Promise.all([
      readRepoFile('package.json'),
      readRepoFile('website/package.json'),
      readRepoFile('playwright.config.mjs'),
      readRepoFile('website/astro.config.mjs'),
      readRepoFile('website/src/pages/robots.txt.ts'),
      readRepoFile('website/README.md'),
    ]);
    const rootPackageJson = JSON.parse(rootPackage) as PackageJson;
    const websitePackageJson = JSON.parse(websitePackage) as PackageJson;

    expect(rootPackageJson.scripts['website:build']).toBe('pnpm --dir website build');
    expect(rootPackageJson.scripts['website:dev']).toBe('pnpm --dir website dev');
    expect(rootPackageJson.scripts['website:og']).toBe('tsx website/scripts/render-og-image.ts');
    expect(rootPackageJson.scripts['website:og:check']).toBe(
      'tsx website/scripts/render-og-image.ts --check',
    );
    expect(rootPackageJson.scripts['website:test:built']).toBe(
      'cross-env WEBSITE_TEST_USE_DIST=1 vitest run test/website.test.ts',
    );
    expect(rootPackageJson.devDependencies['cross-env']).toBe('10.1.0');
    expect(rootPackageJson.scripts['website:check']).toContain('pnpm website:og:check');
    expect(rootPackageJson.scripts).not.toHaveProperty(`website:build${':production'}`);
    expect(websitePackageJson.scripts['build']).toBe('astro build');
    expect(websitePackageJson.scripts['dev']).toBe('astro dev --host 127.0.0.1 --port 4173');
    expect(websitePackageJson.scripts['preview']).toBe(
      'astro preview --host 127.0.0.1 --port 4173',
    );
    expect(playwrightConfig).toContain(
      'cross-env ASTRO_PREVIEW_BACKGROUND=0 pnpm --dir website exec astro preview --host 127.0.0.1 --port 4174',
    );
    for (const command of Object.values(websitePackageJson.scripts)) {
      expect(command).not.toMatch(/^[A-Z][A-Z0-9_]*=/);
    }
    expect(websitePackageJson.scripts).not.toHaveProperty(`build${':production'}`);
    expect(astroConfig).toContain('site: CANONICAL_WEBSITE_URL');
    expect(astroConfig).toContain("trailingSlash: 'always'");
    expect(astroConfig).not.toContain("from 'node:process'");
    expect(robotsSource).toContain('CANONICAL_WEBSITE_URL');
    expect(websiteReadme).toContain('No website publication or base-URL environment variable');
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
    for (const dependency of [
      '@astrojs/check',
      '@astrojs/starlight',
      '@fortawesome/free-brands-svg-icons',
      '@fortawesome/free-solid-svg-icons',
      'astro',
      'sharp',
    ]) {
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
