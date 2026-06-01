/**
 * Shared tool registration types and response helpers.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatZodError } from "../config.js";
import { SimpleLoginAPIError, type SimpleLoginClient } from "../client/simplelogin.js";

export type ToolClient = SimpleLoginClient;
export type ToolContent = { type: "text"; text: string };
export type ToolResult = { content: ToolContent[]; isError?: boolean };
export type ToolHandler<Input> = (input: Input) => Promise<unknown>;

export function jsonToolResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof SimpleLoginAPIError) {
    return { error: error.message, status: error.status, endpoint: error.endpoint, details: error.details };
  }
  if (error instanceof z.ZodError) {
    return { error: formatZodError(error) };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Unknown error", details: error };
}

export function errorToolResult(error: unknown): ToolResult {
  const payload = errorPayload(error);
  console.error(JSON.stringify(payload));
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}

export async function runTool<Input>(schema: z.ZodType<Input>, input: unknown, handler: ToolHandler<Input>): Promise<ToolResult> {
  try {
    const parsed = schema.parse(input);
    const result = await handler(parsed);
    return jsonToolResult(result);
  } catch (error) {
    return errorToolResult(error);
  }
}

export type RegisterTools = (server: McpServer, client: ToolClient) => void;
