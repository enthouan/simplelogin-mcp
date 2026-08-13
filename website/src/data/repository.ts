export const REPOSITORY_URL = 'https://github.com/enthouan/simplelogin-mcp';
export const REPOSITORY_API_URL = 'https://api.github.com/repos/enthouan/simplelogin-mcp';

const REPOSITORY_METADATA_TIMEOUT_MS = 2_000;
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

interface RepositoryResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

interface RepositoryMetadata {
  stargazers_count?: unknown;
}

export type RepositoryFetch = (
  input: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<RepositoryResponse>;

function isRepositoryStarCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0);
}

/**
 * Read public repository metadata without making the website build depend on GitHub availability.
 */
export async function fetchRepositoryStarCount(
  fetchImpl: RepositoryFetch = globalThis.fetch,
  timeoutMs = REPOSITORY_METADATA_TIMEOUT_MS,
): Promise<number | undefined> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<undefined>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, timeoutMs);
  });

  const request = (async () => {
    const response = await fetchImpl(REPOSITORY_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'simplelogin-mcp-website-build',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;

    const payload = await response.json();
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;

    const count = (payload as RepositoryMetadata).stargazers_count;
    return isRepositoryStarCount(count) ? count : undefined;
  })();

  try {
    return await Promise.race([request, timedOut]);
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Memoize successes and fallbacks so one build never retries the GitHub request. */
export function createRepositoryStarCountLoader(
  fetchImpl: RepositoryFetch = globalThis.fetch,
  timeoutMs = REPOSITORY_METADATA_TIMEOUT_MS,
): () => Promise<number | undefined> {
  let request: Promise<number | undefined> | undefined;
  return () => (request ??= fetchRepositoryStarCount(fetchImpl, timeoutMs));
}

export function formatRepositoryStarCount(starCount: number | undefined): string | undefined {
  if (!isRepositoryStarCount(starCount)) return undefined;

  return compactNumberFormatter.format(starCount);
}

export function formatRepositoryStarCountLabel(starCount: number | undefined): string | undefined {
  if (!isRepositoryStarCount(starCount)) return undefined;

  const unit = starCount === 1 ? 'star' : 'stars';
  return `${compactNumberFormatter.format(starCount)} ${unit}`;
}

export const getRepositoryStarCount = createRepositoryStarCountLoader();
