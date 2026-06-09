#!/usr/bin/env node
/**
 * @module index
 * Entry point: load config, construct the SimpleLogin client, then start either the
 * stdio transport (local desktop clients) or a stateless Streamable HTTP server
 * (self-hosted). Wires SIGTERM/SIGINT for clean shutdown of whichever is running.
 */
import { timingSafeEqual } from 'node:crypto';
import { serve, type HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, type AppConfig } from './config.js';
import { SimpleLoginClient } from './client/simplelogin.js';
import { buildServer } from './server.js';
import { logger } from './logger.js';
import { isAllowedOrigin, isLoopbackHost } from './security.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SimpleLoginClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    timeoutMs: config.requestTimeoutMs,
  });

  if (config.transport === 'stdio') {
    await startStdio(client);
  } else {
    startHttp(config, client);
  }
}

/** Local transport for Claude Desktop / Claude Code: one server over stdio. */
async function startStdio(client: SimpleLoginClient): Promise<void> {
  const server = buildServer(client);
  await server.connect(new StdioServerTransport());
  logger.info(`v${VERSION} ready on stdio transport`);

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** Stateless Streamable HTTP transport: a fresh server+transport per POST /mcp. */
function startHttp(config: AppConfig, client: SimpleLoginClient): void {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get('/health', (c) => c.json({ status: 'ok', version: VERSION }));

  app.post('/mcp', async (c) => {
    // Reject cross-origin browser requests (DNS-rebinding / CSRF defense). Non-browser
    // MCP clients send no Origin header and are unaffected; only a present, disallowed
    // Origin is blocked.
    const origin = c.req.header('origin');
    if (origin && !isAllowedOrigin(origin, config.allowedOrigins)) {
      return c.json({ error: 'Forbidden origin' }, 403);
    }

    if (config.mcpAuthToken && !isAuthorized(c.req.header('authorization'), config.mcpAuthToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json<unknown>().catch(() => undefined);
    const server = buildServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    c.env.outgoing.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(c.env.incoming, c.env.outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  const httpServer = serve(
    { fetch: app.fetch, port: config.port, hostname: config.host },
    (info) => {
      logger.info(
        `v${VERSION} listening on http://${config.host}:${info.port} (POST /mcp, GET /health)`,
      );
      if (!config.mcpAuthToken) {
        if (isLoopbackHost(config.host)) {
          logger.info(
            'MCP_AUTH_TOKEN not set; POST /mcp is unauthenticated but bound to loopback.',
          );
        } else {
          logger.warn(
            'MCP_AUTH_TOKEN not set on a non-loopback bind; POST /mcp is unauthenticated. ' +
              'Confirm exposure is restricted at another layer (loopback publish, proxy, firewall).',
          );
        }
      }
    },
  );

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  const prefix = 'Bearer ';
  if (!header?.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
