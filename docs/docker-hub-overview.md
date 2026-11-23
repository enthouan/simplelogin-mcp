# SimpleLogin MCP

A self-hostable Model Context Protocol server for managing SimpleLogin aliases, contacts,
mailboxes, custom domains and account settings. Connect an MCP client over stdio or Streamable HTTP.
[Source repository](https://github.com/enthouan/simplelogin-mcp) · [Setup and client guides](https://simplelogin-mcp.com/getting-started/)

Docker Hub carries stable releases for **linux/amd64** and **linux/arm64**. Choose an exact
`X.Y.Z` tag for a repeatable deployment. Here, `latest` follows the newest eligible stable
release. The primary registry is `ghcr.io/enthouan/simplelogin-mcp`, where `latest` follows the
main branch. [GHCR package](https://github.com/enthouan/simplelogin-mcp/pkgs/container/simplelogin-mcp)

Each mirror preserves the GHCR index digest, platform images and their original BuildKit
max-mode SLSA provenance and SPDX SBOMs. Compare immutable digests across registries and
inspect the per-platform attestations. [Verification guide](https://github.com/enthouan/simplelogin-mcp/blob/main/docs/docker-hub-mirror.md)
