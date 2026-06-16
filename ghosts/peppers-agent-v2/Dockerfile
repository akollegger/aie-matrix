# syntax=docker/dockerfile:1
# peppers-agent-v2 image: Social-tier ghost (ADR-0009, Spec 018)
# Build context: repo root (workspace deps span multiple packages)
#
# Lean node-only image: cognition runs here; memory is a SEPARATE
# agent-memory SSE service (PEPPERS_MEMORY_MCP_URL), so no Python/uv here.
# All OpenAI-shaped calls route via OpenRouter (OPENAI_BASE_URL env).

# ─── Stage 1: base — prime pnpm virtual store from lockfile only ──────────────
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ─── Stage 2: build — full source, install offline, build closure, deploy ─────
FROM base AS build
ENV CI=true
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Build peppers-agent-v2 AND its full workspace-dependency closure ("...")
# in topological order — root-env, shared-types, ghost-ts-client,
# peppers-inner, peppers-mem, peppers-router, peppers-sleep, then v2.
RUN pnpm --filter "@aie-matrix/ghost-peppers-agent-v2..." run build
# Self-contained deploy dir (no workspace symlinks, prod deps only).
RUN pnpm --filter @aie-matrix/ghost-peppers-agent-v2 deploy --prod --legacy /app/deploy

# ─── Stage 3: runner — minimal image with only the built artifact ─────────────
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build /app/deploy .
ENV NODE_ENV=production
EXPOSE 4002
CMD ["node", "dist/agent.js"]
