/**
 * Config parsing: defaults, coercion, required fields, and the readable
 * multi-line error surfaced on invalid environments.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides;
}

describe('loadConfig', () => {
  it('applies defaults when only the API key is provided', () => {
    expect(loadConfig(env({ SL_API_KEY: 'key-123' }))).toEqual({
      transport: 'http',
      port: 3000,
      apiUrl: 'https://app.simplelogin.io',
      apiKey: 'key-123',
      mcpAuthToken: undefined,
      requestTimeoutMs: 15000,
    });
  });

  it('reads and coerces every overridable field', () => {
    expect(
      loadConfig(
        env({
          SL_API_KEY: 'key-123',
          TRANSPORT: 'stdio',
          PORT: '8080',
          SL_API_URL: 'https://sl.example.com',
          MCP_AUTH_TOKEN: 'tok',
          SL_REQUEST_TIMEOUT_MS: '5000',
        }),
      ),
    ).toEqual({
      transport: 'stdio',
      port: 8080,
      apiUrl: 'https://sl.example.com',
      apiKey: 'key-123',
      mcpAuthToken: 'tok',
      requestTimeoutMs: 5000,
    });
  });

  it('throws a readable error naming SL_API_KEY when it is missing', () => {
    expect(() => loadConfig(env({}))).toThrowError(/Invalid configuration:[\s\S]*SL_API_KEY/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', PORT: '0' }))).toThrowError(/PORT/);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', TRANSPORT: 'carrier-pigeon' }))).toThrowError(
      /TRANSPORT/,
    );
  });

  it('rejects a non-URL API base', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', SL_API_URL: 'not-a-url' }))).toThrowError(
      /SL_API_URL/,
    );
  });

  it('lists every offending field in a single error', () => {
    let message = '';
    try {
      loadConfig(env({ PORT: '70000', SL_API_URL: 'nope' }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/SL_API_KEY/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/SL_API_URL/);
  });
});
