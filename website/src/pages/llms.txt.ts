import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const prerender = true;

function routeForEntry(id: string): string {
  const withoutIndex = id.replace(/(?:^|\/)index$/, '');
  return withoutIndex ? `${withoutIndex}/` : '';
}

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const href = (path: string): string => {
    const pathname = `${base}${path}`.replace(/\/{2,}/g, '/');
    return site ? new URL(pathname, site).href : pathname;
  };
  const entries = await getCollection('docs');
  const pages = entries
    .map((entry) => ({
      description: entry.data.description?.trim(),
      title: entry.data.title,
      url: href(routeForEntry(entry.id)),
    }))
    .sort((left, right) => left.url.localeCompare(right.url));
  const links = pages
    .map(
      ({ description, title, url }) =>
        `- [${title}](${url})${description ? `: ${description}` : ''}`,
    )
    .join('\n');
  const body = `# simplelogin-mcp

> An independent, self-hostable MCP server for existing SimpleLogin users. It is not affiliated with, endorsed by, or sponsored by SimpleLogin or Proton AG.

simplelogin-mcp lets an MCP client manage aliases, contacts, mailboxes, custom domains, notifications, and account settings through the SimpleLogin API. It runs locally over stdio or as a Streamable HTTP service. The server reads the SimpleLogin API key from its environment and sends it only to the configured SimpleLogin API origin; the key must never be placed in a prompt.

## Documentation

${links}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
