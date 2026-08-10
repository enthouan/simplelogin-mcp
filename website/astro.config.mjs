// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { argv, env } from 'node:process';
import { URL } from 'node:url';
import { resolvePublicationUrl } from './src/data/publication.js';
import { REPOSITORY_URL } from './src/data/repository.js';

const PUBLICATION_ENV = 'WEBSITE_BASE_URL';
const publicationUrl = resolvePublicationUrl(env[PUBLICATION_ENV], argv.slice(2).includes('build'));
const base = publicationUrl?.pathname ?? '/';
/** @param {string} path */
const sitePath = (path) => `${base}${path}`.replace(/\/{2,}/g, '/');
const simpleLoginApiKeyPath = sitePath('getting-started/simplelogin-api-key/');
const socialImageUrl = publicationUrl ? new URL('og-card.png', publicationUrl).href : undefined;
/** @type {Array<{ tag: 'meta'; attrs: Record<string, string> }>} */
const socialImageHead = socialImageUrl
  ? [
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
    ]
  : [];

// Astro exposes its configured base as BASE_URL internally. Ignore an ambient shell value so
// Starlight cannot accidentally render navigation for a different deployment path.
delete env.BASE_URL;

export default defineConfig({
  output: 'static',
  site: publicationUrl?.origin,
  base,
  redirects: {
    '/getting-started/api-key': simpleLoginApiKeyPath,
    '/simplelogin-api-key': simpleLoginApiKeyPath,
    '/concepts/how-it-works': sitePath('guides/how-it-works/'),
    '/faq': sitePath('guides/faq/'),
    '/security': sitePath('guides/security/'),
    '/getting-started/configuration': sitePath('reference/configuration/'),
    '/getting-started/troubleshooting': sitePath('guides/troubleshooting/'),
    '/tools': sitePath('reference/tools/'),
    '/tools/api-coverage': sitePath('reference/api-coverage/'),
    '/tools/workflows': sitePath('guides/workflows/'),
    '/project': sitePath('reference/'),
    '/project/contributing': sitePath('reference/contributing/'),
    '/project/security-policy': sitePath('reference/security-policy/'),
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
      credits: false,
      customCss: ['./src/styles/custom.css'],
      components: {
        Footer: './src/components/Footer.astro',
        Head: './src/components/Head.astro',
        PageSidebar: './src/components/PageSidebar.astro',
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
          tag: 'meta',
          attrs: {
            name: 'robots',
            content: publicationUrl ? 'index, follow' : 'noindex, nofollow',
          },
        },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#ea319f' } },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:card',
            content: socialImageUrl ? 'summary_large_image' : 'summary',
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
