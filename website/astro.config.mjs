// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { env } from 'node:process';
import { normalizePublicationUrl } from './src/data/publication.js';
import { REPOSITORY_VISIBILITY_ENV, resolveRepositoryUrl } from './src/data/repository.js';

const PUBLICATION_ENV = 'WEBSITE_BASE_URL';
const publicationUrl = normalizePublicationUrl(env[PUBLICATION_ENV]);
const repositoryUrl = resolveRepositoryUrl(publicationUrl, env[REPOSITORY_VISIBILITY_ENV]);
const base = publicationUrl?.pathname ?? '/';

// Astro exposes its configured base as BASE_URL internally. Ignore an ambient shell value so
// Starlight cannot accidentally render navigation for a different deployment path.
delete env.BASE_URL;

export default defineConfig({
  output: 'static',
  site: publicationUrl?.origin,
  base,
  integrations: [
    starlight({
      title: 'simplelogin-mcp',
      titleDelimiter: '—',
      description:
        'An independent MCP server for managing SimpleLogin aliases, contacts, mailboxes, custom domains, settings, and account utilities over stdio or Streamable HTTP.',
      favicon: '/favicon.svg',
      credits: false,
      customCss: ['./src/styles/custom.css'],
      components: {
        Head: './src/components/Head.astro',
      },
      social: repositoryUrl
        ? [
            {
              icon: 'github',
              label: 'simplelogin-mcp source repository',
              href: repositoryUrl,
            },
          ]
        : [],
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
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
      ],
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Install and run', slug: 'getting-started' },
            { label: 'Docker Compose', slug: 'getting-started/docker' },
            { label: 'Streamable HTTP', slug: 'getting-started/http' },
            { label: 'stdio', slug: 'getting-started/stdio' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Workflows', slug: 'guides/workflows' },
            { label: 'Security', slug: 'guides/security' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Tool catalog', slug: 'reference/tools' }],
        },
      ],
    }),
  ],
});
