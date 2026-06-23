# Release Process

This is the public maintainer checklist for publishing `simplelogin-mcp`. The repository uses a
protected `main` branch, pull-request validation, semver tags, GitHub Releases, and GHCR images.

## Release Inputs

Before preparing a release:

- Confirm the target milestone has no remaining required issues.
- Confirm the intended version number, for example `v0.7.0`.
- Review [CHANGELOG.md](../CHANGELOG.md) and make sure `## Unreleased` describes the changes that
  will ship.
- Fetch current repository state:

```bash
git fetch origin --tags --prune
git status --short --branch
gh issue list --repo enthouan/simplelogin-mcp --state all --limit 200 \
  --json number,title,state,milestone,url
gh release list --repo enthouan/simplelogin-mcp --limit 20
```

## Prepare The Release Pull Request

Create the release branch from fetched `origin/main`:

```bash
git switch --detach origin/main
git switch -c release-vX.Y.Z
```

Update release metadata:

- [package.json](../package.json): set `"version"` to `X.Y.Z`.
- [CHANGELOG.md](../CHANGELOG.md): promote `## Unreleased` to `## vX.Y.Z` and restore a fresh
  `## Unreleased` section if needed.
- [README.md](../README.md): update versioned examples such as `/health` output and pinned GHCR
  image tags when they should point at the new release.
- [server.json](../server.json): update the top-level version, OCI package version, and GHCR image
  tag to `X.Y.Z`; keep the registry server name unchanged.
- [registry/docker-mcp/server.yaml](../registry/docker-mcp/server.yaml): update the staged Docker
  MCP Registry image tag and source commit if preparing a public registry submission.

Run the local validation gate:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm format:check
docker compose config
docker compose -f docker-compose.local.yml config
```

When registry metadata changes, also validate `server.json` against the current MCP Registry schema
and confirm the official registry still has no stale entry for this server before publication:

```bash
curl -fsSL https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json \
  -o /tmp/mcp-server.schema.json
pnpm dlx ajv-cli validate -s /tmp/mcp-server.schema.json -d server.json
curl -fsSL 'https://registry.modelcontextprotocol.io/v0.1/servers?search=simplelogin'
```

Open a pull request titled exactly `vX.Y.Z`. Include the validation commands and results in the PR
description. Do not push release metadata directly to `main`.

## Merge And Tag

After the release PR is approved and required checks pass, merge it through the protected-branch
flow. Fetch the merged `main` commit before tagging:

```bash
git fetch origin main --tags --prune
git show origin/main:package.json | sed -n '1,12p'
git show origin/main:CHANGELOG.md | sed -n '1,80p'
git tag --list "vX.Y.Z"
```

Create an annotated semver tag on the fetched `origin/main` commit and push it:

```bash
git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
git push origin vX.Y.Z
```

Do not move or replace a published tag without an explicit corrective-release decision.

## GitHub Actions And GHCR

[.github/workflows/release.yml](../.github/workflows/release.yml) builds and publishes the Docker
image to GHCR on pushes to `main` and on semver tags matching `v*.*.*`.

Expected image tags:

- default-branch pushes: `latest` and `sha-<full-main-sha>`;
- semver tag pushes: `X.Y.Z`, `X.Y`, and `sha-<full-main-sha>`.

Watch the release workflow runs:

```bash
gh run list --repo enthouan/simplelogin-mcp --limit 10 \
  --json databaseId,name,headBranch,headSha,status,conclusion,event,createdAt,url
gh run watch <run-id> --repo enthouan/simplelogin-mcp --exit-status
```

Verify the published images before announcing the release:

```bash
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:X.Y.Z
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:X.Y
docker buildx imagetools inspect ghcr.io/enthouan/simplelogin-mcp:sha-<full-main-sha>
```

## GitHub Release

Create the GitHub Release after the tag workflow and GHCR image checks pass. Use title `vX.Y.Z`
and release notes from that version's changelog section:

```bash
version=X.Y.Z
gh release create "v${version}" --repo enthouan/simplelogin-mcp --title "v${version}" \
  --notes "$(git show origin/main:CHANGELOG.md | awk -v "tag=v${version}" '$0 == "## " tag {p=1; next} /^## v/ && p {p=0} p {print}')"
```

Verify the release object:

```bash
gh release view vX.Y.Z --repo enthouan/simplelogin-mcp \
  --json tagName,name,isDraft,isPrerelease,publishedAt,url
```

## Milestone Closure

Close the milestone only after the release, tag workflow, and GHCR images are verified:

```bash
gh api repos/enthouan/simplelogin-mcp/milestones --paginate \
  --jq '.[] | select(.title == "simplelogin-mcp X.Y")'
gh api -X PATCH repos/enthouan/simplelogin-mcp/milestones/<number> -f state=closed
```

Leave the milestone open if any required release artifact is missing or if follow-up release work is
still needed.
