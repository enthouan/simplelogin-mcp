import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CATALOG } from '../../src/tools/catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const WEBSITE_ROOT = resolve(PROJECT_ROOT, 'website');
const SOURCE_ROOT = resolve(WEBSITE_ROOT, 'src');
const DEFAULT_OUTPUT_ROOT = resolve(WEBSITE_ROOT, 'dist');

const CATEGORY_DETAILS = {
  aliases: {
    label: 'Aliases',
    description: 'Find, create, tune, audit, pause, and safely remove aliases.',
  },
  contacts: {
    label: 'Contacts',
    description: 'Create reverse aliases and control who can forward mail.',
  },
  mailboxes: {
    label: 'Mailboxes',
    description: 'Manage verified destinations, defaults, and explicit transfers.',
  },
  custom_domains: {
    label: 'Custom domains',
    description: 'Inspect domains, update routing, and review deleted-alias trash.',
  },
  account: {
    label: 'Account',
    description: 'Check account details, stats, notifications, and alias settings.',
  },
} as const satisfies Record<
  (typeof TOOL_CATALOG)[number]['category'],
  { label: string; description: string }
>;

const STATIC_ASSETS = ['app.js', 'favicon.svg', 'styles.css'] as const;

export interface BuildWebsiteOptions {
  outputDir?: string;
  baseUrl?: string;
}

export async function buildWebsite(options: BuildWebsiteOptions = {}): Promise<string> {
  const outputRoot = resolve(options.outputDir ?? DEFAULT_OUTPUT_ROOT);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env['WEBSITE_BASE_URL']);
  const template = await readFile(resolve(SOURCE_ROOT, 'index.html'), 'utf8');

  const replacements = new Map<string, string>([
    ['{{PUBLICATION_METADATA}}', renderPublicationMetadata(baseUrl)],
    ['{{ROBOTS_META}}', baseUrl ? 'index, follow' : 'noindex, nofollow'],
    ['{{TOOL_COUNT}}', String(TOOL_CATALOG.length)],
    ['{{TOOL_GROUP_COUNT}}', String(Object.keys(CATEGORY_DETAILS).length)],
    ['{{TOOL_GROUPS}}', renderToolGroups()],
    ['{{TOOL_PREVIEW}}', renderToolPreview()],
  ]);

  let html = template;
  for (const [token, value] of replacements) {
    if (!html.includes(token)) throw new Error(`Website template is missing ${token}`);
    html = html.replaceAll(token, value);
  }

  const leftoverToken = /{{[A-Z_]+}}/.exec(html)?.[0];
  if (leftoverToken) throw new Error(`Website template has an unresolved token: ${leftoverToken}`);

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, 'index.html'), html, 'utf8');

  for (const asset of STATIC_ASSETS) {
    await copyFile(resolve(SOURCE_ROOT, asset), resolve(outputRoot, asset));
  }

  await writeFile(resolve(outputRoot, 'robots.txt'), renderRobots(baseUrl), 'utf8');
  if (baseUrl) {
    await writeFile(resolve(outputRoot, 'sitemap.xml'), renderSitemap(baseUrl), 'utf8');
  }

  return outputRoot;
}

function renderToolGroups(): string {
  return Object.entries(CATEGORY_DETAILS)
    .map(([category, details]) => {
      const tools = TOOL_CATALOG.filter((tool) => tool.category === category);
      const toolItems = tools
        .map(
          (tool) => `
              <li data-tool-name="${escapeHtml(tool.name)}">
                <code>${escapeHtml(tool.name)}</code>
                <span>${escapeHtml(tool.summary)}</span>
              </li>`,
        )
        .join('');

      return `
          <article class="tool-group" aria-labelledby="tool-group-${category}">
            <div class="tool-group-heading">
              <h3 id="tool-group-${category}">${escapeHtml(details.label)}</h3>
              <span aria-label="${tools.length} tools">${tools.length}</span>
            </div>
            <p>${escapeHtml(details.description)}</p>
            <ul>${toolItems}
            </ul>
          </article>`;
    })
    .join('');
}

function renderToolPreview(): string {
  const groupRows = Object.entries(CATEGORY_DETAILS)
    .map(([category, details]) => {
      const tools = TOOL_CATALOG.filter((tool) => tool.category === category);
      const sample = tools
        .slice(0, 2)
        .map((tool) => tool.name)
        .join(', ');
      return `
              <div class="catalog-row">
                <dt>${escapeHtml(details.label)}</dt>
                <dd><span>${tools.length}</span> ${escapeHtml(sample)}${tools.length > 2 ? ', …' : ''}</dd>
              </div>`;
    })
    .join('');

  return `
          <figure class="catalog-console" data-tool-count="${TOOL_CATALOG.length}">
            <div class="console-bar" aria-hidden="true">
              <span></span><span></span><span></span>
              <strong>tools/list</strong>
            </div>
            <div class="console-body">
              <p><span aria-hidden="true">$</span> tools/list</p>
              <p class="console-success"><span aria-hidden="true">✓</span> ${TOOL_CATALOG.length} tools loaded from the project catalog</p>
              <dl>${groupRows}
              </dl>
            </div>
            <figcaption>
              A sanitized view of the real MCP tool catalog. No API key or account data is used.
            </figcaption>
          </figure>`;
}

function renderPublicationMetadata(baseUrl: URL | undefined): string {
  if (!baseUrl) return '';
  const href = escapeHtml(baseUrl.href);
  return `
    <link rel="canonical" href="${href}" />
    <meta property="og:url" content="${href}" />`;
}

function renderRobots(baseUrl: URL | undefined): string {
  if (!baseUrl) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', baseUrl).href}\n`;
}

function renderSitemap(baseUrl: URL): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(baseUrl.href)}</loc>
  </url>
</urlset>
`;
}

function normalizeBaseUrl(value: string | undefined): URL | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const url = new URL(trimmed);
  if (url.protocol !== 'https:') {
    throw new Error('WEBSITE_BASE_URL must use https');
  }
  if (url.search || url.hash) {
    throw new Error('WEBSITE_BASE_URL must not include a query string or fragment');
  }
  if (url.username || url.password) {
    throw new Error('WEBSITE_BASE_URL must not include credentials');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  buildWebsite()
    .then((outputRoot) => {
      process.stdout.write(`Built website at ${outputRoot}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Website build failed: ${message}\n`);
      process.exitCode = 1;
    });
}
