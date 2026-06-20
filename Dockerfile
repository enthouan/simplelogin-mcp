# syntax=docker/dockerfile:1

# ---- Builder: install all deps and compile TypeScript -> dist/ ----
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Compile.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

# ---- Runtime: production deps + compiled output only ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

# Production dependencies only (no TypeScript/tsx/eslint).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Compiled JavaScript. package.json above is also used at runtime to read the version.
COPY --from=builder /app/dist ./dist

# Drop privileges to the built-in non-root user.
USER node

EXPOSE 3000

# Liveness via the HTTP health endpoint (the default http transport; for one-shot
# stdio containers the status is simply ignored).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
