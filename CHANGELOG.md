# Changelog

## v0.3.0

### Added

- Add `alias_activity_list`, a read-only tool that returns an alias's forward/reply/block activity
  history. Results are paginated at 20 entries per page (`page_id`, zero-based) so responses stay
  bounded, making it suitable for auditing how a specific alias has been used.
- Add alias contact (reverse-alias) tools: `contact_list` (read-only, paginated at 20 per page),
  `contact_create` to make a reverse alias for sending mail from an alias, `contact_set_blocked` to
  block or unblock forwarding from a contact, and `contact_delete` to remove one. `contact_set_blocked`
  is idempotent (it reads the contact's current state first, so setting a state it is already in is a
  no-op), and `contact_delete` requires `confirm: true` to guard the permanent, irreversible removal.

## v0.2.0

### Security

- **Breaking:** The HTTP server now binds `127.0.0.1` by default (was `0.0.0.0`), so a fresh
  deployment is reachable only from the local machine. Set the new `HOST` variable to expose it.
- Refuse to start when bound to a non-loopback address without `MCP_AUTH_TOKEN`, preventing
  accidental unauthenticated exposure of full SimpleLogin account control. Override with
  `ALLOW_UNAUTHENTICATED_EXPOSURE=true` only when exposure is contained elsewhere.
- Validate the `Origin` header on `POST /mcp` (DNS-rebinding / CSRF defense); loopback origins are
  allowed by default and extra origins can be added via `MCP_ALLOWED_ORIGINS`.
- Publish the Docker Compose port on the host's loopback only (`127.0.0.1:3000:3000`) while keeping
  the non-loopback auth guard active, so Compose deployments require `MCP_AUTH_TOKEN`.
- Add `SECURITY.md` documenting the credential risk model, network exposure model, and vulnerability
  reporting.

### Changed

- **Breaking:** Replace the stateless `alias_toggle` tool with `alias_set_enabled`, which takes an
  explicit `enabled` boolean. Setting an alias to a state it is already in is a no-op, so agents can
  set enabled state predictably without first reading the alias.
- **Breaking:** `alias_delete` now requires `confirm: true` to guard against accidental permanent
  deletion.

### Fixed

- Reject no-op `alias_update` calls (no fields to change) before contacting SimpleLogin.
- Reject `alias_update` calls that pass both `mailbox_id` and `mailbox_ids`, which are mutually
  exclusive.
- Treat blank optional env-file values as unset, so copied `.env.example` files can leave optional
  settings empty.

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
