/**
 * @module config
 * Environment parsing and validation via Zod. Fails fast with a readable message
 * listing every offending variable so misconfiguration is obvious at startup.
 */
import { z } from 'zod';

const ConfigSchema = z.object({
  TRANSPORT: z.enum(['stdio', 'http']).default('http'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SL_API_URL: z.string().url().default('https://app.simplelogin.io'),
  SL_API_KEY: z.string().min(1, 'SL_API_KEY is required'),
  MCP_AUTH_TOKEN: z.string().min(1).optional(),
  SL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).default(15000),
});

/** Fully validated, normalized application configuration. */
export interface AppConfig {
  transport: 'stdio' | 'http';
  port: number;
  apiUrl: string;
  apiKey: string;
  mcpAuthToken?: string;
  requestTimeoutMs: number;
}

/**
 * Parse and validate the process environment.
 * @throws Error with a multi-line, human-readable summary when validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }

  const value = parsed.data;
  return {
    transport: value.TRANSPORT,
    port: value.PORT,
    apiUrl: value.SL_API_URL,
    apiKey: value.SL_API_KEY,
    mcpAuthToken: value.MCP_AUTH_TOKEN,
    requestTimeoutMs: value.SL_REQUEST_TIMEOUT_MS,
  };
}
