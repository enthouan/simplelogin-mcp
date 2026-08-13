# Registry Readiness

This document records the durable controls for publishing `simplelogin-mcp` to public MCP
registries. It does not authorize publication: do not publish to the official MCP Registry, open a
Docker MCP Registry pull request, claim Glama ownership, or create registry secrets unless that
specific external action is explicitly approved.

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
- [x] Represent stdio execution with `transport.type=stdio` and `TRANSPORT=stdio`.
- [x] Mark `SL_API_KEY` required and secret without a committed value.

For each publication:

1. Validate `server.json` against the current official schema and check the live registry for both
   name collisions and earlier versions of this server.
2. Verify the exact semver GHCR image anonymously, including its digest, `linux/amd64` and
   `linux/arm64` manifests, MCP server-name annotation, and provenance attestations.
3. Reverify the public repository, website, favicon, and signed-out GHCR package page.
4. Authenticate with `mcp-publisher` using a supported GitHub flow.
5. Obtain explicit approval for official MCP Registry publication, run `mcp-publisher publish`,
   verify the resulting entry, and record its URL on the release-control issue.

Release PRs should create or update these fields together:

- `package.json` version.
- `server.json` top-level `version`.
- `server.json` OCI package `version`.
- `server.json` OCI package identifier tag.
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
   image. Docker-hosted images may provide registry-side signatures, provenance, SBOMs, and
   automatic security updates; the existing GHCR path keeps release ownership in this repository.
6. Open the Docker MCP Registry pull request only after approval.

## Glama

Glama indexing and ownership state must be checked live because its listing can change independently
of this repository. Claim or submit the server only when that action is explicitly approved, keep
the listing pointed at the public README, release `server.json`, and versioned GHCR distribution
path, then verify the listing and record its URL on the release-control issue.

## Supply Chain And Image Trust

Current readiness:

- GHCR image publishing is automated by [.github/workflows/release.yml](../.github/workflows/release.yml)
  on `main` and semver tags.
- Image labels and index annotations include source, revision, license, Actions run URL, and MCP
  server-name metadata.
- Current multi-platform release images include per-platform SLSA provenance attestations.
- CI pull requests validate the Docker metadata path without publishing.
- The default Compose file pulls from GHCR, while `docker-compose.local.yml` builds from the local
  checkout for image validation.

Release and publication gates:

- decide whether SBOMs or additional image signing are release blockers or separately tracked
  post-release work, and document how to verify the existing provenance attestations;
- verify each released image tag, digest, platform manifest, MCP annotation, and provenance with
  `docker buildx imagetools inspect`;
- keep public registry metadata on semver tags, not `latest`;
- require explicit approval before adding a registry authentication secret or performing an
  external publication.
