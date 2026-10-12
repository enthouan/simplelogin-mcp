# Docker MCP submission validation

Evidence for [issue #103](https://github.com/enthouan/simplelogin-mcp/issues/103), checked on
2026-10-08 (Pacific). On 2026-10-10, the owner approved submitting v1.0.2 with the image-health
limitation below disclosed. [Docker PR #5609](https://github.com/docker/mcp-registry/pull/5609)
opened with the three-file submission at `7fb4fbb8066e92e4642a540852bff98279fb7422`.
This records validation and submission, not Docker acceptance or availability in a published
catalog. The independent SimpleLogin/Proton disclaimer is preserved.

## Candidate and image evidence

- Self-provided image: `ghcr.io/enthouan/simplelogin-mcp:1.0.2`.
- Released source: `c6e702b72a12c1612f67d9347b313e4d588865a2` (`v1.0.2`).
- Tested index: `sha256:a8419bdbdde01eb04a099982272e78a3595d5aeeff525b1cc358c91fa166f43a`.
- `linux/amd64`: `sha256:41d000f059dd5f26caf57ba1c6b8e3f4797ba6a5ca6876f39f93ee9d8007efb4`.
- `linux/arm64`: `sha256:d130c6afeef41afe48950451a3289c9effe9727bedc8c7e5ac0c06fd18b3e537`.

Fresh anonymous GHCR reads verified the tag's index digest, both platform manifests and configs,
source/version labels, MIT license, and `io.github.enthouan/simplelogin-mcp` ownership label and
index annotation. Each platform has maximum-mode SLSA provenance and an SPDX 2.3 SBOM whose
attestation subject matches that platform's manifest. These attestations are not evidence of a
separate image signature.

The source tool catalog is unchanged between v1.0.0 and v1.0.2. All 27 canonical names and
summaries are preserved. Upstream Codex review identified missing secret requiredness and static
argument metadata. The follow-up marks `SL_API_KEY` as required and regenerates `tools.json` with
all 60 arguments from the registered input schemas: names, types, array item types, descriptions,
and optional flags. The captured v1.0.2 image tool listing verifies the staged metadata; its
SHA-256 is frozen with the selected release in the registry test, independently of the checkout.
Separate protocol-level tests check the generator against current MCP schemas. Docker's argument format does not carry full JSON
Schema constraints; the nullable domain display name is shown as a string with its null-clearing
behavior retained in the description. No tool implementation or public MCP contract changes.

## Validation results

| Layer                       | Result                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                  | Frozen dependency install, 13 registry tests, lint, typecheck, build, all 425 tests, website checks, formatting, and whitespace checks pass.                                                                |
| Docker Registry             | `task validate -- --name simplelogin-mcp`, `task build -- --tools --pull-community simplelogin-mcp`, `task catalog -- simplelogin-mcp`, and `task unittest` pass.                                           |
| Direct image runtime        | Offline MCP initialization identifies `simplelogin-mcp` v1.0.2 and returns 27 tools with clean protocol stdout. The complete public tool contract matches the repository's frozen hash.                     |
| Shared release-image smoke  | **Fails** its health-check assertion for the released v1.0.2 image; see below. This is not a sandbox failure.                                                                                               |
| Toolkit                     | Local catalog/profile creation and configuration pass. File-backed gateway MCP discovery returns all 27 tools under normal security settings, both with omitted optional settings and with explicit values. |
| Live SimpleLogin account    | Not performed: no live credential was supplied or authorized. No API tool was called.                                                                                                                       |
| Docker reviewer credentials | Not created or shared; the upstream template checkbox must remain unchecked.                                                                                                                                |

Registry validation used `docker/mcp-registry` commit
`49b643ce3fc73e6ee80bb962719b6e2990e3d397`. The build command pulls the community image and reads
`tools.json`; its reported tool count is static metadata processing, not live discovery or a Docker
image build. Generated catalogs are local test artifacts and are not part of the submission.

Direct runtime verification used the immutable index above on `linux/amd64`, `--network=none`,
`--pull=never`, and a clearly synthetic API key. All tool schemas, titles, descriptions, and
annotations match the frozen public-contract SHA-256
`af451ad318f5e7b0aadad1b25ae4af0fc56fcf050b046bca8d14c5dbf7a06eda`.
The arm64 artifact was inspected, not runtime-tested.

After the metadata review fixes, all four local Registry commands passed again. The generated
catalog retains `required: true` on the API key, and the file-backed gateway again exposes all
27 tools with matching schemas and original secret mapping, with both default and explicit
optional configuration. The v1.0.2 image digest is unchanged.

## Released-image health limitation

The unmodified command

```bash
pnpm exec tsx .github/scripts/smoke-release-image.ts \
  ghcr.io/enthouan/simplelogin-mcp@sha256:a8419bdbdde01eb04a099982272e78a3595d5aeeff525b1cc358c91fa166f43a
```

successfully initializes MCP and lists the tools, then fails with `Unexpected image health check`.
The released image has a `CMD-SHELL` probe of `http://127.0.0.1:3000/health`; stdio mode has no HTTP
listener. Executing that exact configured probe in the offline stdio container returns exit 1.
The shared smoke expects `node dist/healthcheck.js`, introduced after v1.0.2 in
[PR #136](https://github.com/enthouan/simplelogin-mcp/pull/136).

No shared assertion, health check, published image, or tag was changed to hide this failure.
The owner approved submission of v1.0.2 with this limitation disclosed on 2026-10-10. The upstream
PR records the failure explicitly. A new release remains outside issue #103's current execution
scope; any upstream requirement to change the release needs a separate owner decision.

## Toolkit v0.44.1 workflow

Tested with Docker Desktop 4.94.0, Engine 29.8.2, and `docker mcp` v0.44.1. Use the generated
`catalogs/simplelogin-mcp/catalog.yaml`, not the upstream source `server.yaml`, as gateway input.
Local catalog files must resolve under `~/.docker/mcp/catalogs/`.

For example, choose fresh task-specific names, copy the generated catalog into that directory,
and use the current creation flow:

```bash
docker mcp catalog create simplelogin-issue103:validation-unique \
  --from-legacy-catalog simplelogin-issue103-unique.yaml --title 'SimpleLogin validation'
docker mcp profile create --id simplelogin-issue103-unique --name 'SimpleLogin validation' \
  --server catalog://simplelogin-issue103:validation-unique/simplelogin-mcp
docker mcp profile config simplelogin-issue103-unique \
  --set simplelogin-mcp.sl_api_url=https://app.simplelogin.io \
  --set 'simplelogin-mcp.sl_request_timeout_ms="15000"'
```

The generator drops parameter defaults from catalog metadata. When optional values are absent,
the gateway omits their environment variables and the server applies its defaults:
`https://app.simplelogin.io` and `15000` milliseconds. Explicit values also work; the timeout is
stored as a string to match the staged schema.

Profile mode requires Docker Desktop's secret store and rejects `--secrets <file>`. To avoid reading
or replacing stored credentials, runtime testing used the supported file-backed gateway path:
`--catalog <task-catalog.yaml> --servers simplelogin-mcp --config <task-config.yaml>
--secrets <synthetic.env>`, with isolated empty registry/tools files and `--watch=false`.
The temporary secret file mapped `simplelogin-mcp.sl_api_key` to a synthetic value. Inspection of
the transient container verified the exact release image, `SL_API_KEY`, `TRANSPORT=stdio`, URL,
timeout, and `no-new-privileges`. Profile-based runtime with the Desktop secret store remains
unperformed; profile creation/configuration alone does not prove it.

Gateway schemas, descriptions, and annotation semantics match direct runtime discovery for all
27 tools. The gateway omits false `readOnlyHint`/`idempotentHint` fields; MCP defaults preserve their
meaning. Signature verification and secret blocking remained enabled, and the image health check
was not disabled. Docker's
[v0.44.1 security model](https://github.com/docker/mcp-gateway/blob/v0.44.1/docs/security.md#image-verification)
excludes third-party images such as GHCR from Docker MCP signature verification; this is supported
behavior, not proof of a Docker signature.

Temporary containers, the task-specific profile/catalog, the catalog file, and the synthetic
secret/config files were removed after testing. No client was connected and no default profile
or global catalog was reset. Pulled public images remain in Docker's local cache.

## Remaining external actions

The approved submission is open from `enthouan/mcp-registry:antoine/add-simplelogin-mcp-v1.0.2`
to `docker/mcp-registry:main`. The self-provided GHCR image/source pair and three-file payload
match the validated candidate.

At submission on 2026-10-10, the upstream
[CI run](https://github.com/docker/mcp-registry/actions/runs/38116449529) and
[security-review trigger](https://github.com/docker/mcp-registry/actions/runs/38116449547) reported
`action_required`, awaiting workflow approval by a Docker maintainer. Upstream checks have not
passed. Follow up on [PR #5609](https://github.com/docker/mcp-registry/pull/5609): obtain maintainer
workflow approval, verify the checks on the submitted head, and address review feedback. Do not
claim acceptance or catalog publication, close #103, or change its project/milestone state
automatically.

Docker's contribution guide links a
[Docker, Inc. Google Form](https://forms.gle/6Lw3nsvu2d6nFg8e6) requesting the upstream PR URL,
contact email, and test credentials. A local live test does not authorize sharing. If requested,
obtain separate approval for a disposable account, the Docker review team's access, delivery via
that form, and revocation after review. A SimpleLogin API key grants account control; never share
a production key. Limit any separately authorized live check to a read-only discovery call and
record only a redacted result.
