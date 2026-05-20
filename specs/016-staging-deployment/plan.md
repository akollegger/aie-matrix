# Implementation Plan: Staging Deployment (Tier 2)

**Branch**: `016-staging-deployment` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/016-staging-deployment/spec.md`

## Summary

Implement Tier 2 of ADR-0007: a Docker Compose-based staging environment that runs the aie-matrix process topology from built container images, enforces startup dependency ordering via health checks, and gates every pull request via a GitHub Actions CI workflow. A prerequisite rename of `ghost-house` → `agent-host` (and relocation from `ghosts/` to `server/`) runs first so container image names, compose service keys, and env vars are DevOps-legible before any Docker artifacts are authored.

**Topology note**: Research revealed that `server/colyseus`, `server/world-api`, and `server/registry` are library packages with no standalone entry points; the only runnable server process is the combined `server` package. The staging stack therefore runs **4 containers** — `server` (combined), `agent-host`, `neo4j`, `redis` — not the 6 described in ADR-0007. A future "service extraction" spec is needed to reach the full 6-container vision. `RedisPresence`/`RedisDriver` wiring is also deferred (currently only `LocalPresence` is wired in Colyseus); it is a Tier 3 / horizontal-scaling concern, not a single-replica staging requirement. See `research.md` for full findings.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM `"type": "module"`); pnpm 10 workspace monorepo  
**Primary Dependencies**: Effect v3+, `@colyseus/core` 0.15.57, Docker Compose v2, GitHub Actions  
**Storage**: Neo4j 5 container (named volume for persistence), Redis 7 container  
**Testing**: vitest (unit); `docker compose up` + `/health` HTTP assertion (integration smoke); GitHub Actions runner  
**Target Platform**: Linux OCI containers (Docker Desktop on dev workstations; standard GitHub Actions runner for CI)  
**Project Type**: Multi-service server application  
**Performance Goals**: Full stack healthy in < 5 min from cold pull; single-service restart reconnects in < 60 s  
**Constraints**: No source-code volume mounts in any container; all inter-service URLs configurable via env vars (no hard-coded `localhost`); secrets never committed  
**Scale/Scope**: 6 services, supporting ~100 concurrent WebSocket connections at conference scale

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Proposal linkage | ✅ Pass | ADR-0007 accepted; scope matches exactly |
| Boundary-preserving design | ✅ Pass | Each service gets its own Dockerfile; compose file under `deploy/staging/`; no architectural shortcuts |
| Contract-explicit interfaces | ✅ Pass | IC-001 (`/health` response schema) and IC-002 (env-var URL contract) documented in `contracts/` as Phase 1 output |
| Verifiable increments | ✅ Pass | Each user slice has concrete acceptance scenarios; smoke test = `docker compose up` + health assertion |
| Documentation impact | ✅ Pass | Enumerated below; `deploy/staging/README.md` (new), `CONTRIBUTING.md`, `docs/architecture.md` all touched |

No violations. Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/016-staging-deployment/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── health-endpoint.md     ← IC-001: /health response schema
│   └── env-contract.md        ← IC-002: full env-var contract
└── tasks.md             ← Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
# Rename (P0 — prerequisite)
server/agent-host/     →  ghosts/agent-host/
  package.json            name: @aie-matrix/server-agent-host → @aie-matrix/agent-host
  examples/observer-agent (path updated in workspace)
  examples/echo-agent     (path updated in workspace)

pnpm-workspace.yaml     server/agent-host → ghosts/agent-host
                        server/agent-host/examples/* → ghosts/agent-host/examples/*

# New files (Dockerfiles — one per runnable process)
server/Dockerfile                 ← combined server (colyseus + world-api + registry)
ghosts/agent-host/Dockerfile      ← standalone agent-host service

# New files (Compose definitions)
deploy/staging/
├── docker-compose.yml       ← 4-service staging stack (server, agent-host, neo4j, redis)
├── .env.staging.example     ← documented env-var template (committed)
└── README.md                ← operator runbook

docker-compose.dev.yml       ← repo root; Neo4j + Redis only (Tier 1 helper)

# New file (CI)
.github/workflows/staging-ci.yml

# Updated files (health endpoints)
server/src/index.ts              enhance existing /health to add Neo4j connectivity check
                                 and return IC-001 { status, checks } shape
ghosts/agent-host/src/main.ts    add /health HTTP route
```

**Structure Decision**: Compose files live under `deploy/staging/` per ADR-0007; the `dev` override lives at the repo root as a Tier 1 convenience. The two Dockerfiles live next to the package they build (`server/Dockerfile`, `ghosts/agent-host/Dockerfile`). No new top-level directories required.

## Implementation Slices

Ordered by dependency; each slice is independently demonstrable.

### Slice 0 — Rename `agent-host` → `agent-host` (Prerequisite)

**Why first**: Container image names, compose service keys, and env-var prefixes must be correct before any Docker artifacts are authored. Renaming after is a find-and-replace across committed image tags and CI YAML.

**Scope**:
- Rename directory `server/agent-host/` → `ghosts/agent-host/`
- Update `package.json` name: `@aie-matrix/server-agent-host` → `@aie-matrix/agent-host`
- Update `pnpm-workspace.yaml` entries (directory + example sub-packages)
- Update all `workspace:*` dependents that reference `@aie-matrix/server-agent-host`
- Update `ghosts/random-house/` (or any sibling package) if it imports agent-host
- Update all prose references in `docs/`, `proposals/`, `specs/`, `CLAUDE.md`, `CONTRIBUTING.md`, `AGENTS.md`, `README.md`
- Update ADR-0007 and any RFC that names the service
- `pnpm install` must succeed cleanly; `pnpm typecheck` must pass

**Verification**: `pnpm install && pnpm typecheck` green; `grep -r agent-host . --include="*.json" --include="*.yaml" --include="*.md" --include="*.ts"` returns no matches outside of git history.

---

### Slice 1 — Dockerfiles + compose stack healthy locally (P1)

**Scope**:
- Multi-stage `Dockerfile` for the two runnable processes:
  - `server/Dockerfile`: three-stage pnpm pattern (fetch → build → runner); runs the combined server (colyseus + world-api + registry)
  - `ghosts/agent-host/Dockerfile`: same three-stage pattern; runs agent-host standalone
  - Both use `pnpm --filter <pkg> deploy /app/deploy` to produce a self-contained `node_modules` without workspace tooling (see research.md)
- `deploy/staging/docker-compose.yml` with:
  - Services: `neo4j` (5), `redis` (7), `server` (combined), `agent-host`
  - `depends_on: condition: service_healthy` enforcing chain: neo4j → server → agent-host
  - Named volume for Neo4j data; `aie-matrix` Docker network
  - All values read from `.env.staging` or shell environment
- Health endpoint enhancements:
  - `server/src/index.ts`: add Neo4j connectivity check and `checks` map to existing `/health` route so it returns IC-001 shape and fails until Neo4j is reachable
  - `ghosts/agent-host/src/main.ts`: add `/health` HTTP route returning IC-001 shape
- `.env.staging.example` documenting all required variables (see IC-002)
- `docker-compose.dev.yml` at repo root: neo4j + redis only

**Verification**: `docker compose -f deploy/staging/docker-compose.yml up --build`; all four services reach `healthy`; WebSocket to Colyseus and HTTP GET to `/health` on the combined server both succeed.

---

### Slice 2 — GitHub Actions CI (P2)

**Scope**:
- `.github/workflows/staging-ci.yml` triggered on PRs targeting `main`
- Steps: checkout → build all images → `docker compose up -d` → wait for healthy → assert health endpoints → `docker compose down -v`
- PR check fails if any service does not reach healthy within configurable timeout (default 5 min)
- No dangling containers or volumes after workflow completes

**Verification**: Open a test PR; confirm CI check runs and passes. Introduce a deliberate startup failure; confirm CI check fails and names the unhealthy service in the log.

---

### Slice 3 — Single-service rebuild without full restart (P3)

**Scope**: No new code — this is operational verification. Document the `docker compose up --build --no-deps <service>` pattern in `deploy/staging/README.md`. Verify that world-api can be rebuilt and restarted while colyseus continues serving connections.

**Verification**: While full stack is healthy, run `docker compose up --build --no-deps world-api`; confirm world-api reconnects to Neo4j and becomes healthy within 60 s; confirm colyseus health check remains passing throughout.

---

## Phase 0: Research

**Unknowns to resolve before design**:

| Unknown | Research Task |
|---------|--------------|
| Optimal multi-stage Dockerfile structure for pnpm workspaces | Find patterns for monorepo pnpm builds that correctly hoist workspace deps without copying the full repo into the image |
| Colyseus `RedisPresence` env-var wiring | Confirm how `REDIS_URL` drives `LocalPresence` vs `RedisPresence` in the current codebase |
| Neo4j Docker health-check command | Identify the correct `cypher-shell` or HTTP probe for Neo4j 5 readiness in compose |
| Effect-ts service startup readiness pattern | Confirm whether any of the four services already expose a `/health` route; if not, identify the Effect HTTP router pattern used in `world-api` to replicate |
| GitHub Actions compose CI patterns | Find the canonical compose-in-CI pattern that avoids port conflicts on shared runners |

**Output**: `research.md` with a Decision/Rationale/Alternatives entry for each unknown above.

## Phase 1: Design & Contracts

**Prerequisites**: `research.md` complete; all Phase 0 unknowns resolved.

### data-model.md

Entities:
- **Service definition**: name, image tag, exposed port, health-check endpoint, env-var list, depends-on list
- **Named volume**: name, mount path, owning service
- **Docker network**: name, driver, attached services
- **Environment variable**: name, required/optional, default value, which services consume it

### contracts/

- **`health-endpoint.md`** (IC-001): Response schema `{ "status": "ok" | "degraded", "checks": { [name]: boolean } }`; HTTP 200 = healthy, any non-200 = unhealthy; used by compose `depends_on` and Kubernetes readiness probes.
- **`env-contract.md`** (IC-002): Complete table of all env vars from ADR-0007 configuration contract, extended with any inter-service URL vars (`COLYSEUS_URL`, `WORLD_API_URL`, etc.) needed by agent-host and ghost-cli.

### quickstart.md

Local staging walkthrough: prerequisites (Docker Desktop, `.env.staging` populated from `.env.staging.example`), `docker compose up`, how to inspect logs, how to tear down, how to wipe Neo4j volume and start fresh.

### Agent context update

Run `.specify/scripts/bash/update-agent-context.sh claude` after Phase 1 artifacts are written.
