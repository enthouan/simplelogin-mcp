# Support

Use GitHub Issues for non-security questions, documentation problems, and bug reports:

- Ask a usage question when the README or troubleshooting table is unclear.
- File a bug when the server behaves differently from the documented tool surface.
- Request API coverage only after checking [docs/api-coverage.md](docs/api-coverage.md) for
  supported, deferred, and non-goal areas.

Before filing, try the latest release or current `main` when practical, and check:

- [README.md](README.md) for install, configuration, client setup, and troubleshooting.
- [TOOL_CATALOG.md](TOOL_CATALOG.md) for the current MCP tool surface.
- [docs/live-smoke-test.md](docs/live-smoke-test.md) for manual live smoke-test failures.
- [SECURITY.md](SECURITY.md) for credential and exposure guidance.

## What To Include

For setup or runtime issues, include:

- `simplelogin-mcp` version or commit.
- Install path: Docker Compose, GHCR image tag, local `pnpm`, or another wrapper.
- Transport: `http` or `stdio`.
- Client name and version when relevant.
- Sanitized configuration: which variables are set, not their values. Never paste
  `SL_API_KEY`, `MCP_AUTH_TOKEN`, authorization headers, or SimpleLogin account details.
- The exact command or client configuration shape you used, with secrets replaced by placeholders.
- The sanitized error message, HTTP status, or tool error.
- Whether you use `app.simplelogin.io` or a self-hosted SimpleLogin instance.

For live smoke-test cleanup warnings, include the sanitized smoke output fields for the run id,
temporary alias/contact ids, failed cleanup status, and suggested issue notes. Inspect and clean up
leftover SimpleLogin artifacts before rerunning.

## Security Reports

Do not open a public issue for vulnerabilities, credential leaks, authentication bypasses, or
exposure problems. Follow [SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting
from the repository's Security tab when that action is available. If it is not visible, do not
publish sensitive details in an issue or discussion.

## Support Boundaries

This project supports the MCP server, its SimpleLogin API integration, public documentation, Docker
image, and test coverage.

Use SimpleLogin support or the SimpleLogin web UI for:

- account billing, subscription, or premium-plan questions;
- account login, MFA, password reset, or API-key creation problems;
- domain DNS/MX verification and custom-domain ownership setup;
- SimpleLogin web UI behavior outside the documented API;
- email deliverability decisions made by SimpleLogin or recipient mail providers.

For reverse proxies, TLS, firewalls, and hosting platforms, this project can document the server's
requirements (`POST /mcp`, `GET /health`, bearer auth, loopback defaults, and origin validation),
but it cannot provide support for every deployment stack.
