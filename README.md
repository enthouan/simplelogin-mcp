# simplelogin-mcp

A self-hostable [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the
[SimpleLogin](https://simplelogin.io) email-alias API. It exposes the core alias workflow —
list, create (random or custom), update, delete, enable/disable — plus mailbox and custom-domain
management and account utilities (info, stats, notifications, settings), as MCP tools that Claude
and other MCP clients can call. It runs as a stdio server for local desktop clients or as a
stateless Streamable HTTP server you can drop into a container and self-host.

## At a Glance

- **Transports:** `http` by default, serving MCP at `POST /mcp` and health at `GET /health`; set
  `TRANSPORT=stdio` for local desktop clients.
- **Fast path:** create a SimpleLogin API key, set `SL_API_KEY`, set `MCP_AUTH_TOKEN` for Docker
  Compose or any exposed HTTP bind, run the server, then point your client at
  `http://localhost:3000/mcp`.
- **Safety model:** `SL_API_KEY` grants control of your SimpleLogin account. HTTP binds to
  `127.0.0.1` by default, refuses unauthenticated non-loopback binds, and accepts browser origins
  only from loopback unless you configure `MCP_ALLOWED_ORIGINS`.
- **Scope:** the supported, deferred, and intentionally excluded SimpleLogin API areas are tracked
  in [docs/api-coverage.md](docs/api-coverage.md). Tool names and annotations are tracked in
  [TOOL_CATALOG.md](TOOL_CATALOG.md).

## Documentation

- [API coverage and non-goals](docs/api-coverage.md)
- [Live smoke-test runbook](docs/live-smoke-test.md)
- [Registry readiness](docs/registry-readiness.md)
- [Security model and vulnerability reporting](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Support policy](SUPPORT.md)
- [Release process](docs/release-process.md)

## Tools

Tool names are stable candidates for the 1.0 public surface. Reads that can grow are bounded:
alias, activity, contact, and notification lists return 20 entries per `page_id`;
`custom_domain_trash_list` is locally paged with `page_id` and `limit` (default 100, max 500). See
[TOOL_CATALOG.md](TOOL_CATALOG.md) for MCP annotations, bounds, and output shapes.
For endpoint-level SimpleLogin API coverage, deferred areas, and explicit non-goals, see
[docs/api-coverage.md](docs/api-coverage.md).

| Tool                       | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `alias_list`               | List aliases (paginated; filter enabled/disabled/pinned; free-text search).                           |
| `alias_get`                | Get one alias by id.                                                                                  |
| `alias_activity_list`      | List an alias's forward/reply/block activity (paginated, 20 per page).                                |
| `alias_create_random`      | Create a random alias (`uuid` or `word` mode).                                                        |
| `alias_create_custom`      | Create a custom alias from a prefix + signed suffix + mailboxes.                                      |
| `alias_update`             | Update note, name, owning mailbox routing, PGP, or pinned state.                                      |
| `alias_delete`             | Permanently delete an alias (requires `confirm: true`).                                               |
| `alias_set_enabled`        | Explicitly enable or disable an alias (idempotent).                                                   |
| `alias_options_get`        | Get creation options (can_create, suffixes, signed suffixes).                                         |
| `alias_domains_list`       | List domains usable for alias creation.                                                               |
| `contact_list`             | List an alias's contacts/reverse aliases (paginated, 20 per page).                                    |
| `contact_create`           | Create a contact (reverse alias) to send mail from an alias.                                          |
| `contact_set_blocked`      | Block or unblock forwarding from a contact (idempotent).                                              |
| `contact_delete`           | Permanently delete a contact (requires `confirm: true`).                                              |
| `mailbox_list`             | List mailboxes (use their ids when creating/updating aliases).                                        |
| `mailbox_create`           | Add a mailbox; it must be verified by email before use.                                               |
| `mailbox_update`           | Set a mailbox as default, change its address, or cancel a pending change.                             |
| `mailbox_delete`           | Permanently delete a mailbox (requires `confirm: true` and an explicit alias transfer/delete choice). |
| `custom_domain_list`       | List custom domains with their settings, verification status, and mailboxes.                          |
| `custom_domain_update`     | Update a custom domain's catch-all, random-prefix, display-name, or mailbox settings.                 |
| `custom_domain_trash_list` | List a custom domain's deleted aliases (trash; paged by `page_id` + `limit`).                         |
| `account_get_info`         | Get user info; doubles as an API-key sanity check.                                                    |
| `account_get_stats`        | Get lifetime counters: aliases, emails forwarded, replied to, and blocked.                            |
| `notification_list`        | List account notifications (paginated, 20 per page, unread first).                                    |
| `notification_mark_read`   | Mark a notification as read (idempotent).                                                             |
| `settings_get`             | Get the account-wide alias settings.                                                                  |
| `settings_update`          | Update the alias settings: generator, notifications, default domain, sender format, suffix.           |

## Common workflows

### Audit recent alias activity

1. Use `alias_list` or `alias_get` to find the numeric `alias_id` for the address you want to
   inspect.
2. Call `alias_activity_list` with that `alias_id` and `page_id: 0` to fetch the newest
   forward/reply/block/bounced events. Each page is capped at 20 entries.
3. Increase `page_id` to walk older activity. Stop when a page returns fewer than 20 entries or the
   event you are investigating is found.
4. For reply investigations, use `reverse_alias` for the display form and `reverse_alias_address`
   for the address clients should reply to.

### Send mail from an alias with a reverse alias

A _contact_ is a reverse alias: an address SimpleLogin generates so you can email someone _from_ an
alias without revealing your real mailbox. Mail you send to the reverse-alias address is rewritten to
come from the alias; the recipient only ever sees the alias.

1. Find the `alias_id` (via `alias_list` or `alias_get`).
2. Call `contact_create` with that `alias_id` and the recipient as `contact`, e.g.
   `"Acme Support <support@acme.com>"` (a bare `support@acme.com` works too).
3. Read `reverse_alias_address` from the result, e.g. `reply+abc123@simplelogin.io`. Send your email
   to that address from the alias; the recipient sees it as coming from the alias. An `existed: true`
   result means the contact already existed and the same reverse alias is reused.
4. To stop a noisy sender, call `contact_set_blocked` with `blocked: true` (it is idempotent, so
   re-blocking is a no-op); set `blocked: false` to allow forwarding again.
5. To remove a reverse alias for good, call `contact_delete` with `confirm: true`. This is permanent
   and breaks the reverse-alias address, so prefer blocking when you only want to silence a contact.

> Creating reverse aliases may require a premium SimpleLogin plan; `contact_create` surfaces the
> API's "please upgrade" error when it does.

### Manage mailboxes

A _mailbox_ is a real email address that receives the mail forwarded by your aliases. Every alias
is owned by one or more mailboxes, and the account has exactly one _default_ mailbox that new
aliases attach to unless told otherwise.

**Verification.** A mailbox must prove it exists before SimpleLogin will use it:

1. `mailbox_create` adds a mailbox and sends a verification email to the address. The new mailbox
   starts with `verified: false` and cannot own aliases or become the default until the link in
   that email is clicked. Poll `mailbox_list` to see `verified` turn true. Additional mailboxes
   may require a premium plan.
2. `mailbox_update` with `email` starts an address change, which is also verification-gated: the
   new address gets its own verification email and the change stays pending until confirmed. Use
   `cancel_email_change: true` to abort a pending change (the two fields are mutually exclusive).
3. `mailbox_update` with `set_default: true` promotes a verified mailbox to account default.
   There is no `set_default: false`: a mailbox stops being the default only when another one is
   promoted.

**Deletion and alias transfer.** `mailbox_delete` is permanent and affects the aliases the
mailbox owns, so it cannot happen accidentally:

1. You must pass `confirm: true`, and you must choose the aliases' fate explicitly: either
   `transfer_aliases_to` (the id of a different, verified mailbox from `mailbox_list` that takes
   over the owned aliases) or `delete_aliases: true` (the aliases are deleted with the mailbox).
   Omitting both, or passing both, is rejected before SimpleLogin is contacted.
2. The default mailbox cannot be deleted. Promote another mailbox with `mailbox_update`
   `set_default: true` first, then delete.
3. The server pre-checks the deletion against `mailbox_list` and refuses with a clear message
   when the mailbox id is unknown, the transfer target is missing or unverified, or the target is
   the mailbox being deleted, so nothing is destroyed on a mistyped id.

To merely stop an alias from delivering to a mailbox, do not delete the mailbox: update the alias
itself with `alias_update` (`mailbox_ids`) or disable it with `alias_set_enabled`. Reassigning an
alias's mailboxes can stop future mail from landing in removed mailboxes, so clients should treat
that routing update as destructive.

### Maintain a custom domain

A _custom domain_ is a domain you own and have pointed at SimpleLogin, so aliases can live on your
own domain instead of a SimpleLogin one.

1. `custom_domain_list` shows each domain's id, `is_verified` state, alias count, settings, and
   the mailboxes that receive its mail. Aliases on the domain only work once `is_verified` is true.
2. `custom_domain_update` changes the supported settings; only the fields you pass change:
   - `catch_all: true` makes mail sent to any unknown address on the domain auto-create an alias
     (on-the-fly creation); `random_prefix_generation: true` gives those aliases a random prefix
     instead of the address that was targeted. Disabling catch-all can stop future mail for unknown
     addresses, so clients should treat this routing update as destructive.
   - `name` sets the display name used as the From name on the domain's aliases; pass `null` to
     clear it.
   - `mailbox_ids` replaces the domain's full mailbox set (1 to 20 ids from `mailbox_list`). An
     empty set, a no-op call, or more than 20 mailboxes is rejected before SimpleLogin is
     contacted.
3. `custom_domain_trash_list` lists the domain's deleted aliases with their deletion timestamps.
   SimpleLogin remembers them so catch-all does not silently resurrect a deleted address; check it
   when a catch-all address unexpectedly bounces or before reusing an old address. The API does not
   paginate this endpoint server-side, so the MCP result returns
   `{ aliases, page_id, limit, returned, total, more }` and locally pages `aliases` with `page_id`
   (starting at 0) plus `limit` (default 100, max 500).

**Non-goals.** Adding or deleting a custom domain, and DNS/MX verification, are account-level
operations the SimpleLogin API does not expose; do them in the SimpleLogin web UI (Domains tab).
Subdomains of SimpleLogin-provided domains are also not returned by `custom_domain_list`.

### Check on the account

1. `account_get_stats` returns the account's lifetime counters: total aliases and emails
   forwarded, replied to, and blocked across all aliases. Use `alias_activity_list` to drill
   into the per-alias events behind a surprising number.
2. `notification_list` pages through SimpleLogin's account notifications (announcements and
   warnings such as a bouncing mailbox), 20 per page, unread first. Each entry's `message` is
   HTML and `created_at` is human-readable text ("2 days ago"). After handling one, call
   `notification_mark_read` with its id; marking an already-read notification is a harmless
   no-op. The API offers no unread or delete.
3. `settings_get` and `settings_update` read and change the account-wide alias settings. Only
   the fields you pass change, a call that changes nothing is rejected before SimpleLogin is
   contacted, and the resulting settings are returned:
   - `alias_generator` (`word` or `uuid`) sets the address style of random aliases, and
     `random_alias_suffix` (`word` or `random_string`) the suffix style for random and
     on-the-fly aliases.
   - `random_alias_default_domain` sets the domain random aliases are created on; it must be
     one of the domains from `alias_domains_list` (premium-only domains require a premium
     account, and a custom domain must be yours and verified; SimpleLogin rejects anything
     else with a clear error).
   - `sender_format` controls how the original sender appears in forwarded mail: `AT`
     ("John Wick - john at wick.com"), `A` ("John Wick - john(a)wick.com"), `NAME_ONLY`,
     `AT_ONLY`, or `NO_NAME`.
   - `notification` (boolean) turns SimpleLogin's email notifications on or off.

**Non-goals.** `settings_update` is deliberately limited to those five documented
alias-behavior fields. Account email/password changes, payment and subscription management,
account deletion, and sudo-mode endpoints are out of scope by design; do them in the
SimpleLogin web UI.

## Install And Run

### Prerequisites

- A SimpleLogin account with an API key from **Settings -> API Keys**.
- Either Docker with Docker Compose, or Node.js 24.x with [pnpm](https://pnpm.io).
- An MCP client that supports Streamable HTTP or stdio.

### Docker Compose

Use this path for operator or self-hosted deployments. The default Compose file pulls the published
GHCR image and does not build from your checkout.

```bash
git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
SL_API_KEY=sl-your-key-here
MCP_AUTH_TOKEN=replace-with-output-from-openssl-rand-hex-32
```

Generate a token with:

```bash
openssl rand -hex 32
```

Then start and verify the server:

```bash
docker compose up -d
docker compose ps
curl http://localhost:3000/health
# -> {"status":"ok","version":"0.8.1"}
```

The default `docker-compose.yml` uses
`ghcr.io/enthouan/simplelogin-mcp:${SIMPLELOGIN_MCP_IMAGE_TAG:-latest}`. `latest` follows the
repository's default branch; pin a release tag such as `0.8.1` for repeatable deployments:

```bash
SIMPLELOGIN_MCP_IMAGE_TAG=latest docker compose up -d
SIMPLELOGIN_MCP_IMAGE_TAG=0.8.1 docker compose up -d
```

You can also set the same value in `.env`:

```dotenv
SIMPLELOGIN_MCP_IMAGE_TAG=0.8.1
```

The Compose files bind the container on `HOST=0.0.0.0` for Docker port forwarding, keep the
container's internal HTTP listener on port `3000`, and publish the host port on loopback only by
default (`127.0.0.1:3000:3000`). Because the app sees a non-loopback bind inside the container,
`MCP_AUTH_TOKEN` is required even for the default loopback-only Compose deployment.

Change the host-side bind or port with the Compose-specific variables, not `PORT`:

```bash
SIMPLELOGIN_MCP_HOST_PORT=3001 docker compose up -d
curl http://localhost:3001/health

SIMPLELOGIN_MCP_HOST_BIND_IP=0.0.0.0 SIMPLELOGIN_MCP_HOST_PORT=3000 docker compose up -d
```

Set `SIMPLELOGIN_MCP_HOST_BIND_IP=0.0.0.0` only when you intentionally want LAN access, and keep
`MCP_AUTH_TOKEN` set before widening exposure.

### Local Docker Build

Use this path when developing the project, testing source changes, or validating the Docker image
from the local checkout:

```bash
docker compose -f docker-compose.local.yml up --build
```

This uses `docker-compose.local.yml`, builds from the local `Dockerfile`, tags the image as
`simplelogin-mcp:local`, and keeps the same loopback-only host publishing and `MCP_AUTH_TOKEN`
expectations as the published-image Compose file.

The Dockerfile uses `node:24-bookworm-slim` for both builder and runtime stages. Its healthcheck
uses Node's built-in `fetch`, so the image does not need distribution-specific tools such as
`wget`.

### Local pnpm

Local runs do not automatically read `.env`; export the variables in your shell or source the file
before starting:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# edit .env, then:
set -a
. ./.env
set +a
pnpm build
pnpm start
```

For source-mode development over HTTP:

```bash
TRANSPORT=http HOST=127.0.0.1 PORT=3000 SL_API_KEY=sl-your-key pnpm dev
curl http://localhost:3000/health
```

For stdio after a local build:

```bash
TRANSPORT=stdio SL_API_KEY=sl-your-key node dist/index.js
```

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)). The server
validates them at startup and exits with a readable message if anything required is missing.

| Variable                         | Required | Default                      | Description                                                                                          |
| -------------------------------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SL_API_KEY`                     | **Yes**  | —                            | Your SimpleLogin API key. Sent as the `Authentication` header on every API call.                     |
| `TRANSPORT`                      | No       | `http`                       | `http` (self-host) or `stdio` (local desktop clients).                                               |
| `HOST`                           | No       | `127.0.0.1`                  | Interface the HTTP server binds to. Loopback by default; `0.0.0.0` exposes it (requires a token).    |
| `PORT`                           | No       | `3000`                       | Port for the HTTP server. Ignored in stdio mode; Compose keeps the container listener on `3000`.     |
| `SIMPLELOGIN_MCP_HOST_BIND_IP`   | No       | `127.0.0.1`                  | Docker Compose host interface bind address. Keep loopback unless intentionally exposing the service. |
| `SIMPLELOGIN_MCP_HOST_PORT`      | No       | `3000`                       | Docker Compose host port mapped to the container's fixed internal `3000` listener.                   |
| `SIMPLELOGIN_MCP_IMAGE_TAG`      | No       | `latest`                     | Published image tag used by `docker-compose.yml`; ignored by `docker-compose.local.yml`.             |
| `SL_API_URL`                     | No       | `https://app.simplelogin.io` | SimpleLogin API base URL. Override for a self-hosted instance.                                       |
| `MCP_AUTH_TOKEN`                 | No       | _(none)_                     | If set, `POST /mcp` requires `Authorization: Bearer <token>`. Required for any non-loopback `HOST`.  |
| `MCP_ALLOWED_ORIGINS`            | No       | _(none)_                     | Comma-separated extra browser origins allowed to call `POST /mcp` (loopback origins always allowed). |
| `ALLOW_UNAUTHENTICATED_EXPOSURE` | No       | `false`                      | Permit a non-loopback bind without a token. Only when exposure is contained elsewhere.               |
| `SL_REQUEST_TIMEOUT_MS`          | No       | `15000`                      | Per-request timeout to the SimpleLogin API, in milliseconds.                                         |

> **Two distinct secrets:** `SL_API_KEY` authenticates the server **to SimpleLogin** (the
> `Authentication` header on outbound calls). `MCP_AUTH_TOKEN` authenticates clients **to this
> server** (the standard `Authorization: Bearer` header on `POST /mcp`). They are unrelated.

> **Safe by default:** the HTTP server binds `127.0.0.1` and is reachable only from the local
> machine. Binding `0.0.0.0` (or a LAN IP) without `MCP_AUTH_TOKEN` is refused at startup, so exposing
> the endpoint is always an explicit choice. See [SECURITY.md](SECURITY.md) for the full model.
> Docker Compose sets `HOST=0.0.0.0` inside the container for port forwarding, so its quick start
> requires `MCP_AUTH_TOKEN` even though the host port is published on loopback. Use
> `SIMPLELOGIN_MCP_HOST_PORT` for Compose host-port changes; leave `PORT` at `3000` unless you are
> deliberately editing the container's internal listener.

## Getting a SimpleLogin API Key

1. Sign in at [app.simplelogin.io](https://app.simplelogin.io) (or your self-hosted instance).
2. Go to **Settings → API Keys**.
3. Create a new API key and copy it into `SL_API_KEY` in your `.env`.

## Connecting A Client

### Claude Code (HTTP)

With the HTTP server running, register it with the token from `.env`:

```bash
claude mcp add --transport http simplelogin http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
```

For loopback-only, non-container use with no `MCP_AUTH_TOKEN`, omit the header:

```bash
claude mcp add --transport http simplelogin http://localhost:3000/mcp
```

### Generic HTTP Clients

Use the Streamable HTTP endpoint:

- URL: `http://localhost:3000/mcp` (or your reverse-proxy URL)
- Method: `POST`
- Auth header when `MCP_AUTH_TOKEN` is set: `Authorization: Bearer <token>`
- Health check: `GET http://localhost:3000/health`

Non-browser clients usually send no `Origin` header. Browser-based clients should be same-origin
with the MCP endpoint, or sit behind a reverse proxy that handles CORS preflights and
`Access-Control-Allow-Origin` response headers. `MCP_ALLOWED_ORIGINS` only controls this server's
`Origin` check for `POST /mcp`; it does not add CORS response headers or handle `OPTIONS`
preflights.

### Claude Desktop (stdio)

Edit your `claude_desktop_config.json` (Settings → Developer → Edit Config) to run the server over
stdio in a one-shot container:

```json
{
  "mcpServers": {
    "simplelogin": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "TRANSPORT=stdio",
        "-e",
        "SL_API_KEY=sl-your-key-here",
        "ghcr.io/enthouan/simplelogin-mcp:0.8.1"
      ]
    }
  }
}
```

Or, after building locally (`pnpm install && pnpm build`), point it at the compiled entry:

```json
{
  "mcpServers": {
    "simplelogin": {
      "command": "node",
      "args": ["/absolute/path/to/simplelogin-mcp/dist/index.js"],
      "env": { "TRANSPORT": "stdio", "SL_API_KEY": "sl-your-key-here" }
    }
  }
}
```

### Generic stdio Clients

Configure the client to launch a command that keeps stdin/stdout attached to the MCP process:

- Command: `node`
- Args: `/absolute/path/to/simplelogin-mcp/dist/index.js`
- Environment: `TRANSPORT=stdio`, `SL_API_KEY=<your SimpleLogin API key>`, and optionally
  `SL_API_URL=<your self-hosted SimpleLogin origin>`

`MCP_AUTH_TOKEN` is not needed for stdio-only use; it only protects the HTTP endpoint.

## Self-hosted SimpleLogin

Point the server at your own SimpleLogin instance by setting `SL_API_URL`:

```dotenv
SL_API_URL=https://app.example.com
SL_API_KEY=your-self-hosted-api-key
```

Use the web app origin, not an `/api`-suffixed URL; the server appends SimpleLogin API paths itself.
Create the API key on that same instance and keep it separate from any key used for
`app.simplelogin.io`.

Compatibility depends on the self-hosted SimpleLogin version exposing the same API paths and
response shapes documented upstream. Start with `account_get_info` as a credential sanity check,
then use [docs/live-smoke-test.md](docs/live-smoke-test.md) only when you intentionally want a live
write test. If a self-hosted fork or older deployment returns different payloads, this server may
surface a validation or SimpleLogin API error rather than guessing.

Network exposure is separate from SimpleLogin hosting. If this MCP server is reachable outside the
local machine, set `MCP_AUTH_TOKEN` and terminate TLS at a reverse proxy. For cross-origin browser
clients, the proxy must handle CORS and `MCP_ALLOWED_ORIGINS` must include the exact browser origin.
The server itself speaks plain HTTP.

## Troubleshooting

| Symptom                                                         | What to check                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Startup says `SL_API_KEY is required`                           | Set a non-empty `SL_API_KEY`. Docker Compose reads it from `.env`; local `pnpm` runs need the variable exported in the shell or sourced from `.env`.                                                                                                                           |
| Tools return SimpleLogin `401`, `403`, or "Invalid API key"     | The SimpleLogin key may be wrong, revoked, copied with whitespace, or created on a different SimpleLogin instance than `SL_API_URL`. Verify with `account_get_info` after fixing the key.                                                                                      |
| SimpleLogin API timeouts or network errors                      | Confirm `SL_API_URL` is reachable from the server, check proxy/TLS/firewall rules, and increase `SL_REQUEST_TIMEOUT_MS` only if the instance is expected to be slow. Mutating requests are not retried automatically.                                                          |
| HTTP client gets `401 {"error":"Unauthorized"}`                 | `MCP_AUTH_TOKEN` is set on the server but the client did not send `Authorization: Bearer <token>`, sent the wrong token, or included extra whitespace. Rotate the token if it may have leaked.                                                                                 |
| Browser client gets `403 {"error":"Forbidden origin"}`          | Add the exact browser origin, including scheme and port, to `MCP_ALLOWED_ORIGINS`. Loopback origins are allowed by default; non-browser MCP clients normally send no `Origin` and are unaffected.                                                                              |
| Startup refuses `HOST=0.0.0.0` without `MCP_AUTH_TOKEN`         | Set `MCP_AUTH_TOKEN`, bind to `127.0.0.1`, or use `ALLOW_UNAUTHENTICATED_EXPOSURE=true` only when another layer already authenticates or isolates the endpoint.                                                                                                                |
| Docker container is unhealthy                                   | Run `docker compose logs simplelogin-mcp`, confirm `.env` contains `SL_API_KEY` and `MCP_AUTH_TOKEN`, and check `curl http://localhost:3000/health` from the host. A config error exits before the health check can pass.                                                      |
| Port `3000` is already in use                                   | For Compose, set `SIMPLELOGIN_MCP_HOST_PORT=3001` and point clients at port 3001. Leave `PORT=3000` for Compose unless you also edit the container side of `ports` and the healthcheck URL. For local pnpm HTTP runs, set `PORT=<free-port>`.                                  |
| Self-hosted SimpleLogin calls fail                              | Set `SL_API_URL` to the instance origin without `/api`, create `SL_API_KEY` on that instance, and confirm the deployment matches upstream API behavior. Older or forked instances can differ from the response schemas this server validates.                                  |
| `contact_create` or mailbox/domain tools report plan/API limits | Some SimpleLogin capabilities, especially reverse-alias contact creation and additional mailboxes/domains, can depend on account plan and upstream API support. The server surfaces SimpleLogin's error; use the SimpleLogin web UI or account plan details to confirm access. |
| Live smoke test warns cleanup failed or could not be verified   | Do not rerun blindly. Follow [docs/live-smoke-test.md](docs/live-smoke-test.md), inspect the temporary alias/contact ids from the sanitized output, delete leftovers in SimpleLogin if needed, and include the run id plus cleanup status in a follow-up issue.                |

## Development

Requires Node.js 24.x and [pnpm](https://pnpm.io).

```bash
pnpm install        # install dependencies
pnpm dev            # run from source with hot reload (tsx)
pnpm build          # compile TypeScript to dist/
pnpm start          # run the compiled server
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest unit tests; no live SimpleLogin credentials
pnpm format         # prettier --write
pnpm format:check   # prettier --check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup requirements, test expectations, API endpoint
addition patterns, generated catalog expectations, and branch/PR hygiene.

Live SimpleLogin smoke tests are manual and opt-in; they create a temporary alias and verify cleanup.
See [docs/live-smoke-test.md](docs/live-smoke-test.md) for the stdio and HTTP commands, required
environment variables, cleanup guarantees, and failure summary format.

Run locally over HTTP:

```bash
TRANSPORT=http SL_API_KEY=sl-your-key pnpm dev
curl http://localhost:3000/health
```

### Architecture

Adding a new SimpleLogin endpoint is intentionally a small, three-step change:

1. Add the path to [`src/constants.ts`](src/constants.ts).
2. Add a Zod response schema in [`src/schemas/`](src/schemas).
3. Add a thin client method in [`src/client/simplelogin.ts`](src/client/simplelogin.ts) and a tool
   registration in [`src/tools/`](src/tools).

The client's shared `request()` helper handles the `Authentication` header, timeout, deterministic
error parsing (throwing a typed `SimpleLoginAPIError` for JSON, text, empty, malformed, timeout,
abort, network, and rate-limit failures), and Zod validation, so each method stays a one-liner.
429 responses are reported with status, endpoint, and `Retry-After` when SimpleLogin provides it;
the server does not retry automatically, so mutating tools are never repeated implicitly.

The API surface follows the in-app SimpleLogin reference
([`docs/api.md`](https://github.com/simple-login/app/blob/master/docs/api.md)), which is the source
of truth for request/response shapes.

## Security

The `SL_API_KEY` grants full control of your SimpleLogin account, so treat it like a password.
The HTTP server is safe by default (loopback bind) and refuses to start exposed without a token.
For the credential risk model, network exposure patterns, and how to report a vulnerability, see
[SECURITY.md](SECURITY.md).

For questions and non-security bug reports, see [SUPPORT.md](SUPPORT.md). Maintainer release steps
are documented in [docs/release-process.md](docs/release-process.md).

## License

MIT — see [LICENSE](LICENSE).
