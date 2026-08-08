# Website

The project website is an Astro Starlight documentation site kept separate from the MCP runtime.
Starlight earns the added frontend stack by providing maintained documentation navigation, search,
MDX structure, responsive layouts, themes, and accessibility behavior as the install and reference
content grows. Its dependencies live in the private `website` workspace so the MCP server build and
runtime do not install them. Tool names, summaries, groups, and counts are generated from
`src/tools/catalog.ts`; install and security copy is covered by drift tests against the repository
documentation and configuration.

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

Local builds have no canonical URL or sitemap, use `noindex`, and emit a `robots.txt` that disallows
crawling. Once a real HTTPS production URL is approved, pass it at build time:

```bash
WEBSITE_BASE_URL=https://example.com/simplelogin-mcp/ pnpm website:build
WEBSITE_BASE_URL=https://example.com/simplelogin-mcp/ pnpm website:preview
```

That value must be HTTPS and cannot contain credentials, percent-encoded path segments, repeated or
unsafe path separators, a query string, or a fragment. Use the same value for build and preview so a
subpath deployment is served at its real base path. A production build adds canonical and Open Graph
URLs, emits an indexable `robots.txt`, and lets Starlight create its sitemap. Do not set a placeholder
URL or link the site from the project README until the public deployment responds successfully.

For a subpath deployment, crawlers still request the origin-root `/robots.txt`; they do not use the
copy served below `/simplelogin-mcp/robots.txt`. Configure the hosting layer’s root robots file to
allow the site path and reference the generated subpath sitemap, or publish on a dedicated origin.
The per-page robots meta remains effective either way.
