# Registry Readiness

This document records the durable controls for publishing `simplelogin-mcp` to public MCP
registries. The approved stable release/tag flow includes automatic official MCP Registry
publication for that exact version. Exceptional manual publication, a Docker MCP Registry pull
request, Glama ownership, or new registry credentials still requires explicit owner approval for
that specific external action.

## Public Baseline

- The GitHub repository is public, so registry reviewers can inspect the source and documentation.
- `https://simplelogin-mcp.com/` and its favicon are public HTTPS endpoints served with HSTS.
- The GHCR package is public. Published release images are anonymously pullable and multi-platform;
  each target release tag must still be verified independently before matching registry metadata is
  published.
- GitHub Actions references are pinned to immutable commits and checked in CI. CodeQL, secret
  scanning, push protection, and Dependabot provide repository-level checks; point-in-time alert
  counts belong in release evidence rather than this document.
- Release validation includes a fresh, redacted, full-history Gitleaks scan across fetched branches
  and tags.
- The registry server name is `io.github.enthouan/simplelogin-mcp`.
- Local readiness drift checks are covered by `test/registry.test.ts`.

## Official MCP Registry

Metadata invariants:

- [x] Server name uses the GitHub-authenticated namespace `io.github.enthouan/simplelogin-mcp`.
- [x] Docker image metadata includes `io.modelcontextprotocol.server.name` in the Dockerfile,
      release workflow, and CI dry-run workflow.
- [x] Keep root `server.json` on the current official schema and update it during the release path
      for the target semver image.
- [x] Use package type `oci` with the GHCR distribution path.
- [x] Pin the package identifier to the target semver image tag; do not use `latest` or a version
      range.
- [x] Omit the package-level `version` for OCI packages; the official Registry requires the version
      in the image identifier instead.
- [x] Represent stdio execution with `transport.type=stdio` and `TRANSPORT=stdio`.
- [x] Mark `SL_API_KEY` required and secret without a committed value.

As checked against the official
[OCI package-type documentation](https://modelcontextprotocol.io/registry/package-types),
[publishing quickstart](https://modelcontextprotocol.io/registry/quickstart), and
[2025-12-11 schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)
on 2026-08-23, the official registry requires the OCI package metadata and matching MCP image
annotation above. It does not require provenance, an SBOM, or a separate image signature. These
trust artifacts are project policy, not a registry listing prerequisite.

### Automated Stable Releases

The Registry job in [.github/workflows/release.yml](../.github/workflows/release.yml) runs after
successful tagged Docker publication, only in `enthouan/simplelogin-mcp` and only for strict stable
`vX.Y.Z` tags. It does not run on `main`, pull requests, forks, prereleases, or a manual trigger.
The tag, `package.json`, `server.json`, and semver OCI identifier must agree before publication.
Do not rewrite manifest versions at runtime to conceal release-metadata drift.
Before either publishing job starts, a read-only `release-policy` job fetches `main` and requires
every release-tag commit to be reachable from it. Older merged commits are valid; off-main commits
fail before the Docker or OIDC-enabled Registry jobs can run.

The job uses a pinned, SHA-256-verified official publisher, runs its validation command, and
anonymously verifies the image digest and MCP ownership metadata against the completed Docker
job. Release verification also checks `linux/amd64` and `linux/arm64` manifests, max-mode provenance,
SPDX SBOMs, and the public repository, website, favicon, and signed-out GHCR package page.

Authentication uses GitHub Actions OIDC with `mcp-publisher login github-oidc`, as recommended by
the [official automation guide](https://modelcontextprotocol.io/registry/github-actions). Only the
Registry job receives `contents: read` and `id-token: write`; it has no package-write or
attestation-write permission and requires no Registry secret, PAT, or device login. Temporary
publisher credentials are removed on success or failure. This OIDC use authenticates Registry
publication; it does not add image signing.

Before authentication, the job checks the exact version in the live Registry:

- An active entry whose `server` payload equals committed `server.json` is already complete:
  still verify the public image against the Docker job digest and trust policy, then skip login
  and publication. An identical manifest cannot excuse image drift or missing attestations.
- A conflicting payload, inactive entry, or failed/ambiguous read fails closed.
- An absent exact version permits one publication attempt, followed by exact-version read-back
  verification of active status and identical metadata. Retry reads when necessary, never the
  publication blindly.

Record the verified exact-version URL and immutable image digest on the release-control issue.
Do not require `isLatest: true` for a delayed older release: semantic versions determine latest.
The Registry's [versioning rules](https://modelcontextprotocol.io/registry/versioning) make
published metadata immutable, so corrections need a new approved version. Existing entries do not
need periodic republication, and updating the catalog does not upgrade users' installations.

If only Registry publication fails, inspect its logs and exact-version endpoint, then re-run only
the failed Registry job. Its preflight safely recognizes an identical successful publication even
if the original publisher response was lost. Future release workflows with the image-reuse guard
can also recover a full rerun without rebuilding an existing exact image: source/version, image
trust and offline MCP startup are checked again, and missing aliases are repaired without moving a
newer minor alias backward. Fresh remote annotated tags reserve the minor alias for the newest
release in that line, even when the alias is missing or stale; retry that newer release to repair
it. A missing or moved current tag stops alias recovery. Do not rerun historical workflows lacking
that guard. Stop and
investigate conflicts, inactive entries, image-digest drift, or unresolved authentication errors.
See [the recovery checklist](release-process.md#recovering-a-failed-registry-job).

Exceptional manual publication requires owner approval for the exact version and payload and the
same validation, anonymous image verification, one-attempt publication, read-back, and credential
cleanup controls. Do not republish or alter the existing `1.0.2` image, tag, release, or Registry
entry to enable automation; use a future approved release tag containing the workflow.

Repository administrators should additionally restrict release-tag creation, updates and deletion
to trusted release actors using a GitHub tag ruleset. That setting is separate from this workflow
and must be verified before enabling the release path. The in-workflow ancestry gate prevents
accidental off-main releases, not malicious changes to the workflow itself. Registry GitHub OIDC
trusts the repository owner's namespace rather than enforcing this workflow's ref or environment;
repository write access must remain limited to trusted maintainers.

Release PRs should create or update these fields together:

- `package.json` version.
- `server.json` top-level `version`.
- `server.json` OCI package identifier tag, with no package-level `version` field.
- `registry/docker-mcp/server.yaml` image tag; leave `source.commit` unset until a separately
  approved registry submission can use the exact release-image source commit.

## Docker MCP Registry

Submission-ready staging files live under [registry/docker-mcp](../registry/docker-mcp):

- `server.yaml`: Docker MCP Registry server configuration for the target versioned GHCR image.
- `tools.json`: static tool list derived from `src/tools/catalog.ts`; this avoids a Docker registry
  build-time tool-listing failure when `SL_API_KEY` is not configured.
- `readme.md`: short submission README that points users to the project documentation.

External submission steps, when approved:

1. Fork `docker/mcp-registry`.
2. Copy the staged files to `servers/simplelogin-mcp/` in that fork.
3. Re-check Docker's current contribution guide before opening the PR.
4. Run the Docker registry task flow from that repo, including catalog generation/import and local
   Docker Desktop MCP Toolkit verification where available.
5. Decide whether to keep using the existing GHCR image or let Docker build and host an `mcp/...`
   image. Docker's
   [contribution guide](https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md), checked
   on 2026-08-23, explicitly accepts an organization-provided image through `--image`. That
   self-provided path uses the image directly and does not inherit Docker's enhanced build
   guarantees. If Docker builds the `mcp/...` image, Docker says it supplies cryptographic
   signatures, provenance, SBOMs, and automatic security updates. Publisher-generated provenance
   and SBOMs on the GHCR image improve its transparency but do not make it Docker-built or
   Docker-maintained.
6. Open the Docker MCP Registry pull request only after approval.

## Glama

Glama indexing and ownership state must be checked live because its listing can change independently
of this repository. Its [published methodology](https://glama.ai/mcp/methodology) and
[server metadata schema](https://glama.ai/mcp/schemas/server.json), checked on 2026-08-23, require
maintainer control and Glama's own successful source build, sandbox execution, introspection, and
scoring; they do not require a publisher SBOM or separate image signature. The former
`https://glama.ai/mcp/submit` route returned 404 on that date, so use the current **Add Server** flow
from [Glama's server directory](https://glama.ai/mcp/servers) and re-check it before submission.

Claim or submit the server only when that action is explicitly approved, keep the listing pointed
at the public README, release `server.json`, and versioned GHCR distribution path, then verify the
listing and record its URL on the release-control issue.

## Supply Chain And Image Trust

### Selected Policy

Every future multi-platform image published by
[.github/workflows/release.yml](../.github/workflows/release.yml), whether triggered by a push to
`main` or a `v*.*.*` semver tag, must include:

- explicit native BuildKit SLSA provenance with `provenance: mode=max`; and
- a native BuildKit SPDX SBOM with `sbom: true`.

The project does not add a separate GitHub artifact attestation or Sigstore Cosign signature under
this policy. Max provenance was already Docker's effective default for this public repository, but
making it explicit prevents repository visibility or action defaults from silently weakening the
policy. The SBOM adds a useful component inventory with no long-lived signing key, signing-related
OIDC trust relationship, new signing action, or broader image-build permissions. The separately
scoped Registry publishing OIDC permission is not an image-signing mechanism. No reviewed registry
currently requires separate signing, and no identified consumer currently enforces a signer-identity
policy, so that extra complexity is deferred until it has a concrete verifier.

`v1.0.0` is historical and remains unchanged: its two platform images have BuildKit SLSA
provenance, but no native SBOM was found. It is therefore documented as provenance-only. Do not
republish it, move its tag, or imply that the new policy was applied retroactively.

The anonymous inspection on 2026-08-23 recorded these immutable digests:

- index: `sha256:847243e08876caab367a0bb98bc4d80dd04bacc92c0224a11172507498d34704`;
- `linux/amd64`: `sha256:099be601161d5b1f15a58f876f26711e4f0abc4ec6e57f593def7d3f338021d6`;
- `linux/arm64`: `sha256:48480f24d09b5400cef9508da255c510dc0394e498ef0284c9d1c38b5738572c`.

Reproduce the historical boundary independently from the future-image release gate. This check
requires both platform provenance records and confirms that neither platform exposes an SBOM:

```bash
verify_historical_image_trust() (
  set -euo pipefail
  historical_image=ghcr.io/enthouan/simplelogin-mcp:1.0.0
  manifest_output="$(mktemp -d)"
  trap 'rm -rf "$manifest_output"' EXIT
  manifest_file="$manifest_output/index.json"

  docker buildx imagetools inspect "$historical_image" --raw > "$manifest_file"
  historical_digest="sha256:$(openssl dgst -sha256 -r "$manifest_file" | awk '{print $1}')"
  pinned_image="${historical_image%@*}@$historical_digest"

  test "$historical_digest" \
    = "sha256:847243e08876caab367a0bb98bc4d80dd04bacc92c0224a11172507498d34704"
  jq -e '
    any(.manifests[];
      .platform.os == "linux"
      and .platform.architecture == "amd64"
      and .digest == "sha256:099be601161d5b1f15a58f876f26711e4f0abc4ec6e57f593def7d3f338021d6")
    and any(.manifests[];
      .platform.os == "linux"
      and .platform.architecture == "arm64"
      and .digest == "sha256:48480f24d09b5400cef9508da255c510dc0394e498ef0284c9d1c38b5738572c")
  ' "$manifest_file"

  for platform in linux/amd64 linux/arm64; do
    docker buildx imagetools inspect "$pinned_image" \
      --format "{{json (index .Provenance \"$platform\").SLSA}}" \
      | jq -e 'type == "object" and length > 0'
    docker buildx imagetools inspect "$pinned_image" \
      --format "{{json (index .SBOM \"$platform\").SPDX}}" \
      | jq -e '. == null'
  done
)

verify_historical_image_trust
```

### Trust Terms

- **Digest:** the content-addressed SHA-256 identity of an OCI index or platform manifest. Pulling
  by digest protects against a mutable tag resolving to different bytes, but a digest alone does
  not identify who built or approved those bytes.
- **BuildKit SLSA provenance:** an in-toto statement about how a platform image was built, including
  its builder, source/materials, invocation, and build parameters. BuildKit stores it as an
  attestation manifest associated with the platform manifest in the multi-platform image index.
  It is not the project's separate image-signing mechanism.
- **Native SPDX SBOM:** BuildKit's SPDX inventory of packages and other software detected in the
  image. It supports inventory, license, and vulnerability-analysis workflows; it is not itself a
  vulnerability scan, signature, or guarantee that the image is safe.
- **GitHub artifact attestation:** a separately cryptographically signed in-toto claim that binds
  an artifact digest to GitHub workflow identity and build context using a short-lived Sigstore
  certificate. It requires OIDC and GitHub attestation permissions and is not enabled here.
- **Cosign keyless signature:** a cryptographic signature over an image digest made with an
  ephemeral key bound to an OIDC identity. A verifier must constrain the expected certificate
  identity and issuer. A plain Cosign signature does not provide package inventory or detailed
  build provenance, and it is not enabled here.

### Verification And Limitations

BuildKit records attestations per platform, so a multi-platform image must be checked at both
`linux/amd64` and `linux/arm64`; an index-level digest or a single unqualified output is not enough.
Use the release checklist in [release-process.md](release-process.md) to record the immutable index
and platform digests and inspect `.Provenance` and `.SBOM` for both platforms.

Known limits:

- `mode=max` can expose public build-argument values in provenance. Never pass secrets through
  build arguments; use BuildKit secret mounts and inspect provenance before publication.
- BuildKit's default SBOM scan covers the final image stage. Dependencies used only in earlier
  builder stages are absent unless those stages opt in with `BUILDKIT_SBOM_SCAN_STAGE`; do not
  describe the SBOM as a complete inventory of every build-time dependency.
- The pull-request Docker job uses the `cacheonly` exporter. It checks buildability but exports no
  image or attestation output, so it cannot prove that registry attestations will persist. Use a
  no-publish local exporter check before release and inspect the pushed image afterward.
- Provenance, SBOMs, signatures, and attestations are evidence for a verifier, not proof that an
  image is vulnerability-free or trustworthy.

Reconsider separate keyless signing if an MCP registry, deployment admission policy, or material
consumer requires signer identity; a regulatory or contractual control requires it; the threat
model expands to registry or mutable-tag compromise; or the project can document an actual
verification policy and audience. Choose exactly one mechanism first, sign immutable digests, and
define its release scope before granting signing-related OIDC or attestation permissions. Do not add
both GitHub artifact attestations and Cosign by default.

Release and publication gates:

- verify each future `main` and semver publication's index digest, platform manifests, MCP
  annotation, max-provenance configuration, and per-platform provenance and SBOM attestations;
- keep public registry metadata on semver tags, not `latest`;
- describe future images as provenance-and-SBOM images, not as separately signed images;
- treat exact-version automatic official MCP Registry publication as part of the approved stable
  release/tag flow;
- require explicit approval before an exceptional manual publication, another registry submission,
  new registry credentials, broader OIDC/attestation permissions, or a signing mechanism.
