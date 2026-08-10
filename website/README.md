# Website

The project website is an Astro Starlight documentation site kept separate from the MCP runtime.
Starlight earns the added frontend stack by providing maintained documentation navigation, search,
MDX structure, responsive layouts, themes, and accessibility behavior as the install and reference
content grows. Its dependencies live in the private `website` workspace so the MCP server build and
runtime do not install them. Tool names, summaries, groups, and counts are generated from
`src/tools/catalog.ts`; install and security copy is covered by drift tests against the repository
documentation and configuration. The Lucide-derived mail geometry used by the logo and social card
is covered by the distributed `public/third-party-notices.txt`.

The sidebar is organized into **Get started**, **Guides**, and **Reference**. The API coverage page
renders `docs/api-coverage.md` directly so endpoint-scope claims have one canonical source. When a
page moves between sections, keep a static redirect in `astro.config.mjs` so published links and
bookmarks continue to resolve.

## Build and check

```bash
pnpm website:build
pnpm website:check
```

The generated site is written to `website/dist/` and is intentionally not committed. Start the
development server with:

```bash
pnpm website:dev
```

Then open `http://127.0.0.1:4173/`.

To review the exact production output instead, build it and run the preview server:

```bash
pnpm website:build
pnpm website:preview
```

## Publication metadata

The approved canonical origin is `https://simplelogin-mcp.com/`. Ordinary production builds default
to that URL, emit canonical and Open Graph URLs, use `index, follow`, and let Starlight create the
sitemap:

```bash
pnpm website:build
pnpm website:preview
```

The development server has no canonical URL and remains non-indexable. Tests and alternate preview
deployments can override `WEBSITE_BASE_URL`; an explicit empty value produces a noindex build with no
canonical URL or sitemap. A non-empty override must use HTTPS and cannot contain credentials,
percent-encoded path segments, repeated or unsafe path separators, a query string, or a fragment.
The public deployment must remain at the approved canonical origin; do not publish a production
override as the canonical site.

Repository links and GitHub actions are always rendered. Builds do not call the GitHub API; the
repository cards contain only static project facts such as the MIT license, supported Node version,
and self-hosting model.

The canonical site is hosted at the origin root, so its generated `/robots.txt` is authoritative.
For a test-only subpath override, crawlers still request the origin-root `/robots.txt`; configure the
hosting layer’s root robots file if that preview must be crawlable. Per-page robots metadata remains
effective either way.
