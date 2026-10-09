import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { checkHealth } from '../src/healthcheck.js';

describe('Container transport-aware health check', () => {
  it('does not probe a nonexistent HTTP listener in stdio mode', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(checkHealth({ TRANSPORT: 'stdio' }, request)).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'http://127.0.0.1:3000/health'],
    [{ TRANSPORT: 'http', HOST: '0.0.0.0', PORT: '3456' }, 'http://127.0.0.1:3456/health'],
    [{ HOST: '::', PORT: '3457' }, 'http://[::1]:3457/health'],
    [{ HOST: '::1' }, 'http://[::1]:3000/health'],
    [{ HOST: 'localhost', PORT: '3001' }, 'http://localhost:3001/health'],
  ])('checks the configured HTTP listener %j', async (env, url) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    await expect(checkHealth(env, request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith(url, {
      redirect: 'error',
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it.each([500, 503])('fails on unhealthy HTTP %i', async (status) => {
    await expect(
      checkHealth({}, vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))),
    ).resolves.toBe(false);
  });

  it('fails on a refused connection or timeout', async () => {
    await expect(
      checkHealth({}, vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'))),
    ).resolves.toBe(false);
  });

  it.each([{ PORT: '0' }, { PORT: '65536' }, { PORT: 'abc' }, { TRANSPORT: 'invalid' }])(
    'fails closed on invalid config %j',
    async (env) => {
      const request = vi.fn<typeof fetch>();
      await expect(checkHealth(env, request)).resolves.toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('uses the tested compiled check as the actual Docker health command', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toContain('CMD ["node", "dist/healthcheck.js"]');
  });
});
