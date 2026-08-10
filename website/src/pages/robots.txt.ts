import type { APIRoute } from 'astro';
import { env } from 'node:process';
import { resolvePublicationUrl } from '../data/publication.js';

export const prerender = true;
const PUBLICATION_ENV = 'WEBSITE_BASE_URL';

export const GET: APIRoute = () => {
  const publicationUrl = resolvePublicationUrl(env[PUBLICATION_ENV], import.meta.env.PROD);
  const body = publicationUrl
    ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', publicationUrl).href}\n`
    : 'User-agent: *\nDisallow: /\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
