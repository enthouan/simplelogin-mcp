import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../src/tools/catalog.js';
import { CLIENT_SETUPS, VERIFY_PROMPT } from '../../website/src/data/clients.js';
import { CANONICAL_WEBSITE_URL } from '../../website/src/data/publication.js';
import {
  REPOSITORY_API_URL,
  REPOSITORY_URL,
  createRepositoryStarCountLoader,
  fetchRepositoryStarCount,
  formatRepositoryStarCount,
  formatRepositoryStarCountLabel,
} from '../../website/src/data/repository.js';
import type { RepositoryFetch } from '../../website/src/data/repository.js';
import {
  apiCoverageHtml,
  apiKeyHtml,
  clientsHtml,
  compatibilityHtml,
  configurationHtml,
  contributingHtml,
  faqHtml,
  fallbackHomeHtml,
  fallbackInstallHtml,
  githubHeroActionFromHtml,
  homeHtml,
  howItWorksHtml,
  installHtml,
  listFiles,
  operationsHtml,
  outputRoot,
  readOutputFile,
  readRepoFile,
  referenceHtml,
  reportingIssuesHtml,
  repositoryNavigationLinksFromHtml,
  securityHtml,
  securityPolicyHtml,
  toolsHtml,
  troubleshootingHtml,
  workflowsHtml,
} from './support.js';
import type { PackageJson } from './support.js';

function stepItemCounts(html: string): number[] {
  return [...html.matchAll(/<ol role="list" class="sl-steps">([\s\S]*?)<\/ol>/g)].map(
    (match) => [...match[1]!.matchAll(/<li>/g)].length,
  );
}

function repositoryResponse(payload: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: () => Promise.resolve(payload),
  };
}

export function registerContentContracts(): void {
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

      expect(normalizedPage.split(disclaimer)).toHaveLength(2);
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
    const headerHtml = homeHtml.slice(homeHtml.indexOf('<header'), homeHtml.indexOf('</header>'));
    expect(headerHtml).toContain(`<a href="${REPOSITORY_URL}" rel="me external"`);
    expect(headerHtml).toContain('aria-label="simplelogin-mcp source repository, 1.2K stars"');
    expect(headerHtml).toMatch(/<span[^>]*>1\.2K<\/span>/);

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
      'aria-label="Client configuration recipes" class="starlight-aside starlight-aside--note"',
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

  it('renders static repository trust details alongside best-effort build metadata', async () => {
    const [
      repositorySource,
      repositoryDataSource,
      repositorySocialLinkSource,
      routeDataSource,
      astroConfig,
      websiteReadme,
    ] = await Promise.all([
      readRepoFile('website/src/components/RepositoryLink.astro'),
      readRepoFile('website/src/data/repository.ts'),
      readRepoFile('website/src/components/RepositorySocialLink.astro'),
      readRepoFile('website/src/starlightRouteData.ts'),
      readRepoFile('website/astro.config.mjs'),
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
    expect(repositoryDataSource).toContain(`export const REPOSITORY_URL = '${REPOSITORY_URL}';`);
    expect(repositoryDataSource).toContain(
      `export const REPOSITORY_API_URL = '${REPOSITORY_API_URL}';`,
    );
    expect(repositoryDataSource).not.toMatch(/Authorization|PUBLIC_|process\.env|console\./);
    expect(repositorySource).toContain('--sl-card-border: var(--sl-color-gray-5)');
    expect(repositorySource).toContain('--sl-card-bg: var(--sl-color-gray-6)');
    expect(astroConfig).toContain("SocialIcons: './src/components/RepositorySocialLink.astro'");
    expect(repositorySocialLinkSource).toContain('await getRepositoryStarCount()');
    expect(repositorySocialLinkSource).toContain('data-repository-navigation');
    expect(repositorySocialLinkSource).not.toMatch(/client:|<script|fetch\(/);
    expect(routeDataSource).not.toMatch(/getRepositoryStarCount|populateRepositoryHeroAction/);
    expect(websiteReadme).toContain('Each build makes one memoized');
    expect(websiteReadme).toContain('two-second timeout');
    expect(websiteReadme).toMatch(/visitors'\s+browsers make no GitHub metadata request/);
  });

  it('loads and memoizes a valid repository star count with public-only headers', async () => {
    let requestCount = 0;
    let requestInput = '';
    let requestHeaders: Record<string, string> | undefined;
    const fetchImpl: RepositoryFetch = (input, init) => {
      requestCount += 1;
      requestInput = input;
      requestHeaders = init.headers;
      return Promise.resolve(repositoryResponse({ stargazers_count: 1_234 }));
    };
    const loadStarCount = createRepositoryStarCountLoader(fetchImpl);

    const [first, second] = await Promise.all([loadStarCount(), loadStarCount()]);
    const third = await loadStarCount();

    expect([first, second, third]).toEqual([1_234, 1_234, 1_234]);
    expect(requestCount).toBe(1);
    expect(requestInput).toBe(REPOSITORY_API_URL);
    expect(requestHeaders).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'simplelogin-mcp-website-build',
      'X-GitHub-Api-Version': '2026-03-10',
    });
    expect(requestHeaders).not.toHaveProperty('Authorization');
  });

  it('accepts zero stars and formats compact populated navigation counts', async () => {
    const zero = await fetchRepositoryStarCount(() =>
      Promise.resolve(repositoryResponse({ stargazers_count: 0 })),
    );

    expect(zero).toBe(0);
    expect(formatRepositoryStarCount(zero)).toBe('0');
    expect(formatRepositoryStarCount(1)).toBe('1');
    expect(formatRepositoryStarCount(1_234)).toBe('1.2K');
    expect(formatRepositoryStarCount(undefined)).toBeUndefined();
    expect(formatRepositoryStarCountLabel(zero)).toBe('0 stars');
    expect(formatRepositoryStarCountLabel(1)).toBe('1 star');
    expect(formatRepositoryStarCountLabel(1_234)).toBe('1.2K stars');
    expect(formatRepositoryStarCountLabel(undefined)).toBeUndefined();
  });

  it.each([
    ['null payload', null],
    ['array payload', []],
    ['missing count', {}],
    ['string count', { stargazers_count: '12' }],
    ['negative zero', { stargazers_count: -0 }],
    ['negative count', { stargazers_count: -1 }],
    ['fractional count', { stargazers_count: 1.5 }],
    ['nonfinite count', { stargazers_count: Number.POSITIVE_INFINITY }],
    ['unsafe count', { stargazers_count: Number.MAX_SAFE_INTEGER + 1 }],
  ])('falls back for an invalid repository %s', async (_label, payload) => {
    await expect(
      fetchRepositoryStarCount(() => Promise.resolve(repositoryResponse(payload))),
    ).resolves.toBeUndefined();
  });

  it('falls back for malformed JSON and network rejection', async () => {
    await expect(
      fetchRepositoryStarCount(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new SyntaxError('malformed JSON')),
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fetchRepositoryStarCount(() => Promise.reject(new TypeError('network unavailable'))),
    ).resolves.toBeUndefined();
  });

  it('aborts a slow repository request at the bounded timeout', async () => {
    let observedAbort = false;
    const fetchImpl: RepositoryFetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });

    await expect(fetchRepositoryStarCount(fetchImpl, 5)).resolves.toBeUndefined();
    expect(observedAbort).toBe(true);
  });

  it.each([403, 429, 500])('caches fallback after an HTTP %i response', async (status) => {
    let requestCount = 0;
    const loadStarCount = createRepositoryStarCountLoader(() => {
      requestCount += 1;
      return Promise.resolve(repositoryResponse({ stargazers_count: 99 }, false, status));
    });

    await expect(loadStarCount()).resolves.toBeUndefined();
    await expect(loadStarCount()).resolves.toBeUndefined();
    expect(requestCount).toBe(1);
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

    const githubHeroAction = githubHeroActionFromHtml(homeHtml);
    const fallbackGithubHeroAction = githubHeroActionFromHtml(fallbackHomeHtml);
    expect(githubHeroAction).not.toBe('');
    expect(githubHeroAction).toContain('<svg');
    expect(githubHeroAction.indexOf('<svg')).toBeLessThan(
      githubHeroAction.indexOf('View on GitHub'),
    );
    expect(githubHeroAction).toMatch(/View on GitHub<\/a>$/);
    expect(githubHeroAction).not.toMatch(/\bstars?\b/);
    expect(githubHeroAction).toContain('rel="external"');
    expect(githubHeroAction).toContain('referrerpolicy="no-referrer"');
    expect(fallbackGithubHeroAction).not.toBe('');
    expect(fallbackGithubHeroAction).toContain('<svg');
    expect(fallbackGithubHeroAction).toMatch(/View on GitHub<\/a>$/);
    expect(fallbackGithubHeroAction).not.toMatch(/\bstars?\b/);
    expect(fallbackGithubHeroAction).toContain('rel="external"');
    expect(fallbackGithubHeroAction).toContain('referrerpolicy="no-referrer"');
    for (const navigationLink of repositoryNavigationLinksFromHtml(homeHtml)) {
      expect(navigationLink).toContain(
        'aria-label="simplelogin-mcp source repository, 1.2K stars"',
      );
      expect(navigationLink).toMatch(/<span[^>]*>1\.2K<\/span>/);
      expect(navigationLink).toContain('rel="me external"');
      expect(navigationLink).toContain('referrerpolicy="no-referrer"');
      expect(navigationLink.match(/<svg/g)).toHaveLength(2);
    }
    expect(repositoryNavigationLinksFromHtml(homeHtml)).toHaveLength(1);
    expect(repositoryNavigationLinksFromHtml(installHtml)).toHaveLength(2);
    for (const navigationLink of repositoryNavigationLinksFromHtml(fallbackInstallHtml)) {
      expect(navigationLink).toContain('aria-label="simplelogin-mcp source repository"');
      expect(navigationLink).not.toMatch(/\bstars?\b/);
      expect(navigationLink).toContain('rel="me external"');
      expect(navigationLink).toContain('referrerpolicy="no-referrer"');
      expect(navigationLink.match(/<svg/g)).toHaveLength(1);
    }
    expect(repositoryNavigationLinksFromHtml(fallbackInstallHtml)).toHaveLength(2);
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
    expect(homeHtml).toContain('The site documents local stdio recipes for all five named clients');
    expect(homeHtml).not.toContain('Client tested —');
    expect(homeHtml).toContain('retained test results, unavailable');
    expect(homeHtml).not.toContain(VERIFY_PROMPT);
    expect(clientsHtml).toContain(VERIFY_PROMPT);
    expect(homeHtml).not.toContain('Do not call any other tool');
    expect(clientsHtml).toContain('Client configuration recipes');
    expect(clientsHtml).toContain('do not by themselves prove a live');
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
    expect(compatibilitySource).toContain('Earlier maintainer checks did not retain');
    expect(
      compatibilitySource.match(
        /<Badge text="Not retested" aria-label="Not retested" title="Not retested" variant="caution"/g,
      ),
    ).toHaveLength(4);
    expect(compatibilitySource).toContain(
      '<Badge text="Unavailable" aria-label="Client unavailable" title="Client unavailable" variant="note" size="small" style={{ whiteSpace: \'nowrap\' }} />',
    );
    expect(compatibilitySource).not.toContain('<Badge text="Tested"');
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
}
