# Contributing

Thanks for helping improve `simplelogin-mcp`. This project is pre-1.0, but the public MCP tool
surface is treated carefully: tool names, bounds, annotations, and safety behavior should not drift
without explicit documentation and tests.

## Requirements

- Node.js 22 or newer.
- pnpm, preferably through Corepack (`corepack enable`).
- Docker and Docker Compose when changing container behavior.
- A SimpleLogin API key only when intentionally running the manual live smoke test.

Do not use live SimpleLogin credentials in unit tests, fixtures, logs, screenshots, or pull request
text. `.env` is for local Compose use and must stay untracked.

## Setup

```bash
git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
corepack enable
pnpm install --frozen-lockfile
```

Local `pnpm` commands do not automatically load `.env`. Export environment variables in your shell
or source `.env` before running the server locally.

## Development Commands

```bash
pnpm typecheck      # TypeScript without emit
pnpm lint           # ESLint
pnpm build          # compile TypeScript to dist/
pnpm test           # Vitest unit tests, no live network required
pnpm format         # Prettier write
pnpm format:check   # Prettier check
pnpm smoke:live     # manual live SimpleLogin smoke test; opt-in only
```

Run the full validation set before opening a pull request:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm format:check
```

Live smoke tests are not part of normal CI. Use them only when a change needs live SimpleLogin
verification, and follow [docs/live-smoke-test.md](docs/live-smoke-test.md).

## Adding Or Changing API Coverage

Keep endpoint changes small and traceable:

1. Add or update the API path in [src/constants.ts](src/constants.ts).
2. Add or update Zod request/response schemas in [src/schemas/](src/schemas).
3. Add a thin method in [src/client/simplelogin.ts](src/client/simplelogin.ts). The shared
   `request()` helper owns authentication, timeouts, error parsing, redaction, and response
   validation.
4. Register the MCP tool in [src/tools/](src/tools) with clear input descriptions and annotations
   from [src/tools/catalog.ts](src/tools/catalog.ts).
5. Add focused unit tests for client behavior, tool registration, local guardrails, and error
   handling. Tests must use stubs and fixtures, not live credentials.
6. Update public docs: [README.md](README.md), [TOOL_CATALOG.md](TOOL_CATALOG.md), and
   [docs/api-coverage.md](docs/api-coverage.md) when scope changes.

Prefer read-only or locally guarded behavior first. Permanent deletes require explicit
confirmation inputs, and mail-routing changes that can stop future delivery must be documented as
destructive.

## Tool Catalog And README Drift

[src/tools/catalog.ts](src/tools/catalog.ts) is the source for registered tool order, annotation
expectations, bounds, and generated catalog text. [TOOL_CATALOG.md](TOOL_CATALOG.md) is the public
rendering of that source, and [test/tools.test.ts](test/tools.test.ts) checks that:

- registered tool names exactly match the catalog order;
- tool annotations match the catalog;
- bounded reads document `page_id`, limits, and defaults;
- the README tool table stays in registered-tool order;
- `TOOL_CATALOG.md` matches the formatted output of `renderToolCatalogMarkdown()`.

When a tool changes, update the catalog source and the public docs together. Do not hand-edit tool
names in the README without confirming `pnpm test` still passes.

## Branch And Pull Request Hygiene

- Branch from current `origin/main`.
- Keep each pull request scoped to one issue or one coherent change.
- Do not rename existing MCP tools or change runtime behavior in documentation-only issues.
- Include validation commands and results in the pull request description.
- Do not include secrets, machine-local tokens, or private account details.
- Use short, direct commit and pull request titles that match the repository history.
- The `main` branch is protected; release and feature work should go through pull requests.

Security issues should not be filed publicly. Follow [SECURITY.md](SECURITY.md).
