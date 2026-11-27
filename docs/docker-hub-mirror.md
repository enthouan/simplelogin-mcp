# Docker Hub stable release mirror

GHCR is the primary distribution and the official MCP Registry points to its exact release tag.
The secondary destination is `docker.io/enthouan/simplelogin-mcp`. Its `X.Y.Z` tags are immutable
and its `latest` follows the newest eligible stable release. GHCR `latest` follows `main`.
Both registries serve the original `linux/amd64` and `linux/arm64` images.

## Enable the destination

1. Have the maintainer confirm control of the `enthouan` namespace. In Docker Hub, provision
   `enthouan/simplelogin-mcp` as **public** and verify its name and visibility signed out. A public
   404 is inconclusive about ownership. Restrict tag writers to this workflow. Docker registry tag
   updates have no cross-client compare-and-swap guarantee.
2. Configure the GitHub environment **dockerhub** with `enthouan` as its required reviewer.
   Allow self-review and disable administrator bypass. Under **Selected branches and tags**, add
   one branch rule for `main` and one tag rule for `v*.*.*`.
   Set its variable `DOCKERHUB_CONFIRMED_REPOSITORY` to `docker.io/enthouan/simplelogin-mcp` only
   after confirming ownership. The job also checks the repository through the anonymous Hub API.
3. For this personal namespace use Docker ID `enthouan` and a personal access token with
   **Read & Write** repository permission. Leave Delete and Cloud Sandboxes access disabled.
   Docker applies the token's permissions to the repositories the account can access. Choose its
   expiration when creating it. Store the Docker ID and token as the environment secrets
   `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Transfer the token directly from Docker's
   one-time display into the protected secret.
   [Docker access tokens](https://docs.docker.com/security/access-tokens/)
4. To rotate, create a replacement with the same account and permissions, update each environment
   that uses the old token, verify the new credential during an approved copy, and revoke the old
   token in Docker Hub. For suspected exposure, deactivate it immediately, remove the affected
   secret and inspect the repository tags before permitting another write.

Apply the reviewed [overview](docker-hub-overview.md) to the Docker Hub repository description
only after separate approval. Read the rendered public Overview back and record its URL.

### Migrate from `docker-hub-mirror`

Provision `dockerhub` before merging the workflow change. GitHub has no documented in-place
rename, and referencing a missing environment can create it without protection rules.
[GitHub environment settings](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

1. Check for pending approvals and in-progress deployments. Compare the source environment's
   current settings with the setup above. Apply its protections to `dockerhub` first, then set
   the confirmed repository variable.
2. Have the owner set `DOCKERHUB_USERNAME` and supply `DOCKERHUB_TOKEN` from its original secure
   storage using the local interactive prompt from
   `gh secret set DOCKERHUB_TOKEN --repo enthouan/simplelogin-mcp --env dockerhub`.
   GitHub exposes only secret metadata. If the token is unavailable, obtain separate approval for
   a new Docker Hub token with the permissions above and keep the old credential valid for reruns.
3. Read back both environments' reviewers, self-review and bypass settings, wait timer, custom
   protection rules, branch and tag policies, variable values and secret names. Have the owner
   confirm the credential source and scope before authorizing the workflow switch.

Keep `docker-hub-mirror` protected until the workflow change is on `main` and any pending
deployments have finished. At retirement, check which runs and release tags still reference it.
Historical deployment entries may retain the old name.

## What a release copies

The release workflow gives the mirror its verified GHCR index digest and source revision after
the GHCR image, attestations and offline discovery pass. The read-only preview identifies the
working directory, workflow/ref, commit, digest, destination tags, current digests and planned
actions. Review it before approving the environment deployment for that copy.

The writer copies from the GHCR **digest** with checksum-pinned regctl and `image copy
--force-recursive`. This follows every child of the original index, including BuildKit's
attestation manifests and their blobs. Every config, compressed layer, manifest and attestation
is read anonymously and checked against its digest and descriptor size. The verifier checks the
index and both platform identities, MIT license, MCP ownership, max-mode SLSA and SPDX evidence,
and the platform digest in each statement subject. The original provenance describes the GHCR
build. [regctl image copy](https://regclient.org/cli/regctl/image/copy/)

The native runner anonymously pulls that verified digest in a fresh Docker configuration.
MCP initialization, server name/version, the full catalog and the configured stdio health command
must pass with `--network=none`, `--pull=never` and synthetic credentials. The tool names come
from the selected commit's generated `TOOL_CATALOG.md`. Runtime evidence covers the runner's
native platform. Metadata and attestation evidence covers both architectures.

All mirror writes use one queued job concurrency group. GHCR has its own writer group and the
Registry is a sibling of the mirror. Read the `release-policy`, `docker` and `registry` job
conclusions when verifying primary publication. A pending approval or failure under `mirror`
has its own status. A successful primary publication can proceed to its GitHub Release while
the maintainer recovers the secondary destination.

## Retry an interrupted copy

After retiring `docker-hub-mirror`, recover a copy that used it with a fresh dispatch from
updated `main`. Rerunning the old job uses its original workflow and can recreate the old
environment without its protections or credentials.

Inspect the job summaries and the public exact tag and alias. When the workflow implementation is
still appropriate, use the **mirror job's databaseId** from the failed attempt. After approval,
rerun just that job. For a failed preview or an implementation fix, use the recovery dispatch below.

```bash
repo=enthouan/simplelogin-mcp
gh run view "$RUN_ID" --repo "$repo" --json jobs --jq '.jobs[] | {name,databaseId,conclusion,url}'
gh run rerun "$RUN_ID" --repo "$repo" --job "$MIRROR_JOB_ID"
```

- An absent exact tag permits one copy. An identical and complete exact tag is a verified no-op.
  If a registry-confirmed missing manifest or blob sits behind the expected index, the writer
  repairs it recursively from the same source digest and checks it again.
- A lost copy response triggers bounded public read-back. Authentication failures, malformed
  responses, conflicting identities and corrupt bytes stop the writer. After a rate limit,
  outage or unconfirmed read-back, inspect both tags before authorizing a mirror-only retry.
  An exact-tag conflict requires maintainer investigation.
- Immediately before alias writes, the job reads the remote annotated tags and Hub state again.
  An annotated canonical tag on protected main with matching release metadata reserves `latest`
  even while its image is being published. A GitHub Release object is created later. Versions
  compare numerically across all three components. A newer destination is preserved, and an
  older retry leaves an absent or stale alias to the newest eligible tag. Use that newer release's
  commit and verified digest to recover its alias.
- A missing or moved selected tag, missing required evidence, or a mismatched source digest ends
  recovery. Normal recovery requires the current release policy. The fixed historical backfill
  below checks each original under the policy documented for its version.

## Preview and approve a backfill

Select a genuine stable release and read its original release run's Docker/Registry summary.
Use the full commit and the verified GHCR index digest recorded there. Dispatch the workflow on
protected `main` so historical files are read only as data. The first command creates a preview
run and makes zero registry writes. It verifies the selected tag and its ancestry, metadata,
exact GHCR tag/digest, complete source graph and offline discovery.

```bash
repo=enthouan/simplelogin-mcp
gh workflow run dockerhub.yml --repo "$repo" --ref main \
  -f tag="$RELEASE_TAG" -f revision="$RELEASE_COMMIT" -f digest="$RELEASE_IMAGE_DIGEST" -f publish=false
```

Obtain explicit approval for that release, commit, digest, workflow/ref, exact tag and conditional
`latest` behavior. Use the same three values, inspect the new preview, and approve the protected
environment for the selected run.

```bash
gh workflow run dockerhub.yml --repo "$repo" --ref main \
  -f tag="$RELEASE_TAG" -f revision="$RELEASE_COMMIT" -f digest="$RELEASE_IMAGE_DIGEST" -f publish=true
gh run view "$RUN_ID" --repo "$repo" --json headSha,attempt,jobs,url
```

Record the original and destination index and both platform digests, the release tag and commit,
run URL, attempt and job, anonymous graph verification, native smoke, exact-tag retry and final
`latest` read-back. Record the primary jobs and the public overview separately. Keep issue #153
open until the approved production write, verified retry and published overview have evidence.
A preview or a pre-existing identical exact tag alone cannot demonstrate the initial copy.

### Original releases through 1.0.2

The one-time backfill covers the 13 releases in the [pinned list](../.github/docker-hub-history.json).
Every entry fixes the original Git tag object, source commit, GHCR tag and index digest.
`v0.1.0` and `v0.2.0` used lightweight Git tags and included `v` in their GHCR tag.
Docker Hub uses plain numeric tags for all versions.

| Original versions | Per-platform evidence                  | Built-in health check |
| ----------------- | -------------------------------------- | --------------------- |
| 0.1.0–1.0.0       | Original SLSA provenance, no SPDX SBOM | HTTP on loopback      |
| 1.0.1–1.0.2       | Max-mode SLSA provenance and SPDX SBOM | HTTP on loopback      |
| 1.0.3 onward      | Max-mode SLSA provenance and SPDX SBOM | Stdio or HTTP         |

For each pinned image, the preview verifies both architectures, hashes every referenced object,
and checks provenance subjects against the original platform digests. The native test exercises
stdio discovery against the selected commit's complete catalog. The first five releases used
literal tool registrations before the generated catalog existed. A second network-isolated
container exercises the original HTTP health check. The writer repeats the anonymous checks
against Docker Hub. Historical copies preserve exactly the evidence the build produced.

To preview this fixed batch on protected `main`, run:

```bash
gh workflow run dockerhub.yml --repo enthouan/simplelogin-mcp --ref main \
  -f tag=v1.0.5 -f revision=810cdbaf161c085cfc7d5377d880cdd9ec92e848 \
  -f digest=sha256:282b6580824c44dc1f229a9d16e7acf53201af4740ae8ca4ad7c82da4dde1a03 \
  -f include_history=true -f publish=false
```

After approval, use the same inputs with `publish=true`. The historical batch can create or
repair only the listed exact tags. The regular v1.0.5 recovery owns its exact tag and the
eligible stable alias. Use regular recovery for v1.0.3 and v1.0.4. A retry verifies any
already completed copies before proceeding to the next tag.
