# Security

`simplelogin-mcp` brokers full programmatic access to a SimpleLogin account. This
document explains the credentials involved, the network exposure model, and how to
report a vulnerability.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for anything
exploitable.

- Preferred when available: open a private advisory via the repository's **Security → Report a
  vulnerability** tab (GitHub private vulnerability reporting). If that action is not visible, do
  not publish the report or its details in an issue or discussion.
- Include the version (or commit), your configuration (transport, `HOST`, whether
  `MCP_AUTH_TOKEN` is set), and reproduction steps.

Please give a reasonable window to respond before any public disclosure. Never include
a live `SL_API_KEY` or `MCP_AUTH_TOKEN` in a report.

## Credential risk model

Two distinct secrets are involved, and they are unrelated:

| Secret           | Authenticates             | Scope of compromise                                                                                                    |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SL_API_KEY`     | this server → SimpleLogin | **Full control of the SimpleLogin account**: list/create/update/delete aliases, read mailbox routing, change settings. |
| `MCP_AUTH_TOKEN` | MCP clients → this server | Ability to call this server's tools (and therefore to use the `SL_API_KEY` behind it).                                 |

### `SL_API_KEY`: treat it like a password

The SimpleLogin API key is a bearer credential sent as the `Authentication` header on
every outbound API call. Anyone who obtains it can manage your aliases and mailboxes
directly against SimpleLogin, without going through this server at all.

- Scope it down: create a dedicated API key for this server (SimpleLogin → Settings →
  API Keys) rather than reusing one. Revoke it there if it leaks.
- Never commit it. `.env` is git-ignored; keep it that way. The bundled Compose
  files explicitly map it from `.env`; production deployments can use the same
  contract or a secrets manager. Never bake it into the image.
- It is never written to logs or returned in error output (see Logging below).

### `MCP_AUTH_TOKEN`: gate to this server

If set, `POST /mcp` requires `Authorization: Bearer <token>`; the comparison is
constant-time. Anyone with this token can drive every tool, which means they can use
your `SL_API_KEY` indirectly. Generate a strong, random value:

```bash
openssl rand -hex 32
```

A leaked `MCP_AUTH_TOKEN` is contained by rotating it (restart with a new value); a
leaked `SL_API_KEY` must be revoked at SimpleLogin.

## Network exposure model

The server is **safe by default**: a fresh HTTP deployment binds loopback only and is
reachable solely from the local machine. Exposing it more widely is always an explicit,
deliberate step.

### Binding (`HOST`)

| `HOST`                | Reachable from    | Requirement                                                     |
| --------------------- | ----------------- | --------------------------------------------------------------- |
| `127.0.0.1` (default) | this machine only | none                                                            |
| `0.0.0.0` / a LAN IP  | LAN / internet    | `MCP_AUTH_TOKEN` set (or `ALLOW_UNAUTHENTICATED_EXPOSURE=true`) |

The server **refuses to start** if it is bound to a non-loopback address with no
`MCP_AUTH_TOKEN` set. This prevents an accidental `HOST=0.0.0.0` from publishing full
account control to the network with no credential. To bind publicly you must either set
a token or explicitly opt out with `ALLOW_UNAUTHENTICATED_EXPOSURE=true`, and only do
the latter when exposure is already contained at another layer (see below).

### Browser origin validation

`POST /mcp` rejects requests carrying a disallowed `Origin` header (HTTP 403). This
defends a loopback-bound server against DNS-rebinding and CSRF from a malicious web page
the user happens to visit: browsers always send an `Origin`, and an attacker page's
origin will not match. Loopback origins (`localhost` / `127.0.0.1`, any port) are
allowed so local tooling keeps working; add others with `MCP_ALLOWED_ORIGINS`.
Non-browser MCP clients send no `Origin` and are unaffected.

### Recommended deployment patterns

- **Local use (default):** keep `HOST=127.0.0.1`. Reach it from the same machine, or
  from elsewhere over an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 host`). No token
  strictly required, though setting one adds defense in depth.
- **Docker:** the bundled Compose files bind the container to `0.0.0.0` (required
  for Docker port forwarding) but publish only to the host's loopback by default
  (`127.0.0.1:3000:3000`), so they are host-local by default. Because the app sees a
  non-loopback bind inside the container, keep `MCP_AUTH_TOKEN` set even for default
  Compose deployments. To reach it from the LAN, keep the token set and set
  `SIMPLELOGIN_MCP_HOST_BIND_IP=0.0.0.0` or a specific LAN IP.
- **Public / LAN exposure:** set `MCP_AUTH_TOKEN`, and put the server behind a reverse
  proxy that terminates TLS (the server speaks plain HTTP). Never expose plain HTTP with
  a bearer token directly to the internet: the token would travel in cleartext.

## Logging and error output

- All diagnostics go to **stderr** (stdout is reserved for the MCP stdio stream).
- Secrets are never logged. API failures log only sanitized structured metadata such as endpoint,
  method, HTTP status/status text, response-body type, and `Retry-After`; neither `SL_API_KEY` nor
  `MCP_AUTH_TOKEN` appears in logs or in tool error messages returned to clients.
- Error results surface the SimpleLogin status/endpoint/message and validation detail,
  not request headers or credentials.

## Supported versions

This project is pre-1.0; security fixes land on the latest release. Track the
[CHANGELOG](CHANGELOG.md) and run a current version.
