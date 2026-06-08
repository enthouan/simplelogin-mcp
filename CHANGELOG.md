# Changelog

## Unreleased

- Track future release notes here before cutting the next version.

## v0.1.0

Initial private MVP release for a self-hostable SimpleLogin MCP server.

### SimpleLogin Tools

- Add alias listing with pagination, enabled/disabled/pinned filters, and free-text search.
- Add alias lookup by numeric id.
- Add random alias creation with optional `uuid` or `word` mode, note, and hostname context.
- Add custom alias creation from a prefix, signed suffix, mailbox ids, and optional note/name/hostname.
- Add alias updates for note, name, mailbox ownership, PGP disabled state, and pinned state.
- Add alias delete and enable/disable toggle tools.
- Add alias creation options lookup for `can_create`, suffixes, signed suffixes, and prefix suggestions.
- Add alias-domain listing for domains available during alias creation.
- Add mailbox listing for mailbox ids used by alias create/update workflows.
- Add account info lookup for API-key sanity checks.

### Runtime And Configuration

- Support Streamable HTTP transport for self-hosted/container deployments.
- Support stdio transport for local MCP clients.
- Expose `GET /health` for basic HTTP health checks.
- Validate environment configuration with Zod.
- Support `SL_API_KEY`, `TRANSPORT`, `PORT`, `SL_API_URL`, `MCP_AUTH_TOKEN`, and `SL_REQUEST_TIMEOUT_MS`.
- Centralize SimpleLogin API requests in a typed client with response validation and timeout handling.

### Deployment And Documentation

- Add Dockerfile and Docker Compose configuration.
- Add `.env.example` documenting supported configuration.
- Add README quick start, SimpleLogin API key setup, HTTP client setup, stdio client setup, and self-hosted SimpleLogin notes.
- Add release workflow for publishing a multi-arch GHCR image.
