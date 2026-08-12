import type { APIRoute } from 'astro';
import { CANONICAL_WEBSITE_URL } from '../data/publication.js';

export const prerender = true;

export const GET: APIRoute = () => {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', CANONICAL_WEBSITE_URL).href}\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
