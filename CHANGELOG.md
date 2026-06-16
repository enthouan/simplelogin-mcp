# Changelog

## v0.6.0

### Added

- Add an opt-in live SimpleLogin smoke-test workflow through `pnpm smoke:live`, with stdio and HTTP
  runbook coverage in `docs/live-smoke-test.md` and offline smoke-runner tests for cleanup,
  failure summaries, HTTP auth, and startup behavior.

### Changed

- Standardize the public MCP tool surface for the 0.6 milestone: tool names are documented as
  stable 1.0 candidates, every registered tool now carries complete MCP behavior annotations, and
  the generated tool catalog documents each tool's bounds and output shape. Mail-routing updates
  that can stop future delivery, including alias mailbox reassignments and custom-domain routing
  changes, are marked destructive.
- Bound `custom_domain_trash_list` responses with local `page_id`/`limit` pagination (default page
  0, default limit 100, max 500) and return `{ aliases, page_id, limit, returned, total, more }` so
  the unpaginated SimpleLogin endpoint cannot produce unbounded MCP responses while still allowing
  older trash entries to be reached.
- Improve runtime failure diagnostics: SimpleLogin API JSON, text, empty, malformed, timeout,
  abort, network, and rate-limit failures now map deterministically to typed MCP errors with status
  and endpoint context. Logs stay on stderr with redacted structured metadata and never include API
  keys, MCP auth tokens, authorization headers, or request bodies.
- Keep 429 handling explicit and non-retrying in 0.6: rate-limit responses surface the status,
  endpoint, server message, and `Retry-After` hint when present, leaving retry policy to the caller
  so mutating tools are not repeated implicitly.

## v0.5.0

### Added

- Add custom-domain tools: `custom_domain_list` to inspect each domain's verification status,
  settings, and mailboxes, `custom_domain_update` to change the supported settings (catch-all,
  random prefix generation, display name, and the domain's mailbox set), and
  `custom_domain_trash_list` to audit a domain's deleted aliases. Domain create/delete and DNS
  verification are not exposed by the SimpleLogin API and stay in the web UI; they are documented
  as non-goals.
- Guard `custom_domain_update` with local pre-flight checks that reject bad requests with a clear
  message before SimpleLogin is contacted (the API answers them with a generic 400): empty change
  sets, an empty `mailbox_ids` set (a domain must keep at least one mailbox), and more than 20
  mailboxes (the SimpleLogin per-domain cap).
- Add account utility tools: `account_get_stats` for the lifetime alias/forward/reply/block
  counters, `notification_list` and `notification_mark_read` for account notifications, and
  `settings_get`/`settings_update` for the account-wide alias settings. `settings_update` is
  conservative by design: it covers only the five documented alias-behavior fields
  (`alias_generator`, `notification`, `random_alias_default_domain`, `sender_format`,
  `random_alias_suffix`), validates the enum fields locally, and rejects no-op calls before
  SimpleLogin is contacted (the API silently accepts an empty PATCH). Auth, payment,
  account-deletion, and sudo-style endpoints stay out of scope.

## v0.4.0

### Added

- Add mailbox management tools: `mailbox_create` to add a mailbox (verification email sent; the
  mailbox is unusable until verified), `mailbox_update` to promote a verified mailbox to account
  default, change its address (pending until the new address is verified), or cancel a pending
  address change, and `mailbox_delete` to remove a mailbox.
- Guard mailbox mutations with local pre-flight checks that reject bad requests before SimpleLogin
  is contacted: `mailbox_delete` requires `confirm: true` plus an explicit alias fate (exactly one
  of `transfer_aliases_to` or `delete_aliases: true`), refuses to delete the default mailbox, and
  validates the mailbox and transfer target against the live mailbox list (target must exist, be
  verified, and differ from the mailbox being deleted); `mailbox_update` rejects empty change sets,
  `set_default`/`cancel_email_change` values other than `true` (SimpleLogin silently ignores
  `false`), and combining an address change with its cancellation.
- Document mailbox verification, default-mailbox, and alias ownership/transfer behavior in the
  README.

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
