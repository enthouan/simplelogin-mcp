# simplelogin-mcp

A self-hostable [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the
[SimpleLogin](https://simplelogin.io) email-alias API. It exposes the core alias workflow —
list, create (random or custom), update, delete, enable/disable — plus the mailbox, domain, and
account lookups needed to drive it, as MCP tools that Claude and other MCP clients can call. Runs
as a stdio server for local desktop clients or as a stateless Streamable HTTP server you can drop
into a container and self-host.

## Tools

| Tool                  | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `alias_list`          | List aliases (paginated; filter enabled/disabled/pinned; free-text search). |
| `alias_get`           | Get one alias by id.                                                        |
| `alias_create_random` | Create a random alias (`uuid` or `word` mode).                              |
| `alias_create_custom` | Create a custom alias from a prefix + signed suffix + mailboxes.            |
| `alias_update`        | Update note, name, owning mailbox(es), PGP, or pinned state.                |
| `alias_delete`        | Permanently delete an alias (requires `confirm: true`).                     |
| `alias_set_enabled`   | Explicitly enable or disable an alias (idempotent).                         |
| `alias_options_get`   | Get creation options (can_create, suffixes, signed suffixes).               |
| `alias_domains_list`  | List domains usable for alias creation.                                     |
| `mailbox_list`        | List mailboxes (use their ids when creating/updating aliases).              |
| `account_get_info`    | Get user info; doubles as an API-key sanity check.                          |

## Quick start (Docker Compose)

```bash
# 1. Clone and enter the repo
git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp

# 2. Create your .env from the template and add your SimpleLogin API key
cp .env.example .env
# then edit .env and set SL_API_KEY=...

# 3. Build and run
docker compose up -d

# 4. Verify
curl http://localhost:3000/health
# -> {"status":"ok","version":"0.1.0"}
```

The server now listens on `http://localhost:3000` with the MCP endpoint at `POST /mcp`.

> **Prebuilt image:** once this repo's `release` workflow has run, a multi-arch image is published
> to `ghcr.io/enthouan/simplelogin-mcp`. To use it instead of building locally, comment out the
> `build: .` line in `docker-compose.yml` and uncomment the `image:` line.

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)). The server
validates them at startup and exits with a readable message if anything required is missing.

| Variable                | Required | Default                      | Description                                                                      |
| ----------------------- | -------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `SL_API_KEY`            | **Yes**  | —                            | Your SimpleLogin API key. Sent as the `Authentication` header on every API call. |
| `TRANSPORT`             | No       | `http`                       | `http` (self-host) or `stdio` (local desktop clients).                           |
| `PORT`                  | No       | `3000`                       | Port for the HTTP server. Ignored in stdio mode.                                 |
| `SL_API_URL`            | No       | `https://app.simplelogin.io` | SimpleLogin API base URL. Override for a self-hosted instance.                   |
| `MCP_AUTH_TOKEN`        | No       | _(none)_                     | If set, `POST /mcp` requires `Authorization: Bearer <token>`.                    |
| `SL_REQUEST_TIMEOUT_MS` | No       | `15000`                      | Per-request timeout to the SimpleLogin API, in milliseconds.                     |

> **Two distinct secrets:** `SL_API_KEY` authenticates the server **to SimpleLogin** (the
> `Authentication` header on outbound calls). `MCP_AUTH_TOKEN` authenticates clients **to this
> server** (the standard `Authorization: Bearer` header on `POST /mcp`). They are unrelated.

## Getting a SimpleLogin API key

1. Sign in at [app.simplelogin.io](https://app.simplelogin.io) (or your self-hosted instance).
2. Go to **Settings → API Keys**.
3. Create a new API key and copy it into `SL_API_KEY` in your `.env`.

## Connecting a client

### Claude Code (HTTP)

With the server running (see Quick start), register it:

```bash
claude mcp add --transport http simplelogin http://localhost:3000/mcp
```

If you set `MCP_AUTH_TOKEN`, include it:

```bash
claude mcp add --transport http simplelogin http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
```

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
        "ghcr.io/enthouan/simplelogin-mcp:latest"
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

## Self-hosted SimpleLogin

Point the server at your own SimpleLogin instance by setting `SL_API_URL`:

```dotenv
SL_API_URL=https://app.example.com
SL_API_KEY=your-self-hosted-api-key
```

Everything else is unchanged — the same API paths are used against your instance.

## Development

Requires Node.js 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install        # install dependencies
pnpm dev            # run from source with hot reload (tsx)
pnpm build          # compile TypeScript to dist/
pnpm start          # run the compiled server
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format         # prettier --write
```

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

The client's shared `request()` helper handles the `Authentication` header, timeout, error parsing
(throwing a typed `SimpleLoginAPIError`), and Zod validation, so each method stays a one-liner.

The API surface follows the in-app SimpleLogin reference
([`docs/api.md`](https://github.com/simple-login/app/blob/master/docs/api.md)), which is the source
of truth for request/response shapes.

## License

MIT — see [LICENSE](LICENSE).
