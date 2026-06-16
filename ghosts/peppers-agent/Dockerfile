# syntax=docker/dockerfile:1
# peppers-agent image: LLM-driven Peppers ghost (Id & Surface reasoning)
# Build context: repo root (required — workspace deps live across packages)

# ─── Stage 1: base — prime pnpm virtual store from lockfile only ──────────────
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ─── Stage 2: build — full source, install offline, build, deploy ─────────────
FROM base AS build
ENV CI=true
COPY . .
RUN pnpm install --offline --frozen-lockfile

# Build peppers-agent and ALL its workspace dependencies in topological order.
# pnpm's "..." dependency-aware selector builds every transitive workspace dep,
# so none can be missed by a hand-maintained list.
RUN pnpm --filter "@aie-matrix/ghost-peppers-agent..." run build

# Produce a self-contained deploy directory (no workspace symlinks, prod deps only).
RUN pnpm --filter @aie-matrix/ghost-peppers-agent deploy --prod --legacy /app/deploy

# ─── Stage 3: runner — minimal image with only the built artifact ─────────────
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build /app/deploy .
ENV NODE_ENV=production
EXPOSE 4002
CMD ["node", "dist/agent.js"]
