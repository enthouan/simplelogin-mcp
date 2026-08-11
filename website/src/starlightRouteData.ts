import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { getHeadings as getContributingHeadings } from '../../CONTRIBUTING.md';
import { getHeadings as getSecurityPolicyHeadings } from '../../SECURITY.md';
import { getHeadings as getSupportHeadings } from '../../SUPPORT.md';
import { getHeadings as getApiCoverageHeadings } from '../../docs/api-coverage.md';
import { CATEGORY_ENTRIES } from './data/catalog.js';

const canonicalHeadings = new Map([
  ['reference/api-coverage', getApiCoverageHeadings],
  ['reference/contributing', getContributingHeadings],
  ['reference/reporting-issues', getSupportHeadings],
  ['reference/security-policy', getSecurityPolicyHeadings],
]);

export const onRequest = defineRouteMiddleware(async (context, next) => {
  await next();

  const route = context.locals.starlightRoute;

  if (route.id === '404') {
    route.head = route.head.flatMap((entry) => {
      if (entry.tag === 'link' && entry.attrs?.rel === 'canonical') return [];
      if (entry.tag === 'meta' && entry.attrs?.property === 'og:url') return [];
      if (entry.tag === 'meta' && entry.attrs?.name === 'robots') {
        return [{ ...entry, attrs: { ...entry.attrs, content: 'noindex, nofollow' } }];
      }
      return [entry];
    });
  }

  if (!route.toc) return;

  if (route.id === 'reference/tools') {
    const categorySlugs = new Set(CATEGORY_ENTRIES.map(({ category }) => `tool-group-${category}`));

    route.toc.items = [
      ...route.toc.items.filter(({ slug }) => !categorySlugs.has(slug)),
      ...CATEGORY_ENTRIES.map(({ category, label }) => ({
        depth: 2,
        slug: `tool-group-${category}`,
        text: label,
        children: [],
      })),
    ];
  }

  const getCanonicalHeadings = canonicalHeadings.get(route.id);
  if (getCanonicalHeadings) {
    const headings = getCanonicalHeadings()
      .filter(({ depth }) => depth === 2)
      .map((heading) => ({ ...heading, children: [] }));
    const headingSlugs = new Set(headings.map(({ slug }) => slug));

    route.toc.items = [
      ...route.toc.items.filter(({ slug }) => !headingSlugs.has(slug)),
      ...headings,
    ];
  }
});
