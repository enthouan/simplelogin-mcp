# Website

The project website is a dependency-light static build kept separate from the MCP runtime. Its tool
names, summaries, groups, and counts are generated from `src/tools/catalog.ts`; install and security
copy is covered by drift tests against the repository documentation and configuration.

## Build and check

```bash
pnpm website:build
pnpm website:check
```

The generated site is written to `website/dist/` and is intentionally not committed. For a local
preview, serve that directory on loopback, for example:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory website/dist
```

Then open `http://127.0.0.1:4173/`.

## Publication metadata

Local builds have no canonical URL or sitemap, use `noindex`, and emit a `robots.txt` that disallows
crawling. Once a real HTTPS production URL is approved, pass it at build time:

```bash
WEBSITE_BASE_URL=https://example.com/simplelogin-mcp/ pnpm website:build
```

That value must be HTTPS and cannot contain credentials, a query string, or a fragment. A production
build adds the canonical and Open Graph URLs, emits an indexable `robots.txt`, and creates
`sitemap.xml`. Do not set a placeholder URL or link the site from the project README until the public
deployment responds successfully.
