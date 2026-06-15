/**
 * Tool result wrapping: success payloads, error formatting for each error class,
 * and the never-throw guarantee of runTool.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jsonResult, errorResult, runTool } from '../src/tools/helpers.js';
import { SimpleLoginAPIError } from '../src/client/simplelogin.js';

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

describe('jsonResult', () => {
  it('wraps data as pretty-printed JSON text content without an error flag', () => {
    const result = jsonResult({ a: 1, b: [2, 3] });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });
});

describe('errorResult', () => {
  it('formats a SimpleLoginAPIError with HTTP status and endpoint', () => {
    const result = errorResult(new SimpleLoginAPIError(404, '/api/aliases/1', 'Not found'));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('SimpleLogin API error (HTTP 404) on /api/aliases/1: Not found');
  });

  it('labels a status-0 error as "no response"', () => {
    const result = errorResult(new SimpleLoginAPIError(0, '/api/x', 'Request timed out after 5ms'));
    expect(textOf(result)).toBe(
      'SimpleLogin API error (no response) on /api/x: Request timed out after 5ms',
    );
  });

  it('redacts credential-shaped values from MCP tool errors', () => {
    const result = errorResult(
      new SimpleLoginAPIError(
        401,
        '/api/user_info',
        'Authentication: sl-secret Authorization: Bearer mcp-secret SL_API_KEY=sl-secret MCP_AUTH_TOKEN=mcp-secret',
      ),
    );
    const text = textOf(result);

    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('sl-secret');
    expect(text).not.toContain('mcp-secret');
  });

  it('summarizes the issues of a ZodError', () => {
    const parsed = z.object({ email: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    const result = errorResult(parsed.success ? new Error('unexpected') : parsed.error);
    expect(textOf(result)).toMatch(/^Response validation failed: email:/);
  });

  it('uses the message of a generic Error', () => {
    expect(textOf(errorResult(new Error('boom')))).toBe('boom');
  });

  it('stringifies a non-Error throwable', () => {
    expect(textOf(errorResult('weird failure'))).toBe('weird failure');
  });
});

describe('runTool', () => {
  it('returns a json result when the action resolves', async () => {
    const result = await runTool(() => Promise.resolve({ ok: 1 }));
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(JSON.stringify({ ok: 1 }, null, 2));
  });

  it('returns an error result instead of throwing when the action rejects', async () => {
    const result = await runTool(() => Promise.reject(new Error('nope')));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('nope');
  });
});
