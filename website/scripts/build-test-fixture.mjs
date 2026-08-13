import { build } from 'astro';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repositoryApiUrl = 'https://api.github.com/repos/enthouan/simplelogin-mcp';
const populatedStarCount = 1_234;
const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultOutDir = fileURLToPath(new URL('../.test-dist', import.meta.url));

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const fixture = readOption('--fixture') ?? 'populated';
const outDir = resolve(readOption('--out-dir') ?? defaultOutDir);

if (fixture !== 'populated' && fixture !== 'fallback') {
  throw new Error(`Unknown repository fixture: ${fixture}`);
}

const originalFetch = globalThis.fetch;
let repositoryRequestCount = 0;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.github.com/') && url !== repositoryApiUrl) {
    throw new Error(`Unexpected GitHub API request during the website fixture build: ${url}`);
  }
  if (url !== repositoryApiUrl) return originalFetch(input, init);

  repositoryRequestCount += 1;
  return fixture === 'populated'
    ? { ok: true, json: async () => ({ stargazers_count: populatedStarCount }) }
    : { ok: false, json: async () => ({}) };
};

try {
  await build(
    {
      root: websiteRoot,
      outDir,
      mode: 'production',
    },
    { force: true },
  );
  if (repositoryRequestCount !== 1) {
    throw new Error(
      `Expected exactly one GitHub repository fixture request, received ${repositoryRequestCount}`,
    );
  }
} finally {
  globalThis.fetch = originalFetch;
}
