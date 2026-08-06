---
name: simplelogin-mcp-release
description: Release workflow for enthouan/simplelogin-mcp. Use when preparing, reviewing, tagging, publishing, or verifying a simplelogin-mcp version release, including version/changelog updates, protected-branch PR flow, GitHub Release creation, GHCR image verification, milestone closure, and release-readiness checks.
---

# simplelogin-mcp Release

Use this skill to release `enthouan/simplelogin-mcp` without skipping protected-branch, version,
tag, GitHub Release, GHCR, or roadmap housekeeping steps.

## Release Rules

- Never push directly to `main`; the branch is protected. Use a PR and wait for the required
  `check` status.
- Never merge a PR unless the user explicitly approves merging that specific PR. Passing checks,
  GitHub review approval, or a release request is not enough by itself.
- The release PR merge approval is the only normal approval boundary. After the approved release PR
  is merged, continue through tag push, workflow/GHCR verification, GitHub Release creation, and
  milestone closure for that exact version without asking for a second publish approval.
- Use branch names like `release-v0.3.0`; the branch name intentionally includes `v` to match
  the tag and PR title.
- Use the PR title and squash commit subject `vX.Y.Z`, with no `release` suffix. GitHub can derive
  the squash commit subject from the PR title, so the PR title must not be `Prepare vX.Y.Z release`.
- Tag only after the release PR is merged to `main`, and tag the fetched `origin/main` merge commit.
- Use annotated tags with the message exactly `vX.Y.Z`.
- Do not rewrite `main`, force-push, delete/move a published tag, or replace a GitHub Release
  without explicit user approval.
- If a bad commit subject is already merged and tagged, explain that fixing it requires rewriting
  protected `main` and moving the tag; do not attempt that by default.

## Readiness Audit

Start from current live state:

```bash
git fetch --all --tags --prune
git status --short --branch
git log --oneline --decorate -n 10 origin/main
gh issue list --repo enthouan/simplelogin-mcp --state all --limit 200 \
  --json number,title,state,milestone,projectItems,url
gh api repos/enthouan/simplelogin-mcp/milestones --paginate \
  --jq '.[] | {number,title,state,open_issues,closed_issues,description}'
gh pr list --repo enthouan/simplelogin-mcp --state open --json number,title,url,isDraft
gh run list --repo enthouan/simplelogin-mcp --branch main --limit 10 \
  --json databaseId,name,headSha,status,conclusion,createdAt,url
```

Confirm the target milestone has no open issues and project items are Done. Check current releases:

```bash
gh release list --repo enthouan/simplelogin-mcp --limit 20
git tag --sort=-v:refname | head -20
```

## Version Prep

For `vX.Y.Z`, update only release metadata unless the requested release needs other changes:

- `package.json`: set `"version": "X.Y.Z"`.
- `CHANGELOG.md`: promote `## Unreleased` to `## vX.Y.Z`.
- `README.md`: update the `/health` example to `X.Y.Z`.
- `src/version.ts`: update any version example comment if it would otherwise look stale.
- `server.json`: create or update the official MCP Registry manifest for `X.Y.Z`, keeping
  `name` as `io.github.enthouan/simplelogin-mcp` and pointing the OCI package identifier at
  `ghcr.io/enthouan/simplelogin-mcp:X.Y.Z`. Do not point a root manifest at an older image that
  lacks `io.modelcontextprotocol.server.name`.

The runtime version comes from `package.json`, so always smoke-test the compiled server before
tagging.

## Validation

Run the full local gate before opening or merging the release PR:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm format:check
test -f .env || cp .env.example .env
SL_API_KEY=compose-validation docker compose --env-file .env.example config --no-env-resolution --quiet
SL_API_KEY=compose-validation docker compose --env-file .env.example -f docker-compose.local.yml config --no-env-resolution --quiet
curl -fsSL https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json \
  -o /tmp/mcp-server.schema.json
pnpm dlx ajv-cli validate --strict=false -s /tmp/mcp-server.schema.json -d server.json
```

If local `pnpm test` fails with a Rolldown native binding/code-signing error on macOS, rerun through
the bundled Codex Node runtime before treating it as a repo failure:

```bash
PATH=/Users/enthouan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /opt/homebrew/bin/pnpm test
```

Smoke-test the compiled runtime:

```bash
SL_API_KEY=sl-test TRANSPORT=http HOST=127.0.0.1 PORT=34712 node dist/index.js &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT

for _ in 1 2 3 4 5; do
  curl -fsS http://127.0.0.1:34712/health && break
  sleep 1
done
curl -fsS http://127.0.0.1:34712/health | grep "\"version\":\"X.Y.Z\""

kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
trap - EXIT

SL_API_KEY=sl-test TRANSPORT=http HOST=0.0.0.0 PORT=34713 node dist/index.js &
guard_pid=$!
sleep 2
if kill -0 "$guard_pid" 2>/dev/null; then
  kill "$guard_pid"
  wait "$guard_pid" 2>/dev/null || true
  echo "expected non-loopback exposure refusal" >&2
  exit 1
fi
wait "$guard_pid" || true
```

Expected results:

- `/health` reports the target version.
- `HOST=0.0.0.0` without `MCP_AUTH_TOKEN` exits with the non-loopback exposure refusal.
- Stop the temporary loopback server and verify the port is free before continuing.

## PR Path

Create the release branch from fetched `origin/main`:

```bash
git switch --detach origin/main
git switch -c release-vX.Y.Z
git add CHANGELOG.md README.md package.json src/version.ts server.json registry/docker-mcp/server.yaml
git commit -m "vX.Y.Z"
git push -u origin HEAD
```

Open the PR with:

- title: `vX.Y.Z`
- milestone: target milestone, for example `simplelogin-mcp 0.3`
- labels: `codex`, `documentation`, `area:docs`, and `area:docker`
- project: add to the `simplelogin-mcp` GitHub Project
- validation: list portable commands only, without machine-local PATH prefixes unless needed to
  explain the Rolldown workaround

Wait for PR checks, then report the result and stop unless the user explicitly approves merging
that PR:

```bash
gh pr checks <pr-number> --repo enthouan/simplelogin-mcp --watch
```

Only after the user explicitly approves merging the specific PR and checks pass, merge through the
protected-branch path:

```bash
gh pr ready <pr-number> --repo enthouan/simplelogin-mcp
gh pr merge <pr-number> --repo enthouan/simplelogin-mcp --squash --delete-branch \
  --subject "vX.Y.Z"
```

Verify the merged PR is Done in the project before tagging.

After the merge, verify the main-branch state, then continue directly to
Tag And Publish. Do not pause for a second approval before pushing the release
tag, creating the GitHub Release, or closing the milestone.

## Tag And Publish

Run this immediately after the approved release PR is merged and the merged PR
is verified as Done in the project. The prior merge approval covers the normal
release-side effects for the exact `vX.Y.Z`: tag push, GHCR publish
verification, GitHub Release creation, and milestone closure.

Stop and ask for explicit approval only when a corrective action would rewrite
history or replace published release state, such as moving/deleting a tag,
force-pushing, rewriting `main`, or replacing an existing GitHub Release.

Fetch the merged main commit and ensure the tag does not already exist:

```bash
git fetch origin main --tags --prune
git show origin/main:package.json | sed -n '1,8p'
git show origin/main:CHANGELOG.md | sed -n '1,40p'
git tag --list "vX.Y.Z"
```

Create and push the tag:

```bash
git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
git push origin vX.Y.Z
```

Watch release workflows for both the merged `main` push and the tag push. The
main workflow publishes `latest` and `sha-<full-main-sha>`; the tag workflow
publishes `X.Y.Z`, moving minor `X.Y`, and `sha-<full-main-sha>`.

```bash
gh run list --repo enthouan/simplelogin-mcp --limit 10 \
  --json databaseId,name,headBranch,headSha,status,conclusion,event,createdAt,url
gh run watch <main-release-run-id> --repo enthouan/simplelogin-mcp --exit-status
gh run watch <tag-release-run-id> --repo enthouan/simplelogin-mcp --exit-status
```

Verify image tags before creating the GitHub Release:

```bash
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:X.Y.Z
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:X.Y
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:sha-<full-main-sha>
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:X.Y.Z \
  | grep 'io.modelcontextprotocol.server.name'
```

Create the GitHub Release after the tag workflow and GHCR image checks pass.
Use the title `vX.Y.Z` exactly, without `release` or any other suffix. Use the
changelog section as notes.

```bash
version=X.Y.Z
gh release create "v${version}" --repo enthouan/simplelogin-mcp --title "v${version}" \
  --notes "$(git show origin/main:CHANGELOG.md | awk -v "tag=v${version}" '$0 == "## " tag {p=1; next} /^## v/ && p {p=0} p {print}')"
```

## Final Verification

Verify release, image tags, milestone, and worktree state:

```bash
gh release view vX.Y.Z --repo enthouan/simplelogin-mcp \
  --json tagName,name,isDraft,isPrerelease,publishedAt,url
gh api repos/enthouan/simplelogin-mcp/milestones --paginate \
  --jq '.[] | select(.title == "simplelogin-mcp X.Y")'
git status --short --branch
```

Close the milestone after the release and image publish are verified:

```bash
gh api -X PATCH repos/enthouan/simplelogin-mcp/milestones/<number> -f state=closed
```

Report the PR URL, merge SHA, release URL, GHCR digest, validation commands, and any warnings. Note
the known GitHub Actions Node.js 20 deprecation warning if the Docker actions still emit it.
