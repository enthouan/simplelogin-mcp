# Live SimpleLogin smoke test

The live smoke test is a manual maintainer workflow. It uses the MCP SDK client transports, so it
exercises this MCP server and its tool handlers instead of calling the SimpleLogin API directly.
It is not part of `pnpm test` or normal CI.

## Environment

Required for stdio and `all` transports:

- `SL_API_KEY`: SimpleLogin API key used by the server. It is never printed in smoke output.

HTTP-only smoke connects to an already running MCP server and does not require `SL_API_KEY` in the
smoke process. The target server must already have been started with its own `SL_API_KEY`.

Optional:

- `SL_API_URL`: SimpleLogin base URL, for self-hosted instances. The stdio smoke runner passes it
  to the spawned server; for HTTP, start the HTTP server with the same value.
- `MCP_AUTH_TOKEN`: bearer token for an HTTP server that requires `Authorization`.
- `SMOKE_TRANSPORT`: `stdio`, `http`, or `all`. Defaults to `stdio`.
- `SMOKE_HTTP_URL`: MCP endpoint for HTTP mode. Defaults to `http://127.0.0.1:3000/mcp`.
- `SMOKE_CONTACT`: `create` or `skip`. Defaults to `create`. Missing contact tools and impossible
  `existed: true` responses fail the smoke when contact coverage is requested; premium/API
  limitations are reported as a contact skip, not as a failed alias smoke.
- `SMOKE_STEP_TIMEOUT_MS`: MCP request timeout for each step. Defaults to `60000`.
- `SMOKE_MAX_LOOKUP_PAGES`: contact read-back/cleanup verification page bound. Defaults to `5`.
- `SMOKE_STDIO_SERVER`: built server entry for stdio mode. Defaults to `dist/index.js`.
- `SMOKE_PRIVATE_RECOVERY_FILE`: optional path for a new mode-`0600` private recovery record when a
  run fails. The runner refuses to overwrite an existing file. Keep it outside the repository and
  delete it after any required manual cleanup.

## Stdio

Stdio mode is self-contained: `pnpm smoke:live` builds the server, spawns `node dist/index.js` with
`TRANSPORT=stdio`, runs the smoke sequence, and closes the child process.

Put `SL_API_KEY` in the ignored `.env` file, then load it only for the smoke process:

```bash
(
  set -a
  . ./.env
  set +a
  pnpm smoke:live -- --transport stdio
)
```

For a self-hosted SimpleLogin instance:

Set `SL_API_URL` in the same ignored `.env` file, then use the command above.

## HTTP

HTTP mode connects to an already running MCP HTTP server at `/mcp`.

Start the server in one terminal:

```bash
(
  set -a
  . ./.env
  set +a
  TRANSPORT=http HOST=127.0.0.1 PORT=3000 pnpm dev
)
```

Run the smoke test in another:

```bash
(
  set -a
  . ./.env
  set +a
  pnpm smoke:live -- --transport http --http-url http://127.0.0.1:3000/mcp
)
```

If the HTTP server has `MCP_AUTH_TOKEN` set, keep the same value in the ignored `.env`. The runner
sends it as `Authorization: Bearer ...` and redacts it from all output.

## What It Does

For each selected transport, the smoke runner:

1. Lists MCP tools and verifies the complete 27-tool catalog in its canonical order.
2. Calls `account_get_info` to verify the configured SimpleLogin credentials.
3. Calls `alias_list` with `page_id: 0` as a bounded read.
4. Creates a random temporary alias with a note containing a unique run id.
5. Reads the alias back with `alias_get`.
6. Optionally creates a temporary contact on that alias, then reads it back with `contact_list`.
7. Deletes the contact, then the alias, in `finally`.
8. Verifies cleanup with read-after-delete checks.

Temporary naming is intentionally recognizable:

- Run id: `slmcp-smoke-<UTC timestamp>-<random hex>`
- Alias note: `simplelogin-mcp live smoke test <run id>; temporary alias; safe to delete`
- Alias hostname: `simplelogin-mcp-smoke.invalid`
- Contact: `SimpleLogin MCP Smoke <run id> <<run id>@example.com>`

Cleanup only runs for alias/contact ids created during the current smoke run. The runner does not
mutate existing aliases, mailboxes, custom domains, account settings, or notifications, and it does
not retry mutating calls automatically.

If `alias_create_random` fails after SimpleLogin may already have created an alias, the runner makes
a bounded `alias_list` lookup for the current run id and only recovers the alias for cleanup when the
alias note contains that run id.

The contact path uses the same ownership rule: a returned contact id is only eligible for cleanup
after `contact_list` confirms the contact value contains the current run id. If `contact_create`
fails after SimpleLogin may already have created the contact, the runner makes a bounded
`contact_list` lookup on the temporary alias and only recovers contacts matching the run id.

On the first `SIGINT` or `SIGTERM`, the CLI asks the active smoke run to stop before later mutating
steps, waits for cleanup, and exits with the conventional signal exit code. A second interrupt may
still force the process down immediately.

## Retaining Safe Evidence

The CLI prints a deliberately limited evidence record: transport, overall status, the exact
tool-discovery count/match, step names and statuses, contact attempted/skipped state, and cleanup
statuses. It omits run ids, artifact fields, cleanup ids and errors, account responses, addresses,
contact values, and failure messages. A successful release-candidate contact check requires
`attempted: true`, `skipped: false`, and successful contact and alias cleanup; a premium/API skip
does not satisfy that criterion.

The in-process runner retains temporary artifact details only long enough to verify ownership and
cleanup. For a release-candidate run, set `SMOKE_PRIVATE_RECOVERY_FILE` to a new path in a
permission-restricted temporary directory. No recovery file is created on success. On failure, it
contains only the transport, run id, temporary artifact ids, and cleanup statuses needed for manual
recovery. Never publish that file; delete it after cleanup is verified.

## Reading Failures

On failure, review the sanitized CLI evidence and, when created, the private recovery record:

- `transport`: `stdio` or `http`.
- `failure.step` and `failure.tool`: where the failure happened.
- `cleanup`: separate status for alias and contact cleanup.

If cleanup status is `delete_failed` or `verification_failed`, manually inspect the exact artifact
id from the private recovery record in SimpleLogin before rerunning. Keep the artifact id and run id
private; publish only the affected artifact type, cleanup status, and whether manual cleanup was
verified, then delete the recovery record.
