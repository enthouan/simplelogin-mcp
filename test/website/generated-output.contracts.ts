import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../src/tools/catalog.js';
import { CANONICAL_WEBSITE_URL } from '../../website/src/data/publication.js';
import { REPOSITORY_URL } from '../../website/src/data/repository.js';
import {
  apiKeyHtml,
  homeHtml,
  installHtml,
  listFiles,
  outputRoot,
  readOutputFile,
  readRepoFile,
} from './support.js';

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

function outputPathForUrl(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  if (decoded === '/') return 'index.html';
  if (decoded.endsWith('/')) return `${decoded.slice(1)}index.html`;
  return decoded.slice(1);
}

function collectIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
}

export function registerGeneratedOutputContracts(): void {
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
}
