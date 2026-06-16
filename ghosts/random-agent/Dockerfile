# syntax=docker/dockerfile:1
# random-agent image: first-party Wanderer ghost (ADR-0009, Spec 018)
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

# Build workspace dependencies in explicit topological order.
# random-agent depends on: root-env, shared-types, ghost-ts-client
RUN pnpm --filter @aie-matrix/root-env run build
RUN pnpm --filter "@aie-matrix/shared-types" run build
RUN pnpm --filter "@aie-matrix/ghost-ts-client" run build
RUN pnpm --filter @aie-matrix/random-agent run build

# Produce a self-contained deploy directory (no workspace symlinks, prod deps only).
RUN pnpm --filter @aie-matrix/random-agent deploy --prod --legacy /app/deploy

# ─── Stage 3: runner — minimal image with only the built artifact ─────────────
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build /app/deploy .
ENV NODE_ENV=production
EXPOSE 4001
CMD ["node", "dist/agent.js"]
