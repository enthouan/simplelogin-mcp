#!/usr/bin/env bash
# Prepare a fresh Codex cloud container for simplelogin-mcp.
# Codex runs this after cloning the repo, while network access is enabled.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PNPM_VERSION="10.28.1"
NODE_MAJOR="22"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-$HOME/.pnpm-store}"

echo "==> Preparing simplelogin-mcp Codex environment"
echo "Repo: $REPO_ROOT"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm install "$NODE_MAJOR"
  nvm alias default "$NODE_MAJOR"
  nvm use "$NODE_MAJOR"

  if ! grep -q 'simplelogin-mcp Codex environment' "$HOME/.bashrc" 2>/dev/null; then
    {
      echo ''
      echo '# simplelogin-mcp Codex environment'
      echo 'export NVM_DIR="$HOME/.nvm"'
      echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
      echo "nvm use $NODE_MAJOR >/dev/null"
    } >> "$HOME/.bashrc"
  fi
fi

corepack enable
corepack prepare "pnpm@$PNPM_VERSION" --activate
pnpm config set store-dir "$PNPM_STORE_DIR"

echo "==> Runtime versions"
node -v
pnpm -v

echo "==> Installing dependencies"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
else
  pnpm install
fi

echo "==> Validating project"
pnpm typecheck
pnpm lint
pnpm test
