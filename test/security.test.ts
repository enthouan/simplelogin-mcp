/**
 * Host/origin safety predicates: loopback detection and the POST /mcp origin
 * allowlist used for DNS-rebinding / CSRF defense.
 */
import { describe, it, expect } from 'vitest';
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
