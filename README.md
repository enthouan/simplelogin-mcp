# simplelogin-mcp

`simplelogin-mcp` is a self-hostable Model Context Protocol (MCP) server that exposes the SimpleLogin API as typed MCP tools for managing aliases, contacts, mailboxes, custom domains, settings, notifications, and exports. It supports local stdio transport and remote Streamable HTTP transport, and ships with Docker and GitHub Actions CI/CD configuration.

## Quick start with Docker Compose

```bash
cp .env.example .env
# Edit .env and set SL_API_KEY.
docker compose up --build -d
curl http://localhost:3000/health
```

The Compose file tags local builds as `ghcr.io/enthouan/simplelogin-mcp:latest` by default, matching the published-image format. Override `SIMPLELOGIN_MCP_IMAGE` if your fork publishes under a different GHCR owner/repository.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TRANSPORT` | No | `http` | Transport mode: `http` for Streamable HTTP or `stdio` for local MCP clients. |
| `PORT` | No | `3000` | HTTP listen port when `TRANSPORT=http`. |
| `MCP_AUTH_TOKEN` | No | unset | Optional bearer token required on `POST /mcp` when set. |
| `SL_API_URL` | No | `https://app.simplelogin.io` | SimpleLogin API base URL. Override for self-hosted SimpleLogin. |
| `SL_API_KEY` | Yes | unset | SimpleLogin API key sent in the `Authentication` header. |

## Docker images

The release workflow publishes multi-architecture images to GHCR as `ghcr.io/enthouan/simplelogin-mcp`. Pushes to `main` publish the `:main` tag. Version tags such as `v1.2.3` publish both `:v1.2.3` and `:latest`.

## Claude Desktop stdio configuration

```json
{
  "mcpServers": {
    "simplelogin": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--env-file", "/absolute/path/to/.env", "ghcr.io/enthouan/simplelogin-mcp:latest"],
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

For local development without Docker:

```json
{
  "mcpServers": {
    "simplelogin": {
      "command": "pnpm",
      "args": ["start"],
      "cwd": "/absolute/path/to/simplelogin-mcp",
      "env": {
        "TRANSPORT": "stdio",
        "SL_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Claude Code HTTP configuration

```json
{
  "mcpServers": {
    "simplelogin": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-mcp-auth-token"
      }
    }
  }
}
```

Omit `headers` if `MCP_AUTH_TOKEN` is not configured.

## Getting a SimpleLogin API key

Open SimpleLogin, go to your account settings/API key area, and create or copy an API key for this server. The key is passed to SimpleLogin as the `Authentication` header and should be treated like a password.

## Self-hosted SimpleLogin

Set `SL_API_URL` to your self-hosted SimpleLogin origin, for example:

```env
SL_API_URL=https://simplelogin.example.com
SL_API_KEY=your-api-key
```

## Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Exposed tool groups

- Aliases: list, get, random/custom creation, update, delete, toggle, contacts, activities, creation options, available domains.
- Mailboxes: list, create, update, delete.
- Custom domains: list, update, delete, deleted aliases.
- Contacts: create, delete, toggle block.
- Account/settings: user info, get settings, update settings.
- Notifications: list, mark read.
- Exports: full user data and aliases CSV.

## License

MIT. See [LICENSE](./LICENSE).

## Codex cloud environment scripts

Codex cloud environments do not automatically execute repository scripts just because they have a specific filename. Configure these commands in Codex environment settings so the scripts stay versioned in this repository while Codex still runs them in the documented setup phases:

- Setup script: `bash scripts/codex/setup.sh`
- Maintenance script: `bash scripts/codex/maintenance.sh`

The setup script is intended for newly created containers after the repository is cloned. The maintenance script is intended for cached containers after Codex checks out the task branch. Both scripts select Node.js 22 when `nvm` is available, activate `pnpm@10.28.1`, install dependencies while network access is available, and run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
