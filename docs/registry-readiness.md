# Registry Readiness

This document tracks the repository state needed before `simplelogin-mcp` is published to public MCP
registries. It is preparation only: do not publish to the official MCP Registry, open a Docker MCP
Registry pull request, claim Glama ownership, change repository visibility, or create registry
secrets unless that publication step is explicitly approved.

## Current Status

- Repository visibility: private, which blocks public registry publication and public source review.
- Official MCP Registry lookup for `simplelogin`: no registered servers.
- Glama API lookup for `enthouan/simplelogin-mcp`: `404` / server not found.
- Current committed package version: `0.7.0`; the `ghcr.io/enthouan/simplelogin-mcp:0.7.0` image was
  built before the MCP ownership annotation was added. Do not commit or publish root `server.json`
  for `0.7.0`.
- Official MCP Registry publication is deferred until a target semver image such as
  `ghcr.io/enthouan/simplelogin-mcp:X.Y.Z` has been published with the
  `io.modelcontextprotocol.server.name` annotation.
- Registry server name: `io.github.enthouan/simplelogin-mcp`.
- Local readiness drift checks are covered by `test/registry.test.ts`.

## Official MCP Registry

Readiness checklist:

- [x] Server name uses the GitHub-authenticated namespace `io.github.enthouan/simplelogin-mcp`.
- [x] Future Docker image metadata includes `io.modelcontextprotocol.server.name` in the Dockerfile,
      release workflow, and CI dry-run workflow.
- [ ] Create or update root `server.json` with the current `2025-12-11` schema URL during the
      release path for the target semver image.
- [ ] Use package type `oci` with the GHCR distribution path.
- [ ] Pin the package identifier to the target semver image tag; do not use `latest` or a version
      range.
- [ ] Represent stdio execution with `transport.type=stdio` and `TRANSPORT=stdio`.
- [ ] Mark `SL_API_KEY` required and secret without a committed value.
- [ ] Make the repository and the GHCR image publicly accessible before publication.
- [ ] Publish a semver GHCR image for the target release before publishing matching registry
      metadata.
- [ ] Authenticate with `mcp-publisher` using GitHub auth or GitHub OIDC.
- [ ] Run `mcp-publisher publish` only after the publication step is explicitly approved.

Release PRs should create or update these fields together:

- `package.json` version.
- `server.json` top-level `version`.
- `server.json` OCI package `version`.
- `server.json` OCI package identifier tag.
- `registry/docker-mcp/server.yaml` image tag and source commit.

## Docker MCP Registry

Submission-ready staging files live under [registry/docker-mcp](../registry/docker-mcp):

- `server.yaml`: Docker MCP Registry server configuration for the existing GHCR image.
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

Glama is not yet indexing this repository. After the repository is public:

- confirm the server appears in Glama search or API lookup;
- claim/verify ownership only through Glama's current flow;
- keep the Glama listing pointed at the public README, release `server.json`, and versioned GHCR
  distribution path after those artifacts exist.

## Supply Chain And Image Trust

Current readiness:

- GHCR image publishing is automated by [.github/workflows/release.yml](../.github/workflows/release.yml)
  on `main` and semver tags.
- Future image labels and index annotations include source, revision, license, Actions run URL, and
  MCP server-name metadata.
- CI pull requests validate the Docker metadata path without publishing.
- The default Compose file pulls from GHCR, while `docker-compose.local.yml` builds from the local
  checkout for image validation.

Remaining before public launch:

- decide whether GHCR provenance, SBOM, or signing should be added before 1.0;
- verify released image tags with `docker buildx imagetools inspect`;
- keep public registry metadata on semver tags, not `latest`;
- document any new registry authentication secret before adding it to GitHub Actions.
