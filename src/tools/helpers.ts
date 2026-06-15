/**
 * @module tools/helpers
 * Shared result formatting for tools. Tools never throw: success returns
 * pretty-printed JSON text content; failures become MCP error results with a
 * readable message (including Zod field/issue detail and API status/endpoint).
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SimpleLoginAPIError } from '../client/simplelogin.js';
import { redactSecrets } from '../logger.js';

/** Wrap any JSON-serializable value as a successful tool result. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Convert a thrown value into an MCP error result with a readable message. */
export function errorResult(error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: redactSecrets(describeError(error)) }], isError: true };
}

/**
 * Run a client call and always return a tool result — never throw. Keeps every
 * tool handler a one-liner: `runTool(() => client.someMethod(...))`.
 */
export async function runTool(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await action());
  } catch (error) {
    return errorResult(error);
  }
}

function describeError(error: unknown): string {
  if (error instanceof SimpleLoginAPIError) {
    const status = error.status === 0 ? 'no response' : `HTTP ${error.status}`;
    return `SimpleLogin API error (${status}) on ${error.endpoint}: ${error.message}`;
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return `Response validation failed: ${issues}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
