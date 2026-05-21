# syntax=docker/dockerfile:1
# Agent Host image: standalone A2A + MCP proxy service
# Build context: repo root (required — workspace deps live across packages)
# IC-003: Node.js 24 matches package.json engines field

# ─── Stage 1: base — prime pnpm virtual store from lockfile only ──────────────
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Enable corepack and pre-activate the exact pnpm version declared in package.json
# so the build stage doesn't need a network call when it reads packageManager
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo
# Copy only files needed by pnpm fetch — maximises layer-cache reuse
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ─── Stage 2: build — full source, install offline, build, deploy ─────────────
FROM base AS build
# CI=true tells pnpm to skip TTY prompts (e.g. purge confirmation)
ENV CI=true
# Copy all source into the build stage (.dockerignore excludes node_modules, dist, .git)
COPY . .
# Install from virtual store (no network required)
RUN pnpm install --offline --frozen-lockfile

# Build workspace dependencies in explicit topological order.
# agent-host depends on: root-env, ghost-ts-client → shared-types
RUN pnpm --filter @aie-matrix/root-env run build
RUN pnpm --filter "@aie-matrix/shared-types" run build
RUN pnpm --filter "@aie-matrix/ghost-ts-client" run build
RUN pnpm --filter @aie-matrix/server-agent-host run build

# Produce a self-contained deploy directory (no workspace symlinks, prod deps only).
# --legacy: pnpm v10+ requires this flag when workspace packages don't use inject-workspace-packages
RUN pnpm --filter @aie-matrix/server-agent-host deploy --prod --legacy /app/deploy

# ─── Stage 3: runner — minimal image with only the built artifact ─────────────
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build /app/deploy .
ENV NODE_ENV=production
# Agent Host port (GHOST_HOUSE_PORT default)
EXPOSE 4000
CMD ["node", "dist/main.js"]
