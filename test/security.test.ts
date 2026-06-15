/**
 * Host/origin safety predicates: loopback detection and the POST /mcp origin
 * allowlist used for DNS-rebinding / CSRF defense.
 */
import { describe, it, expect, vi } from 'vitest';
import { logger, redactForLog, redactSecrets } from '../src/logger.js';
import { isAllowedOrigin, isLoopbackHost } from '../src/security.js';

describe('isLoopbackHost', () => {
  it('treats localhost, 127.0.0.0/8, and ::1 as loopback', () => {
    for (const host of ['localhost', 'LocalHost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('treats wildcard and routable addresses as non-loopback', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5', 'example.com']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('isAllowedOrigin', () => {
  it('allows any loopback origin regardless of port', () => {
    expect(isAllowedOrigin('http://localhost:6274', [])).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', [])).toBe(true);
    expect(isAllowedOrigin('https://[::1]:8443', [])).toBe(true);
  });

  it('blocks non-loopback origins by default', () => {
    expect(isAllowedOrigin('https://evil.com', [])).toBe(false);
    expect(isAllowedOrigin('http://192.168.1.20:3000', [])).toBe(false);
  });

  it('allows explicitly configured origins', () => {
    expect(isAllowedOrigin('https://mcp.example.com', ['https://mcp.example.com'])).toBe(true);
  });

  it('rejects non-http(s) and malformed origins', () => {
    expect(isAllowedOrigin('file:///etc/passwd', [])).toBe(false);
    expect(isAllowedOrigin('not a url', [])).toBe(false);
  });
});

describe('logging redaction', () => {
  it('redacts credential-shaped strings', () => {
    const text = redactSecrets(
      'Authentication: sl-secret Authorization: Bearer mcp-secret SL_API_KEY=sl-secret MCP_AUTH_TOKEN=mcp-secret',
    );

    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('sl-secret');
    expect(text).not.toContain('mcp-secret');
  });

  it('redacts secret-bearing metadata keys recursively', () => {
    expect(
      redactForLog({
        apiKey: 'sl-secret',
        headers: { Authorization: 'Bearer mcp-secret', Authentication: 'sl-secret' },
        nested: [{ MCP_AUTH_TOKEN: 'mcp-secret' }],
        endpoint: '/api/user_info',
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      headers: { Authorization: '[REDACTED]', Authentication: '[REDACTED]' },
      nested: [{ MCP_AUTH_TOKEN: '[REDACTED]' }],
      endpoint: '/api/user_info',
    });
  });

  it('writes diagnostics only to stderr with redacted metadata', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      logger.error('request failed Authorization: Bearer mcp-secret', {
        endpoint: '/api/user_info',
        headers: { Authentication: 'sl-secret' },
      });

      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const line = String(stderrWrite.mock.calls[0]?.[0] ?? '');
      expect(line).toContain('[simplelogin-mcp] error:');
      expect(line).toContain('/api/user_info');
      expect(line).toContain('[REDACTED]');
      expect(line).not.toContain('sl-secret');
      expect(line).not.toContain('mcp-secret');
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });
});
