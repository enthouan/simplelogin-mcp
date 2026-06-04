/**
 * @module logger
 * Minimal stderr-only logger. stdout is reserved for the MCP stdio transport, so
 * every diagnostic line MUST go to stderr to avoid corrupting the JSON-RPC stream.
 */

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  process.stderr.write(`[simplelogin-mcp] ${level}: ${message}${suffix}\n`);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>): void => write('error', message, meta),
};
