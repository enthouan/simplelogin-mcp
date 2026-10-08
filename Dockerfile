# syntax=docker/dockerfile:1

# ---- Builder: install all deps and compile TypeScript -> dist/ ----
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --filter simplelogin-mcp --frozen-lockfile

# Compile.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

# ---- Runtime: production deps + compiled output only ----
FROM node:24-bookworm-slim AS runtime
LABEL io.modelcontextprotocol.server.name="io.github.enthouan/simplelogin-mcp"
ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

# Production dependencies only (no TypeScript/tsx/eslint).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --filter simplelogin-mcp --prod --frozen-lockfile --ignore-scripts

# Compiled JavaScript. package.json above is also used at runtime to read the version.
COPY --from=builder /app/dist ./dist

# Drop privileges to the built-in non-root user.
USER node

EXPOSE 3000

# Probe the configured HTTP bind/port; stdio has no HTTP listener to probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/index.js"]
