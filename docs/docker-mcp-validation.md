# Docker MCP submission validation

Evidence for [issue #103](https://github.com/enthouan/simplelogin-mcp/issues/103), refreshed on
2026-11-24 (Pacific) after owner approval to update
[Docker PR #5609](https://github.com/docker/mcp-registry/pull/5609) to v1.0.5.
The entry remains a self-provided GHCR image. This records candidate validation and submission,
not Docker acceptance, Docker-managed signing, or availability in the published MCP Catalog.

## Candidate and image evidence

- Primary image: `ghcr.io/enthouan/simplelogin-mcp:1.0.5`.
- Secondary mirror: `docker.io/enthouan/simplelogin-mcp:1.0.5`;
  [Docker Hub overview](https://hub.docker.com/r/enthouan/simplelogin-mcp).
- Released source: `810cdbaf161c085cfc7d5377d880cdd9ec92e848` (`v1.0.5`).
- Shared index: `sha256:282b6580824c44dc1f229a9d16e7acf53201af4740ae8ca4ad7c82da4dde1a03`.
- `linux/amd64`: `sha256:da7e5dcf9f6acdeae244713dd3330112e9411eb52f7db742017085442e301174`.
- `linux/arm64`: `sha256:0ba2247695bf488430fabbb06c04b6d2a450a6ddde4a949ee3a91a76cc570fd2`.

Fresh anonymous reads of both registries verified the exact tag/index/source relationship,
both platform manifests, configuration and layer bytes, ownership/version/license metadata,
max-mode SLSA provenance, and native SPDX SBOMs with matching platform subjects.
The checks used the read-only `PublicRegistry.tag()` and `PublicRegistry.verify()` helpers in
`.github/scripts/mirror-registry.ts`. The complete verified graph is identical in both registries.
No image was rebuilt or published for this refresh.

## Tool contract and health check

The exact GHCR image initialized as `simplelogin-mcp` v1.0.5 and returned all 27 tools through
offline stdio discovery. The full names, titles, descriptions, input schemas, output-schema fields,
and annotations match the frozen public-contract SHA-256:

`af451ad318f5e7b0aadad1b25ae4af0fc56fcf050b046bca8d14c5dbf7a06eda`.

All 60 staged argument records match the image's actual input schemas, including names, types,
array item types, descriptions, and requiredness. `tools.json` therefore remains unchanged, with
SHA-256 `ae77321f2460b09281080bf80aa76b17a66edb217b4e4417e2d2c17fccdad487`.
The API key remains explicitly required, and the tool names, secret mapping and stdio transport
are unchanged.

The unmodified release-image smoke passed:

```bash
pnpm exec tsx .github/scripts/smoke-release-image.ts \
  ghcr.io/enthouan/simplelogin-mcp@sha256:282b6580824c44dc1f229a9d16e7acf53201af4740ae8ca4ad7c82da4dde1a03 \
  810cdbaf161c085cfc7d5377d880cdd9ec92e848
```

It checks release-specific identity and tool names, then executes the image's configured
`node dist/healthcheck.js` in stdio mode. The native `linux/amd64` container used
`--network=none`, `--pull=never` and a synthetic API key. No SimpleLogin API tool was called.
Arm64 received artifact and attestation verification, not runtime testing.

The historical v1.0.2 candidate had an HTTP-only health probe that failed in stdio mode. That
limitation is resolved in this v1.0.5 candidate by the existing transport-aware health check
shipped in v1.0.3. Historical images, tags and releases remain unchanged. The earlier submission
evidence is retained in
[the v1.0.2 validation record](https://github.com/enthouan/simplelogin-mcp/blob/7fdd78ca09c28dcafb9ff56aeafae0af028d8495/docs/docker-mcp-validation.md).

## Registry and repository validation

The refreshed three-file payload was tested on Docker's fetched main commit
`7acac061940d9b3d6bbfc7dd26b1e9c2ee17b15c`:

| Check                                                           | Result                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `task validate -- --name simplelogin-mcp`                       | Pass, including pinned source, required secret, environment and icon validation.              |
| `task build -- --tools --pull-community simplelogin-mcp`        | Pass: pulls v1.0.5 and processes the static 27-tool list.                                     |
| `task catalog -- simplelogin-mcp`                               | Pass: generates a local test catalog.                                                         |
| `task unittest`                                                 | Pass against the current upstream base.                                                       |
| `pnpm exec vitest run test/registry.test.ts test/tools.test.ts` | 28 tests passed; selected release expectations and the unchanged public contract are covered. |
| Changed-file formatting and `git diff --check`                  | Pass.                                                                                         |

The community-image build command does not rebuild the image and uses `tools.json` instead of
runtime discovery. Direct image and Toolkit discovery were tested separately. The source release
pin is an explicit Docker submission choice, independent of future package-version changes.

## Docker MCP Toolkit validation

Tested with Docker Engine 29.9.3 and `docker mcp` v0.44.3 using the generated
`catalogs/simplelogin-mcp/catalog.yaml`. A uniquely named temporary catalog file was placed in
the Toolkit's required `~/.docker/mcp/catalogs/` directory and removed afterward.

The file-backed gateway used explicit task-specific `--catalog`, `--config`, `--registry`,
`--tools-config` and `--secrets` paths, `--servers simplelogin-mcp`, and `--watch=false`.
The secret file contained only a synthetic `simplelogin-mcp.sl_api_key`. No stored Desktop
secrets, existing profiles, client connections or default catalog settings were changed.

Discovery was checked with omitted optional configuration and with explicit
`sl_api_url=http://127.0.0.1:9` / `sl_request_timeout_ms="15000"`. Both returned the expected
27 tools and all 60 argument records. Descriptions, schema constraints and annotation semantics
match the direct image. Signature verification and secret blocking remain enabled.

Toolkit v0.44.3 translates declared draft-07 input schemas to JSON Schema 2020-12 by default.
Comparison accounts explicitly for that dialect identifier and omitted false annotation hints;
the remaining schema structure and constraints match. The optional
`--preserve-tool-schema-dialect` path was also checked against the original input schemas.

No live SimpleLogin calls, reviewer credential sharing, or Desktop-secret-store profile runtime
were performed. Temporary validation containers and catalog files were removed; public image
caches and isolated local evidence remain.

## Upstream status and follow-up

The existing PR remains on `enthouan/mcp-registry:antoine/add-simplelogin-mcp-v1.0.2`; its branch
name is retained to preserve the PR, while the candidate is now v1.0.5.
The refresh commit is `f739c1386d5944b1075b00b2b251ed3bf9b8ba9a`.

The old head's CI and security-review workflows ended in failure without running jobs after
awaiting maintainer approval. Check [PR #5609](https://github.com/docker/mcp-registry/pull/5609)
for the refreshed head's current checks. Docker maintainer workflow approval and review remain
external requirements; local validation is not an upstream pass or Catalog acceptance.
Keep #103 open while that review is pending.

Docker's contribution guide links a
[reviewer credential form](https://forms.gle/6Lw3nsvu2d6nFg8e6). No credential has been shared.
If reviewers require live account access, obtain separate owner approval for a disposable account,
the recipients and delivery method, and revocation afterward. Never provide a production API key.
