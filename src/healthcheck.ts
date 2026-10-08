import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Stdio has no HTTP listener; Docker already tracks the main process's liveness. */
export async function checkHealth(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (env['TRANSPORT'] === 'stdio') return true;
  if (env['TRANSPORT'] !== undefined && env['TRANSPORT'] !== 'http') return false;
  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const host = env['HOST'] ?? '127.0.0.1';
  const target = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const hostname = target.includes(':') && !target.startsWith('[') ? `[${target}]` : target;
  try {
    const response = await request(`http://${hostname}:${port}/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = (await checkHealth()) ? 0 : 1;
}
