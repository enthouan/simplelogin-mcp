# Website

The project website is an Astro Starlight documentation site kept separate from the MCP runtime.
Starlight earns the added frontend stack by providing maintained documentation navigation, search,
MDX structure, responsive layouts, themes, and accessibility behavior as the install and reference
content grows. Its dependencies live in the private `website` workspace so the MCP server build and
runtime do not install them. Tool names, summaries, groups, and counts are generated from
`src/tools/catalog.ts`; install and security copy is covered by drift tests against the repository
documentation and configuration. All icon assets remain local to the site. Client marks are
generated at build time from the pinned Font Awesome packages and emitted in `client-icons.css`.
That stylesheet carries the required Font Awesome Free attribution; the browser downloads no Font
Awesome JavaScript, webfont, CDN resource, or individual icon file. The Lucide-derived mail geometry
used by the logo and social-card template is covered by the distributed
`public/third-party-notices.txt`.

The sidebar is organized into **Get started**, **Guides**, and **Reference**. The API coverage and
repository-policy pages render `docs/api-coverage.md`, `CONTRIBUTING.md`, `SUPPORT.md`, and
`SECURITY.md` directly so factual guidance has one canonical source. When a page moves between
sections, keep a static redirect in `astro.config.mjs` so published links and bookmarks continue to
resolve.

## Build and check

```bash
pnpm website:build
pnpm website:check
```

`website:check` runs Astro diagnostics, creates one production artifact, and then runs the static
output contracts and focused browser checks against that same `website/dist/`. Chromium covers the
desktop, mobile, theme, search, accessibility, and responsive checks; one WebKit desktop smoke check
catches basic engine-specific regressions without multiplying the full matrix. Install the pinned
browsers once after installing dependencies:

```bash
pnpm exec playwright install chromium webkit
```

For a standalone static-contract or browser run, use `pnpm website:test` or
`pnpm website:test:browser`. Each convenience command creates a fresh production build first;
`pnpm website:check` is the preferred full gate because it builds only once.

## Social image

The committed Open Graph image is rendered from `og-image.html` with Chromium so its typography,
wrapping, gradients, and shadows match the browser. Regenerate the PNG and synchronization manifest
after changing the template or renderer:

```bash
pnpm website:og
```

Run `pnpm website:og:check` to verify the committed 1200 x 630 image. The full `website:check` gate
runs the same stale-image check before building the site.

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

Every build targets the canonical origin `https://simplelogin-mcp.com/`. Astro emits canonical and
Open Graph URLs, `index, follow`, and the Starlight sitemap without a custom environment variable.
Local development continues to use `pnpm website:dev`; production and Cloudflare preview deployments
both use:

```bash
pnpm website:build
```

Cloudflare Pages [automatically sends `X-Robots-Tag: noindex` on preview
deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/), so previews
can use the same production artifact without creating duplicate search results. Verify that response
header after the first preview deployment. No website publication or base-URL environment variable
is required.

Repository links and GitHub actions are always rendered. Builds do not call the GitHub API; the
repository cards contain only static project facts such as the MIT license, supported Node version,
and self-hosting model.

The canonical site is hosted at the origin root, so its generated `/robots.txt` is authoritative.

Cloudflare copies `public/_redirects` and `public/_headers` into the built site. The redirect rules
provide real HTTP 301 responses for moved documentation pages while Astro keeps portable HTML
fallbacks. The headers add conservative browser protections without a content security policy that
could break Starlight’s inline scripts. Deployment remains a Cloudflare concern; repository CI only
builds and verifies the output.
