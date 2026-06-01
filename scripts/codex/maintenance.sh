#!/usr/bin/env bash
# Refresh a cached Codex cloud container after Codex checks out the task branch.
# Network access is enabled for this phase, so dependency updates can be fetched.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PNPM_VERSION="10.28.1"
NODE_MAJOR="22"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-$HOME/.pnpm-store}"

echo "==> Refreshing simplelogin-mcp Codex environment"
echo "Repo: $REPO_ROOT"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm install "$NODE_MAJOR"
  nvm use "$NODE_MAJOR"
fi

corepack enable
corepack prepare "pnpm@$PNPM_VERSION" --activate
pnpm config set store-dir "$PNPM_STORE_DIR"

echo "==> Runtime versions"
node -v
pnpm -v

echo "==> Refreshing dependencies"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline
else
  pnpm install --prefer-offline
fi

echo "==> Sanity checks"
pnpm typecheck
pnpm lint
pnpm test
