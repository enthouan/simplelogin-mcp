# SimpleLogin MCP

A self-hostable Model Context Protocol server for managing SimpleLogin aliases, contacts,
mailboxes, custom domains and account settings. Connect an MCP client over stdio or Streamable HTTP.
[Source repository](https://github.com/enthouan/simplelogin-mcp) · [Setup and client guides](https://simplelogin-mcp.com/getting-started/)

Docker Hub carries stable releases for **linux/amd64** and **linux/arm64**. Choose an exact
`X.Y.Z` tag for a repeatable deployment. Here, `latest` follows the newest eligible stable
release. The primary registry is `ghcr.io/enthouan/simplelogin-mcp`, where `latest` follows the
main branch. [GHCR package](https://github.com/enthouan/simplelogin-mcp/pkgs/container/simplelogin-mcp)

Each mirror preserves the GHCR index digest, both platform images and their original BuildKit
attestations. Releases through `1.0.0` carry provenance and have no SPDX SBOM. Starting with
`1.0.1`, both platforms carry max-mode SLSA provenance and an SPDX SBOM. Through `1.0.2`,
the built-in container health check requires HTTP mode. Starting with `1.0.3`, it also supports
stdio. [Verification guide](https://github.com/enthouan/simplelogin-mcp/blob/main/docs/docker-hub-mirror.md)
