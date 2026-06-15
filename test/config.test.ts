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
      host: '127.0.0.1',
      port: 3000,
      apiUrl: 'https://app.simplelogin.io',
      apiKey: 'key-123',
      mcpAuthToken: undefined,
      allowedOrigins: [],
      allowUnauthenticatedExposure: false,
      requestTimeoutMs: 15000,
    });
  });

  it('reads and coerces every overridable field', () => {
    expect(
      loadConfig(
        env({
          SL_API_KEY: 'key-123',
          TRANSPORT: 'stdio',
          HOST: '0.0.0.0',
          PORT: '8080',
          SL_API_URL: 'https://sl.example.com',
          MCP_AUTH_TOKEN: 'tok',
          MCP_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
          ALLOW_UNAUTHENTICATED_EXPOSURE: 'true',
          SL_REQUEST_TIMEOUT_MS: '5000',
        }),
      ),
    ).toEqual({
      transport: 'stdio',
      host: '0.0.0.0',
      port: 8080,
      apiUrl: 'https://sl.example.com',
      apiKey: 'key-123',
      mcpAuthToken: 'tok',
      allowedOrigins: ['https://a.example.com', 'https://b.example.com'],
      allowUnauthenticatedExposure: true,
      requestTimeoutMs: 5000,
    });
  });

  it('treats blank optional env-file values as unset', () => {
    const config = loadConfig(
      env({ SL_API_KEY: 'k', MCP_AUTH_TOKEN: '', MCP_ALLOWED_ORIGINS: '' }),
    );

    expect(config.mcpAuthToken).toBeUndefined();
    expect(config.allowedOrigins).toEqual([]);
  });

  describe('HTTP exposure guard', () => {
    it('refuses a non-loopback bind with no auth token', () => {
      expect(() => loadConfig(env({ SL_API_KEY: 'k', HOST: '0.0.0.0' }))).toThrowError(
        /Refusing to start[\s\S]*HOST=0\.0\.0\.0[\s\S]*MCP_AUTH_TOKEN/,
      );
    });

    it('treats a blank auth token as missing', () => {
      expect(() =>
        loadConfig(env({ SL_API_KEY: 'k', HOST: '0.0.0.0', MCP_AUTH_TOKEN: '' })),
      ).toThrowError(/Refusing to start[\s\S]*MCP_AUTH_TOKEN/);
    });

    it('allows a non-loopback bind when a token is set', () => {
      expect(
        loadConfig(env({ SL_API_KEY: 'k', HOST: '0.0.0.0', MCP_AUTH_TOKEN: 'tok' })).host,
      ).toBe('0.0.0.0');
    });

    it('allows a non-loopback bind when exposure is explicitly acknowledged', () => {
      const config = loadConfig(
        env({ SL_API_KEY: 'k', HOST: '0.0.0.0', ALLOW_UNAUTHENTICATED_EXPOSURE: '1' }),
      );
      expect(config.host).toBe('0.0.0.0');
      expect(config.allowUnauthenticatedExposure).toBe(true);
    });

    it('does not apply the guard in stdio mode', () => {
      expect(loadConfig(env({ SL_API_KEY: 'k', TRANSPORT: 'stdio', HOST: '0.0.0.0' })).host).toBe(
        '0.0.0.0',
      );
    });

    it('allows the loopback default with no token', () => {
      expect(loadConfig(env({ SL_API_KEY: 'k' })).host).toBe('127.0.0.1');
    });
  });

  it('rejects an invalid boolean for ALLOW_UNAUTHENTICATED_EXPOSURE', () => {
    expect(() =>
      loadConfig(env({ SL_API_KEY: 'k', ALLOW_UNAUTHENTICATED_EXPOSURE: 'yes' })),
    ).toThrowError(/ALLOW_UNAUTHENTICATED_EXPOSURE/);
  });

  it('throws a readable error naming SL_API_KEY when it is missing', () => {
    expect(() => loadConfig(env({}))).toThrowError(
      /Invalid configuration:[\s\S]*SL_API_KEY[\s\S]*non-empty SimpleLogin API key/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', PORT: '0' }))).toThrowError(/PORT/);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', TRANSPORT: 'carrier-pigeon' }))).toThrowError(
      /TRANSPORT[\s\S]*stdio[\s\S]*http/,
    );
  });

  it('rejects a non-URL API base', () => {
    expect(() => loadConfig(env({ SL_API_KEY: 'k', SL_API_URL: 'not-a-url' }))).toThrowError(
      /SL_API_URL/,
    );
  });

  it('rejects a non-http API base', () => {
    expect(() =>
      loadConfig(env({ SL_API_KEY: 'k', SL_API_URL: 'ftp://sl.example.com' })),
    ).toThrowError(/SL_API_URL[\s\S]*http\(s\)/);
  });

  it('does not echo invalid environment values in configuration errors', () => {
    let message = '';
    try {
      loadConfig(env({ SL_API_KEY: 'k', TRANSPORT: 'secret-token-value' }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('TRANSPORT');
    expect(message).not.toContain('secret-token-value');
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
