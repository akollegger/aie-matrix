# Implementation Plan: Map Management — Publish, Activate, and Archive

**Branch**: `015-map-management` | **Date**: 2026-05-17 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/014-map-management/spec.md`

## Summary

Implement `/maps/` (artifact CRUD) and `/live/` (live session management) HTTP routes in `server/world-api/`, backed by GCS (artifact storage) and Neo4j (map cell sync + session state). Map publish is a two-step write: GCS upload then Neo4j `(:Cell)` merge. Session activation is lightweight — cells are already in Neo4j at publish time, so `POST /live` only creates the session record and `[:USES]` edges. A Redis pub/sub broadcast over `aie-matrix:world-events` notifies Colyseus and ghost-house of session and map-change events. All management endpoints require `ADMIN_TOKEN` bearer auth via a new Effect-ts middleware. The existing file-based `MapService` (Tier 1 local dev) is unchanged.

## Deployment Scope

This feature targets **Tier 1 (local dev)** only. Tier 2 (staging) and Tier 3 (production) deployment concerns are explicitly deferred to the ADR-0007 follow-on work.

| Tier | In scope for this feature? | Notes |
|---|---|---|
| **Tier 1** — `pnpm dev`, local Neo4j | ✅ | Neo4j via Docker Desktop required for `/maps/` and `/live/`; GCS stub + Redis no-op when those vars are unset |
| **Tier 2** — `docker compose`, Redis + Neo4j containers, MinIO | ❌ deferred | Dockerfiles, `docker-compose.yml`, MinIO wiring → ADR-0007 follow-on |
| **Tier 3** — GKE, Memorystore, Neo4j Aura, Helm | ❌ deferred | K8s manifests, GCS credentials, `readinessProbe` wiring → ADR-0007 follow-on |

**Graceful degradation when `NEO4J_URI` is unset** (Tier 1 without any DB): `/maps/` and `/live/` return `503 Service Unavailable` with `{ "error": "NEO4J_REQUIRED", "message": "Map management requires Neo4j. Set NEO4J_URI or use AIE_MATRIX_MAP for local file mode." }`. The existing `MapService` file path (`AIE_MATRIX_MAP`) continues to work unchanged.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24, ESM (`"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `neo4j-driver` v5, `@google-cloud/storage` v7 (new), `busboy` v1 (new — multipart parsing), `ioredis` v5 (new — world-api pub/sub), `ulid` (new — session IDs), `zod` v3  
**Storage**: Neo4j (`:Map`, `:LiveSession`, `:Cell` nodes); GCS (`.map.gram` artifact blobs)  
**Testing**: `vitest`  
**Target Platform**: Node.js 24 server process; Tier 1 = `pnpm dev` with local Neo4j (Docker Desktop)  
**Project Type**: HTTP service extension (new routes within existing `server/world-api/` package)  
**Performance Goals**: `POST /maps` (publish + Neo4j sync) < 10 s for conference-sized maps; `POST /live` (activation) < 500 ms  
**Constraints**: `ADMIN_TOKEN` must never be logged; GCS write precedes Neo4j write; `(:Cell)` sync is idempotent (MERGE, not CREATE); Tier 2/3 deployment concerns out of scope  
**Scale/Scope**: Single active session at v1; map artifacts are tens of KB; 500–2000 cells per map

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Proposal linkage** ✅ — RFC-0013 (draft, pending acceptance) and ADR-0007 (accepted) both traced in spec.
- **Boundary-preserving** ✅ — all new routes live in `server/world-api/`; `server/src/index.ts` registers them following the existing pattern; no new top-level directories.
- **Shared interface contracts** ✅ — IC-001–IC-006 defined in spec; contract artifacts generated in Phase 1 under `specs/014-map-management/contracts/`.
- **Verifiable increments** ✅ — 4 independently testable user stories; each has observable acceptance scenarios; `quickstart.md` documents local verification.
- **Documentation impact** ✅ — spec enumerates `docs/architecture.md`, RFC-0013 status, and `server/world-api/README.md` as required updates.

Post-design re-check: No violations introduced. New top-level package directories not required; new deps added to `server/world-api/package.json` only.

## Project Structure

### Documentation (this feature)

```text
specs/014-map-management/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── http-maps-api.md         ← IC-001 (POST/GET/DELETE /maps)
│   ├── http-live-api.md         ← IC-002/IC-003 (POST/GET/PATCH/DELETE /live)
│   ├── redis-events.md          ← IC-004 (world event pub/sub)
│   └── session-binding.md       ← IC-005/IC-006 (LIVE_SESSION_ID, /health)
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code

```text
server/world-api/src/
├── map/
│   ├── MapService.ts              (existing — unchanged; file-based Tier 1)
│   ├── MapRoutes.ts               (existing — unchanged)
│   ├── map-errors.ts              (existing — extend: add MapManagementError variants)
│   ├── MapManagementService.ts    (new — Context.Tag; GCS upload + Neo4j (:Map) CRUD + cell sync)
│   └── MapManagementRoutes.ts     (new — POST/GET/DELETE /maps handlers)
├── live/
│   ├── LiveSessionService.ts      (new — Context.Tag; Neo4j (:LiveSession) CRUD + pub/sub)
│   ├── LiveSessionRoutes.ts       (new — POST/GET/PATCH/DELETE /live handlers)
│   └── live-errors.ts             (new — LiveSessionError variants)
├── gcs/
│   └── GcsService.ts              (new — Context.Tag; wraps @google-cloud/storage)
├── redis/
│   └── RedisPublishService.ts     (new — Context.Tag; ioredis publish-only; no-op when REDIS_URL unset)
├── admin-auth.ts                  (new — checkAdminToken() Effect helper)
└── index.ts                       (existing — add exports for new services + handlers)

server/src/
├── index.ts                       (existing — add route registrations, extend Layer.mergeAll, CORS OPTIONS)
└── errors.ts                      (existing — add HTTP mappings for new error types)

shared/root-env/src/
└── index.ts                       (existing — expose GCS_BUCKET, ADMIN_TOKEN, LIVE_SESSION_ID accessors)
```

**Structure Decision**: All new source files fit within the existing `server/world-api/src/` tree. The `live/`, `gcs/`, and `redis/` subdirs mirror the existing `map/` pattern (service + routes + errors per domain). No new top-level repository directories. New npm dependencies (`@google-cloud/storage`, `busboy`, `ioredis`, `ulid`) are added to `server/world-api/package.json` only.
