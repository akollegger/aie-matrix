# syntax=docker/dockerfile:1
# Combined server image: Colyseus + world-api + registry + conversation
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
# Each RUN step is cached separately; a change to one package only invalidates
# that step and all downstream steps.
# Layer 1 — leaf packages with no workspace deps
RUN pnpm --filter @aie-matrix/root-env run build
RUN pnpm --filter "@aie-matrix/shared-types" run build
RUN pnpm --filter "@aie-matrix/map-gram" run build
# Layer 2 — packages that depend only on leaf packages
RUN pnpm --filter @aie-matrix/server-auth run build
RUN pnpm --filter @aie-matrix/server-colyseus run build
# Layer 3 — packages that depend on layer-2 packages
RUN pnpm --filter @aie-matrix/server-conversation run build
RUN pnpm --filter @aie-matrix/server-world-api run build
RUN pnpm --filter @aie-matrix/server-registry run build
# Layer 4 — the combined server (depends on all above)
RUN pnpm --filter @aie-matrix/server run build

# Produce a self-contained deploy directory (no workspace symlinks, prod deps only).
# --legacy: pnpm v10+ requires this flag when workspace packages don't use inject-workspace-packages
RUN pnpm --filter @aie-matrix/server deploy --prod --legacy /app/deploy

# ─── Stage 3: runner — minimal image with only the built artifact ─────────────
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=build /app/deploy .
# Maps are baked into the image so startup-map-sync can auto-publish them.
# repoRoot resolves to "/" in this layout (dist/index.js is two levels deep),
# so maps must live at /maps for MapService's glob to find them.
COPY --from=build /repo/maps /maps
ENV NODE_ENV=production
# Combined server port (AIE_MATRIX_HTTP_PORT default)
EXPOSE 8787
CMD ["node", "dist/index.js"]
