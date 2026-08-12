export type InstallMethodKey = 'docker' | 'http' | 'stdio';

export interface InstallMethod {
  key: InstallMethodKey;
  label: string;
  title: string;
  language: string;
  code: string;
  href: string;
}

export const INSTALL_METHODS = [
  {
    key: 'docker',
    label: 'Docker Compose — Streamable HTTP',
    title: 'Docker Compose — Streamable HTTP quick start',
    language: 'shell',
    href: 'getting-started/docker/',
    code: `git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
cp .env.example .env
# Set SL_API_KEY and MCP_AUTH_TOKEN in .env
\${EDITOR:-vi} .env
grep -Eq '^SL_API_KEY=.+$' .env || { echo 'Set SL_API_KEY in .env before starting.' >&2; exit 1; }
grep -Eq '^MCP_AUTH_TOKEN=.+$' .env || { echo 'Set MCP_AUTH_TOKEN in .env before starting.' >&2; exit 1; }
docker compose up -d
docker compose ps
curl http://localhost:3000/health`,
  },
  {
    key: 'http',
    label: 'Direct Node.js — Streamable HTTP',
    title: 'Direct Node.js — Streamable HTTP on loopback',
    language: 'shell',
    href: 'getting-started/http/',
    code: `git clone https://github.com/enthouan/simplelogin-mcp.git
cd simplelogin-mcp
corepack enable
pnpm install --filter simplelogin-mcp --frozen-lockfile
cp .env.example .env
# Keep TRANSPORT=http, HOST=127.0.0.1, and PORT=3000; set SL_API_KEY in .env
\${EDITOR:-vi} .env
grep -Eq '^SL_API_KEY=.+$' .env || { echo 'Set SL_API_KEY in .env before starting.' >&2; exit 1; }
pnpm build
# Load the file without putting the key in shell history or the parent shell
(
  set -a
  . ./.env
  set +a
  pnpm start
)`,
  },
  {
    key: 'stdio',
    label: 'Local stdio',
    title: 'Local stdio configuration',
    language: 'json',
    href: 'getting-started/stdio/',
    code: `{
  "mcpServers": {
    "simplelogin": {
      "command": "node",
      "args": ["/absolute/path/to/simplelogin-mcp/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SL_API_KEY": "sl-your-key-here"
      }
    }
  }
}`,
  },
] as const satisfies readonly InstallMethod[];

export function getInstallMethod(key: InstallMethodKey): (typeof INSTALL_METHODS)[number] {
  const method = INSTALL_METHODS.find((candidate) => candidate.key === key);
  if (!method) throw new Error(`Unknown install method: ${key}`);
  return method;
}
