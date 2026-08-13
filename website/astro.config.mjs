// @ts-check
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { URL } from 'node:url';
import { CANONICAL_WEBSITE_URL } from './src/data/publication.js';
import { REPOSITORY_URL } from './src/data/repository.js';

const simpleLoginApiKeyPath = '/getting-started/simplelogin-api-key/';
const socialImageUrl = new URL('og-card.png', CANONICAL_WEBSITE_URL).href;
/** @type {Array<{ tag: 'meta'; attrs: Record<string, string> }>} */
const socialImageHead = [
  { tag: 'meta', attrs: { property: 'og:image', content: socialImageUrl } },
  { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
  { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
  { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
  {
    tag: 'meta',
    attrs: {
      property: 'og:image:alt',
      content: 'simplelogin-mcp — manage aliases from your MCP client',
    },
  },
  { tag: 'meta', attrs: { name: 'twitter:image', content: socialImageUrl } },
  {
    tag: 'meta',
    attrs: {
      name: 'twitter:image:alt',
      content: 'simplelogin-mcp — manage aliases from your MCP client',
    },
  },
];

/** @type {NonNullable<import('@astrojs/markdown-satteri').SatteriProcessorOptions['hastPlugins']>[number]} */
const keyboardAccessibleTables = {
  name: 'keyboard-accessible-tables',
  element: {
    filter: ['table'],
    visit(node, context) {
      if (context.fileURL?.pathname.endsWith('/docs/api-coverage.md')) return;
      context.setProperty(node, 'tabIndex', 0);
    },
  },
};

export default defineConfig({
  output: 'static',
  site: CANONICAL_WEBSITE_URL,
  trailingSlash: 'always',
  markdown: {
    processor: satteri({ hastPlugins: [keyboardAccessibleTables] }),
  },
  redirects: {
    '/getting-started/api-key': simpleLoginApiKeyPath,
    '/simplelogin-api-key': simpleLoginApiKeyPath,
    '/concepts/how-it-works': '/guides/how-it-works/',
    '/faq': '/guides/faq/',
    '/security': '/guides/security/',
    '/getting-started/configuration': '/reference/configuration/',
    '/getting-started/troubleshooting': '/guides/troubleshooting/',
    '/tools': '/reference/tools/',
    '/tools/api-coverage': '/reference/api-coverage/',
    '/tools/workflows': '/guides/workflows/',
    '/project': '/reference/',
    '/project/contributing': '/reference/contributing/',
    '/project/security-policy': '/reference/security-policy/',
  },
  integrations: [
    starlight({
      title: 'simplelogin-mcp',
      titleDelimiter: '—',
      description:
        'An independent MCP server for managing SimpleLogin aliases, contacts, mailboxes, custom domains, settings, and account utilities over stdio or Streamable HTTP.',
      favicon: '/favicon.svg',
      logo: {
        src: './src/assets/simplelogin-mcp-mark.svg',
        alt: '',
        replacesTitle: false,
      },
      lastUpdated: true,
      credits: false,
      customCss: ['./src/styles/custom.css'],
      routeMiddleware: './src/starlightRouteData.ts',
      components: {
        Footer: './src/components/Footer.astro',
        SocialIcons: './src/components/RepositorySocialLink.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'simplelogin-mcp source repository',
          href: REPOSITORY_URL,
        },
      ],
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: '/client-icons.css',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'robots',
            content: 'index, follow',
          },
        },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#ea319f' } },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:card',
            content: 'summary_large_image',
          },
        },
        ...socialImageHead,
      ],
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Install and run', slug: 'getting-started' },
            { label: 'SimpleLogin API key', slug: 'getting-started/simplelogin-api-key' },
            { label: 'Set up your MCP client', slug: 'getting-started/clients' },
            { label: 'Compatibility', slug: 'getting-started/compatibility' },
            { label: 'Docker Compose', slug: 'getting-started/docker' },
            { label: 'Streamable HTTP', slug: 'getting-started/http' },
            { label: 'stdio', slug: 'getting-started/stdio' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'How it works', slug: 'guides/how-it-works' },
            { label: 'Workflows', slug: 'guides/workflows' },
            { label: 'Security & Data', slug: 'guides/security' },
            { label: 'Operations', slug: 'guides/operations' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
            { label: 'FAQ', slug: 'guides/faq' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Overview', slug: 'reference' },
            { label: 'Configuration', slug: 'reference/configuration' },
            { label: 'Tool catalog', slug: 'reference/tools' },
            { label: 'API coverage', slug: 'reference/api-coverage' },
            { label: 'Contributing', slug: 'reference/contributing' },
            { label: 'Reporting issues and support', slug: 'reference/reporting-issues' },
            { label: 'Security policy', slug: 'reference/security-policy' },
          ],
        },
      ],
    }),
  ],
});
