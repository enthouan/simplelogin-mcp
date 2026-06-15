/**
 * @module config
 * Environment parsing and validation via Zod. Fails fast with a readable message
 * listing every offending variable so misconfiguration is obvious at startup.
 */
import { z } from 'zod';
import { isLoopbackHost } from './security.js';

const CONFIG_HINTS: Record<string, string> = {
  TRANSPORT: 'set TRANSPORT to "stdio" for local MCP clients or "http" for the HTTP server.',
  HOST: 'set HOST to a hostname or IP address; omit it to use the loopback default 127.0.0.1.',
  PORT: 'set PORT to an integer from 1 to 65535.',
  SL_API_URL: 'set SL_API_URL to an absolute http(s) URL such as https://app.simplelogin.io.',
  SL_API_KEY: 'set SL_API_KEY to a non-empty SimpleLogin API key.',
  ALLOW_UNAUTHENTICATED_EXPOSURE: 'set ALLOW_UNAUTHENTICATED_EXPOSURE to true, false, 1, or 0.',
  SL_REQUEST_TIMEOUT_MS: 'set SL_REQUEST_TIMEOUT_MS to an integer from 1 to 2147483647.',
};

/** Parse an env flag forgivingly: `true`/`1` → true, `false`/`0` → false (default). */
const boolEnv = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.enum(['true', 'false', '1', '0']).default('false'),
);

const optionalEnvString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
  z.string().min(1).optional(),
);

const ConfigSchema = z.object({
  TRANSPORT: z.enum(['stdio', 'http']).default('http'),
  // Default to loopback so a fresh HTTP deployment is reachable only from the local
  // machine. Binding a public/LAN interface (0.0.0.0, a specific IP) is an explicit,
  // deliberate change. See the exposure guard below.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SL_API_URL: z
    .string()
    .url()
    .refine((value) => isHttpUrl(value))
    .default('https://app.simplelogin.io'),
  SL_API_KEY: z.string().min(1, 'SL_API_KEY is required'),
  MCP_AUTH_TOKEN: optionalEnvString,
  MCP_ALLOWED_ORIGINS: optionalEnvString,
  ALLOW_UNAUTHENTICATED_EXPOSURE: boolEnv,
  SL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).max(2_147_483_647).default(15000),
});

/** Fully validated, normalized application configuration. */
export interface AppConfig {
  transport: 'stdio' | 'http';
  host: string;
  port: number;
  apiUrl: string;
  apiKey: string;
  mcpAuthToken?: string;
  /** Extra browser origins allowed to call POST /mcp, beyond loopback. */
  allowedOrigins: string[];
  /** Operator override: permit a non-loopback bind without MCP_AUTH_TOKEN. */
  allowUnauthenticatedExposure: boolean;
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
      .map((issue) => `  - ${formatConfigIssue(issue)}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }

  const value = parsed.data;
  const allowUnauthenticatedExposure =
    value.ALLOW_UNAUTHENTICATED_EXPOSURE === 'true' || value.ALLOW_UNAUTHENTICATED_EXPOSURE === '1';

  // Safe-by-default exposure guard: refuse to start an HTTP server that is both
  // reachable beyond this machine AND unauthenticated, unless the operator has
  // explicitly acknowledged it. This is the single change that prevents an
  // accidental `HOST=0.0.0.0` from publishing full control of a SimpleLogin
  // account to the LAN / internet with no credential.
  if (
    value.TRANSPORT === 'http' &&
    !isLoopbackHost(value.HOST) &&
    !value.MCP_AUTH_TOKEN &&
    !allowUnauthenticatedExposure
  ) {
    throw new Error(
      [
        `Refusing to start: HTTP is bound to a non-loopback address (HOST=${value.HOST}) with`,
        `no MCP_AUTH_TOKEN. This exposes POST /mcp, and full control of your SimpleLogin`,
        `account, to your LAN or the public internet with no authentication.`,
        ``,
        `Pick one:`,
        `  - Keep it local: unset HOST (defaults to 127.0.0.1) and reach it over localhost or`,
        `    an SSH tunnel.`,
        `  - Authenticate it: set MCP_AUTH_TOKEN to a long random secret, ideally behind TLS.`,
        `  - Override: set ALLOW_UNAUTHENTICATED_EXPOSURE=true ONLY if exposure is already`,
        `    contained elsewhere (an authenticating reverse proxy, a firewall, or another`,
        `    deployment layer).`,
        ``,
        `See SECURITY.md for the full network exposure model.`,
      ].join('\n'),
    );
  }

  return {
    transport: value.TRANSPORT,
    host: value.HOST,
    port: value.PORT,
    apiUrl: value.SL_API_URL,
    apiKey: value.SL_API_KEY,
    mcpAuthToken: value.MCP_AUTH_TOKEN,
    allowedOrigins: parseOrigins(value.MCP_ALLOWED_ORIGINS),
    allowUnauthenticatedExposure,
    requestTimeoutMs: value.SL_REQUEST_TIMEOUT_MS,
  };
}

/** Split a comma-separated origin allowlist into trimmed, non-empty entries. */
function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function formatConfigIssue(issue: z.ZodIssue): string {
  const field = issue.path.join('.') || '(root)';
  const hint = CONFIG_HINTS[field];
  return hint ? `${field}: ${hint}` : `${field}: ${issue.message}`;
}
