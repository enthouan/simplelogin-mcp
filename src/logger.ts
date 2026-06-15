/**
 * @module logger
 * Minimal stderr-only logger. stdout is reserved for the MCP stdio transport, so
 * every diagnostic line MUST go to stderr to avoid corrupting the JSON-RPC stream.
 */

type LogLevel = 'info' | 'warn' | 'error';

const REDACTED = '[REDACTED]';
const SECRET_KEY_PATTERN = /(?:api[_-]?key|auth(?:orization|entication)?|token|secret|password)/i;
const HEADER_SECRET_PATTERNS = [
  /\b(Authorization\s*:\s*Bearer\s+)[^\s,;}]+/gi,
  /\b(Authentication\s*:\s*)[^\s,;}]+/gi,
  /\b(SL_API_KEY\s*[:=]\s*)[^\s,;}]+/gi,
  /\b(MCP_AUTH_TOKEN\s*[:=]\s*)[^\s,;}]+/gi,
];

/** Redact known secret-bearing strings before they can reach logs or MCP errors. */
export function redactSecrets(text: string, additionalSecrets: readonly string[] = []): string {
  let redacted = text;
  for (const pattern of HEADER_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, `$1${REDACTED}`);
  }
  for (const secret of additionalSecrets) {
    if (secret.length === 0) continue;
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  return redacted;
}

/** Recursively redact structured metadata while preserving non-sensitive shape. */
export function redactForLog(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const safeMeta = meta ? redactForLog(meta) : undefined;
  const suffix =
    safeMeta && typeof safeMeta === 'object' && Object.keys(safeMeta).length > 0
      ? ` ${JSON.stringify(safeMeta)}`
      : '';
  process.stderr.write(`[simplelogin-mcp] ${level}: ${redactSecrets(message)}${suffix}\n`);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(nestedValue, seen);
  }
  return redacted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>): void => write('error', message, meta),
};
