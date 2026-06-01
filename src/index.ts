/**
 * Entrypoint that selects stdio or Streamable HTTP transport based on environment configuration.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Hono } from "hono";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import { HTTP_PATHS } from "./httpPaths.js";
import packageJson from "../package.json" with { type: "json" };

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request: IncomingMessage, config: AppConfig): boolean {
  if (!config.MCP_AUTH_TOKEN) return true;
  return request.headers.authorization === `Bearer ${config.MCP_AUTH_TOKEN}`;
}

async function startStdio(config: AppConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse, config: AppConfig): Promise<void> {
  try {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(request, response);
    response.on("close", () => {
      void transport.close().catch((error: unknown) => console.error(error));
    });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
  }
}

function createHealthApp(): Hono {
  const app = new Hono();
  app.get(HTTP_PATHS.health, (context) => context.json({ status: "ok", version: packageJson.version }));
  return app;
}

async function startHttp(config: AppConfig): Promise<void> {
  const app = createHealthApp();
  const httpServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (requestUrl.pathname === HTTP_PATHS.mcp) {
      void handleMcpRequest(request, response, config);
      return;
    }
    void app
      .fetch(new Request(requestUrl, { method: request.method, headers: request.headers as HeadersInit }))
      .then(async (honoResponse) => {
        response.writeHead(honoResponse.status, Object.fromEntries(honoResponse.headers.entries()));
        response.end(Buffer.from(await honoResponse.arrayBuffer()));
      })
      .catch((error: unknown) => {
        console.error(error);
        sendJson(response, 500, { error: "Internal server error" });
      });
  });

  await new Promise<void>((resolve) => httpServer.listen(config.PORT, resolve));
  console.error(`simplelogin-mcp listening on ${config.PORT}`);
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    if (config.TRANSPORT === "stdio") {
      await startStdio(config);
      return;
    }
    await startHttp(config);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

await main();
