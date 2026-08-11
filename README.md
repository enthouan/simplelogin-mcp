# simplelogin-mcp

An independent, self-hostable [Model Context Protocol](https://modelcontextprotocol.io) server for
existing [SimpleLogin](https://simplelogin.io) users. It lets compatible MCP clients create and
manage aliases, inspect alias activity metadata, work with reverse aliases, manage routing, and
review account settings through a server you run.

> **Independent project:** simplelogin-mcp is an independent, open-source project. It is not an
> official SimpleLogin or Proton AG product, service, or MCP implementation, and it is not
> affiliated with, endorsed by, or sponsored by SimpleLogin or Proton AG.

## At a Glance

- **Local stdio** lets one local MCP client launch the server without opening a network listener.
- **Direct Node.js — Streamable HTTP** runs a persistent service on loopback by default.
- **Docker Compose — Streamable HTTP** runs the published container with loopback-only host
  publishing by default.
- `SL_API_KEY` grants full control of your SimpleLogin account. Keep it out of prompts, logs, shell
  history, and version control.
- Tool names, inputs, safety annotations, bounds, and output descriptions come from the same
  catalog and schemas used by the server.

## Documentation

The website is the canonical user documentation:

- [Get started](https://simplelogin-mcp.com/getting-started/)
- [Create a SimpleLogin API key](https://simplelogin-mcp.com/getting-started/simplelogin-api-key/)
- [Set up your MCP client](https://simplelogin-mcp.com/getting-started/clients/)
- [Browse the tool catalog](https://simplelogin-mcp.com/reference/tools/)
- [Review API coverage and non-goals](https://simplelogin-mcp.com/reference/api-coverage/)
- [Understand Security & Data](https://simplelogin-mcp.com/guides/security/)
- [Operate a running deployment](https://simplelogin-mcp.com/guides/operations/)
- [Troubleshoot an installation](https://simplelogin-mcp.com/guides/troubleshooting/)
- [View the published container package](https://github.com/enthouan/simplelogin-mcp/pkgs/container/simplelogin-mcp)

Repository-maintainer documentation remains alongside the code:

- [Live smoke-test runbook](docs/live-smoke-test.md)
- [Registry readiness](docs/registry-readiness.md)
- [Release process](docs/release-process.md)
- [Contributing guide](CONTRIBUTING.md)
- [Support policy](SUPPORT.md)
- [Vulnerability reporting](SECURITY.md)

## Tools

The catalog covers aliases, contacts and reverse aliases, mailboxes, custom domains, notifications,
and account settings. Read operations with potentially large results are bounded, and permanent
deletions require explicit confirmation.

Use the searchable [website tool catalog](https://simplelogin-mcp.com/reference/tools/) for the
current public surface, or read the generated [TOOL_CATALOG.md](TOOL_CATALOG.md) beside the source.
Endpoint-level support and deliberate non-goals are documented in
[API coverage](https://simplelogin-mcp.com/reference/api-coverage/).

## Common workflows

The [workflow guide](https://simplelogin-mcp.com/guides/workflows/) provides complete, reviewable
sequences. These summaries preserve the most common entry points.

### Audit recent alias activity

Find the alias with `alias_list` or `alias_get`, then inspect bounded activity-metadata pages with
`alias_activity_list`. Results describe forwards, replies, blocks, and bounces; the server does not
read email message bodies.

### Create a reverse alias for sending

Use `contact_create` to create or reuse a reverse alias for a recipient. Then send the actual
message from a real mailbox that owns the alias to the returned reverse-alias address. The MCP
server creates the routing address; it does not compose or send the email.

### Manage mailboxes

Use `mailbox_list` before creating, updating, or deleting a mailbox. New addresses require
verification in SimpleLogin, and permanent deletion requires both `confirm: true` and an explicit
transfer-or-delete decision for owned aliases.

### Maintain a custom domain

The server can inspect and update supported settings for an existing custom domain. Domain creation,
deletion, DNS, and MX verification remain in SimpleLogin's official interface.

### Check on the account

Use `account_get_stats` for aggregate account counts, `notification_list` for bounded account
notifications, and `settings_get` before making supported changes with `settings_update`.

## Install And Run

### Prerequisites

- A SimpleLogin account with a [dedicated API key](https://simplelogin-mcp.com/getting-started/simplelogin-api-key/).
- Git.
- Node.js 24.x with Corepack and pnpm 11.5.1, or Docker with Docker Compose.
- A compatible MCP client.

### Local stdio

Local stdio is the recommended starting point when the client and server run on the same machine:

```bash
git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
corepack enable
pnpm install --filter simplelogin-mcp --frozen-lockfile
pnpm build
```

Next, follow the [recipe for your MCP client](https://simplelogin-mcp.com/getting-started/clients/),
point it at the absolute path to `dist/index.js`, set `TRANSPORT=stdio` and `SL_API_KEY` in its
private configuration, restart the client, and verify discovery with the documented read-only call.

### Docker Compose

Use the bundled Compose file for an operator-managed persistent service:

```bash
git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
cp .env.example .env
# Set SL_API_KEY and MCP_AUTH_TOKEN in .env
docker compose up -d
docker compose ps
curl http://localhost:3000/health
```

The default file pulls the [published GHCR image](https://github.com/enthouan/simplelogin-mcp/pkgs/container/simplelogin-mcp),
publishes the host port only on `127.0.0.1`, and requires `MCP_AUTH_TOKEN` because the application
binds `0.0.0.0` inside the container. Pin `SIMPLELOGIN_MCP_IMAGE_TAG` to a release for repeatable
deployments. See the [Docker Compose guide](https://simplelogin-mcp.com/getting-started/docker/)
before widening the host bind.

### Local Docker Build

For source changes, build the container from the checkout instead of pulling GHCR:

```bash
docker compose -f docker-compose.local.yml up --build
```

### Local pnpm

For Direct Node.js — Streamable HTTP development, copy `.env.example`, set `SL_API_KEY`, and load
the ignored file only into a subshell:

```bash
corepack enable
pnpm install --filter simplelogin-mcp --frozen-lockfile
cp .env.example .env
pnpm build
(
  set -a
  . ./.env
  set +a
  TRANSPORT=http HOST=127.0.0.1 PORT=3000 pnpm start
)
```

The MCP endpoint is `POST http://127.0.0.1:3000/mcp`; `GET /health` verifies only process health.
See the [Streamable HTTP guide](https://simplelogin-mcp.com/getting-started/http/) for client
authentication and wider-network requirements.

## Configuration

Configuration is provided through environment variables and validated at startup. The primary
settings are:

| Variable         | Purpose                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `SL_API_KEY`     | Required SimpleLogin credential; grants full account control.                           |
| `TRANSPORT`      | Literal `stdio` or `http`; defaults to `http`.                                          |
| `SL_API_URL`     | Hosted or self-hosted SimpleLogin web-app origin.                                       |
| `HOST` / `PORT`  | Direct Streamable HTTP listener; defaults to `127.0.0.1:3000`.                          |
| `MCP_AUTH_TOKEN` | Separate bearer token protecting `POST /mcp`; required for normal non-loopback startup. |

See the complete [configuration reference](https://simplelogin-mcp.com/reference/configuration/)
for Compose publishing, allowed browser origins, timeouts, private CAs, and proxy variables.

## Getting a SimpleLogin API Key

Create a dedicated key in the SimpleLogin dashboard and keep it private. Follow the
[API-key guide](https://simplelogin-mcp.com/getting-started/simplelogin-api-key/) for hosted and
self-hosted instances.

## Connecting A Client

Use the maintained [client setup recipes](https://simplelogin-mcp.com/getting-started/clients/) for
Codex, Claude Code, Claude Desktop, VS Code, and OpenCode. The
[compatibility page](https://simplelogin-mcp.com/getting-started/compatibility/) records the scope
and limitations of current evidence.

## Self-hosted SimpleLogin

Set `SL_API_URL` to the self-hosted web-app origin without an `/api` suffix, and create
`SL_API_KEY` on that same instance. Private-CA and proxy configuration is documented in the
[configuration reference](https://simplelogin-mcp.com/reference/configuration/). Compatibility
depends on the instance exposing upstream-compatible API paths and response shapes.

## Troubleshooting

Start with the [troubleshooting guide](https://simplelogin-mcp.com/guides/troubleshooting/). Do not
include API keys, bearer tokens, authorization headers, proxy credentials, alias addresses, or
mailbox addresses in logs or issues. For support boundaries, see [SUPPORT.md](SUPPORT.md).

## Development

Requires Node.js 24.x and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for endpoint patterns, catalog generation, testing, and pull
request expectations. Live SimpleLogin smoke tests are manual and opt-in because they create a
temporary alias; use [docs/live-smoke-test.md](docs/live-smoke-test.md) and verify cleanup.

### Architecture

Endpoint support is split across constants, response schemas, the SimpleLogin client, and the tool
catalog and registrations. The shared request layer handles authentication, timeouts, error
normalization, and response validation. See [CONTRIBUTING.md](CONTRIBUTING.md) for the exact change
pattern and [How it works](https://simplelogin-mcp.com/guides/how-it-works/) for the runtime request
flow.

## Security

Treat `SL_API_KEY` like a password. Local stdio opens no listener. Streamable HTTP binds to
loopback by default and refuses normal unauthenticated non-loopback startup. Any LAN or public
deployment should keep `MCP_AUTH_TOKEN` enabled and terminate TLS at a reverse proxy.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Use [SUPPORT.md](SUPPORT.md) for
questions and non-security bugs.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT — see [LICENSE](LICENSE).
