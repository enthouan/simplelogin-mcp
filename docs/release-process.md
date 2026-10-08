# Release Process

This is the public maintainer checklist for publishing `simplelogin-mcp`. The repository uses a
protected `main` branch, pull-request validation, semver tags, GitHub Releases, and GHCR images.
Stable release tags also publish the matching `server.json` to the official MCP Registry after the
tagged Docker image is published and verified.

The durable [image trust policy](registry-readiness.md#supply-chain-and-image-trust) requires every
future image published from `main` or a semver tag to carry explicit max-mode BuildKit SLSA
provenance and a native BuildKit SPDX SBOM. It does not generate a separate GitHub artifact
attestation or Cosign signature. Historical `v1.0.0` remains provenance-only and must not be
republished to backfill an SBOM.

## Release Inputs

Before preparing a release:

- Confirm the target milestone has no remaining required issues.
- Confirm the intended version number, for example `vX.Y.Z`.
- Review [CHANGELOG.md](../CHANGELOG.md) and make sure `## Unreleased` describes the changes that
  will ship.
- Fetch current repository state:

```bash
git fetch --all --tags --prune
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
- `server.json`: create or update the official MCP Registry manifest for the target version only;
  set the top-level version and GHCR image tag to `X.Y.Z` so the manifest points at the semver image
  produced by the release workflow. Omit the package-level `version` for OCI packages because the
  official Registry requires the version in the image identifier. Do not carry a root manifest for
  an older image that lacks the MCP ownership annotation.
- [registry/docker-mcp/server.yaml](../registry/docker-mcp/server.yaml): update the staged Docker
  MCP Registry image tag and source commit if preparing a public registry submission.

Run the local validation gate:

```bash
pnpm install --frozen-lockfile
pnpm test:workflow-pinning
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm website:check
pnpm format:check
pnpm pack --dry-run --json
SL_API_KEY=compose-validation docker compose --env-file .env.example config --no-env-resolution --quiet
SL_API_KEY=compose-validation docker compose --env-file .env.example -f docker-compose.local.yml config --no-env-resolution --quiet
SL_API_KEY=compose-validation docker compose --env-file .env.example -f docker-compose.local.yml build
actionlint .github/workflows/*.yml
git diff --check
```

Confirm that the publishing build in `.github/workflows/release.yml` still explicitly sets
`provenance: mode=max` and `sbom: true`. The workflow tests enforce that policy, but the workflow
must also be reviewed semantically for secrets passed as public build arguments. Max provenance
can disclose build-argument values; use BuildKit secret mounts for secrets.

Where Docker is available, validate attestation generation without publishing. Use the local
exporter because the pull-request workflow's `cacheonly` exporter creates no build output and
cannot prove that attestations were generated or persisted:

```bash
verify_local_image_trust() (
  set -e
  trust_output="$(mktemp -d)"
  trap 'rm -rf "$trust_output"' EXIT

  docker buildx build \
    --platform linux/amd64 \
    --provenance=mode=max \
    --sbom=true \
    --output "type=local,dest=$trust_output" \
    .

  test -s "$trust_output/provenance.json"
  test -s "$trust_output/sbom.spdx.json"
  jq -e '
    (.predicateType | startswith("https://slsa.dev/provenance/"))
    and (
      (.predicate.buildDefinition.internalParameters.buildConfig
        | type == "object" and length > 0)
      or (.predicate.buildConfig | type == "object" and length > 0)
    )
  ' \
    "$trust_output/provenance.json"
  jq -e '(.SPDXID // .predicate.SPDXID) == "SPDXRef-DOCUMENT"' \
    "$trust_output/sbom.spdx.json"
)

verify_local_image_trust
```

Review `provenance.json` for the expected BuildKit builder, source, and build parameters and confirm
that it contains no credential or sensitive build-argument value. The local exporter validates
the attestation content without pushing, but only post-publish registry inspection can prove that
the attestations are attached to the released multi-platform index.

Before a release candidate is approved, run a redacted full-history secret scan across every fetched
branch and tag with an approved Gitleaks binary. Do not silently substitute a current-tree scan:

```bash
gitleaks git --redact --log-opts="--all --full-history" .
```

Stop on a credible finding and report it privately without reproducing the secret value.

When official MCP Registry metadata changes, also validate `server.json` against the current MCP
Registry schema and inspect the live Registry. Earlier published versions are expected; the exact
target version must be absent or already active with identical metadata:

```bash
curl -fsSL https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json \
  -o /tmp/mcp-server.schema.json
pnpm dlx ajv-cli validate --strict=false -s /tmp/mcp-server.schema.json -d server.json
curl -fsSL 'https://registry.modelcontextprotocol.io/v0.1/servers?search=simplelogin'
curl -sS -i 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.enthouan%2Fsimplelogin-mcp/versions/X.Y.Z'
```

Open a pull request titled exactly `vX.Y.Z`. Include the validation commands and results in the PR
description. Do not push release metadata directly to `main`.

## Merge And Tag

Only after the owner explicitly approves merging that specific release PR and its required checks
pass, merge it through the protected-branch flow. Fetch the merged `main` commit before tagging:

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
The approved release/tag flow includes automatic official MCP Registry publication for that exact
version. It does not authorize changing an existing Registry entry, republishing a historical
image, or adding another registry or signing mechanism.

## GitHub Actions And GHCR

[.github/workflows/release.yml](../.github/workflows/release.yml) builds and publishes the Docker
image to GHCR on pushes to `main` and on semver tags matching `v*.*.*`.

Every image index produced by either trigger must have per-platform max-mode BuildKit SLSA
provenance and a native SPDX SBOM. These are native BuildKit attestation manifests, not a separate
GitHub artifact attestation or Cosign signature. Do not describe the images as separately signed.

Expected image tags:

- default-branch pushes: `latest` and `sha-<full-main-sha>`;
- semver tag pushes: `X.Y.Z`, `X.Y`, and `sha-<full-main-sha>`.

Watch the release workflow runs:

```bash
gh run list --repo enthouan/simplelogin-mcp --limit 10 \
  --json databaseId,name,headBranch,headSha,status,conclusion,event,createdAt,url
gh run watch <run-id> --repo enthouan/simplelogin-mcp --exit-status
```

Verify the published images before announcing the release. The helper prints the immutable index
digest and both platform-manifest digests, checks the MCP ownership annotation, and fails when
either platform lacks provenance or an SPDX SBOM:

```bash
verify_image_trust() (
  set -euo pipefail
  image_ref="$1"
  manifest_output="$(mktemp -d)"
  trap 'rm -rf "$manifest_output"' EXIT
  manifest_file="$manifest_output/index.json"

  docker buildx imagetools inspect "$image_ref" --raw > "$manifest_file"
  index_digest="sha256:$(openssl dgst -sha256 -r "$manifest_file" | awk '{print $1}')"
  pinned_image="${image_ref%@*}@$index_digest"
  printf '%s\n' "$index_digest" | grep -Eq '^sha256:[0-9a-f]{64}$'
  printf '%s\n' "$index_digest"
  jq -e '
    .annotations["io.modelcontextprotocol.server.name"]
      == "io.github.enthouan/simplelogin-mcp"
  ' "$manifest_file"
  jq -e '
    [.manifests[]
      | select(.platform.os == "linux")
      | select(.platform.architecture == "amd64" or .platform.architecture == "arm64")]
    | length == 2
  ' "$manifest_file"
  jq -r '
    .manifests[]
    | select(.platform.os == "linux")
    | select(.platform.architecture == "amd64" or .platform.architecture == "arm64")
    | [.platform.os + "/" + .platform.architecture, .digest]
    | @tsv
  ' "$manifest_file"

  for platform in linux/amd64 linux/arm64; do
    docker buildx imagetools inspect "$pinned_image" \
      --format "{{json (index .Provenance \"$platform\").SLSA}}" \
      | jq -e '
        type == "object" and length > 0
        and (
          (.buildDefinition.internalParameters.buildConfig
            | type == "object" and length > 0)
          or (.buildConfig | type == "object" and length > 0)
        )
      '
    docker buildx imagetools inspect "$pinned_image" \
      --format "{{json (index .SBOM \"$platform\").SPDX}}" \
      | jq -e '
        .SPDXID == "SPDXRef-DOCUMENT"
        and (.spdxVersion | startswith("SPDX-"))
      '
  done
)

verify_image_trust ghcr.io/enthouan/simplelogin-mcp:latest
verify_image_trust ghcr.io/enthouan/simplelogin-mcp:X.Y.Z
verify_image_trust ghcr.io/enthouan/simplelogin-mcp:X.Y
verify_image_trust ghcr.io/enthouan/simplelogin-mcp:sha-<full-main-sha>
```

Run the check only after both the `main` and semver-tag workflows have completed successfully. The
`latest` check covers the default-branch publication; `X.Y.Z` and `X.Y` cover the tag publication;
the immutable `sha-<full-main-sha>` tag ties the evidence back to the source commit. Record the
resolved index digest and the two platform digests in the release evidence.

BuildKit scans the final image stage for the native SBOM by default. Packages used only in earlier
builder stages are not included unless those stages explicitly opt in with
`BUILDKIT_SBOM_SCAN_STAGE`; do not treat the SBOM as a complete build-time dependency inventory.
Provenance and an SBOM provide evidence, not proof that an image is secure. A missing separate
GitHub/Cosign signature is not a release failure under the selected policy. Revisit keyless signing
only for the concrete triggers documented in the image trust policy, and obtain approval before
adding signing-related OIDC or attestation permissions. The separate Registry job's OIDC permission
authenticates metadata publication only; it does not sign images.

## Official MCP Registry Publication

The Registry job in [.github/workflows/release.yml](../.github/workflows/release.yml) depends on a
successful Docker job and runs only for stable `vX.Y.Z` tag pushes in
`enthouan/simplelogin-mcp`. It does not publish on `main`, pull requests, forks, prerelease tags, or
a manual dispatch. The tag, `package.json` version, `server.json` version, and OCI image identifier
must agree exactly; the workflow validates committed metadata instead of rewriting it at runtime.

Before publication, the job:

1. Installs a pinned, SHA-256-verified official `mcp-publisher` release.
2. Reads the exact Registry version. An existing active entry with identical `server.json`
   metadata is a successful no-op: authentication and publication are skipped. Conflicting
   metadata, an inactive entry, or an unsuccessful/ambiguous Registry read stops the job.
3. For an absent version, checks the semver image anonymously, ties its digest to the successful
   Docker job's output, verifies ownership, both platforms, max provenance and SPDX SBOMs, and
   runs the official publisher's manifest validation before authenticating to the Registry.
4. If that exact version is absent, authenticates with `mcp-publisher login github-oidc` and makes
   one publication attempt, then reads the exact version back and verifies active status and
   identical metadata. Read-back checks may retry; publication must never retry blindly.
5. Removes temporary publisher credentials even when a step fails.

Only this job receives `contents: read` and `id-token: write`; it has no package-write or
attestation-write permission. GitHub's short-lived OIDC identity replaces a stored Registry secret,
PAT, or interactive device login, following the
[official GitHub Actions publishing guidance](https://modelcontextprotocol.io/registry/github-actions).

Record the exact-version Registry URL and immutable image digest with the release evidence. Check
the exact published version, not only `/versions/latest`: a delayed older release can be valid
without `isLatest: true`, because the Registry orders semantic versions. Registry metadata is
[immutable once published](https://modelcontextprotocol.io/registry/versioning), so a correction
requires a new approved version; do not try to overwrite an entry. Publication keeps the catalog
current but does not upgrade users' installed servers.

### Recovering A Failed Registry Job

If the Docker job succeeded but Registry publication failed, inspect the exact-version API entry
and the failed job's logs before retrying. A lost publisher response can still mean publication
succeeded. Re-run **only the failed Registry job** after a transient failure; its preflight treats
an already active, identical entry as success without publishing again. Do not re-run the successful
Docker job or the entire workflow to repair Registry publication: rebuilding could move the
released image tag to a different digest.

Stop on metadata conflicts, inactive entries, changed image digests, or unresolved authentication
errors. Workflow or metadata corrections require the normal PR/release path; do not move the old
tag to pick up a fix. Any exceptional manual publication needs separate owner approval for its
exact payload and version. Leave the existing `1.0.2` image, tag, release, and Registry entry
unchanged; automation begins with a future approved release tag containing this workflow.

## GitHub Release

Create the GitHub Release after the tag workflow, GHCR image checks, and exact-version Registry
verification pass. Use title `vX.Y.Z` and release notes from that version's changelog section:

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

Close the milestone only after the release, tag workflow, GHCR images, and exact-version official
MCP Registry entry are verified:

```bash
gh api repos/enthouan/simplelogin-mcp/milestones --paginate \
  --jq '.[] | select(.title == "simplelogin-mcp X.Y")'
gh api -X PATCH repos/enthouan/simplelogin-mcp/milestones/<number> -f state=closed
```

Leave the milestone open if any required release artifact is missing or if follow-up release work is
still needed.
