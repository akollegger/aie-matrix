# Research: Map Management

**Branch**: `015-map-management` | **Date**: 2026-05-17

## 1. GCS Client Library

**Decision**: `@google-cloud/storage` v7  
**Rationale**: Official Google Cloud Node.js client; supports stream-based uploads (avoids buffering the entire artifact in memory); has a `File.save()` method that accepts `Buffer` directly. Authentication flows from `GOOGLE_APPLICATION_CREDENTIALS` env var (ADC) in Tier 2/3; no credential hard-coding needed.  
**Alternatives considered**:
- `node-fetch` + GCS JSON API: simpler dep but requires manual auth token refresh, multipart upload encoding, and error surface. Not worth the maintenance cost.
- `@google-cloud/storage` with a custom `apiEndpoint`: enables MinIO compatibility for Tier 2 staging by pointing at `http://minio:9000` with `forcePathStyle: true`. This resolves RFC-0013 OQ-3 at no extra implementation cost.

**Interface**: `GcsService` exposes `upload(bucket, object, body: Buffer): Effect<void, GcsError>` and `download(bucket, object): Effect<Buffer, GcsError>`. Implementation swaps in a stub (write to/from local `tmp/gcs/`) when `GCS_BUCKET` is unset, preserving Tier 1 dev without GCS credentials.

---

## 2. Multipart Form Parsing (`POST /maps`)

**Decision**: `busboy` v1  
**Rationale**: The server uses raw Node.js `http.IncomingMessage` with no framework. `busboy` is the lowest-dependency, streaming multipart parser — it's what `formidable` and `multer` use internally. It parses `multipart/form-data` fields and file parts from a readable stream without buffering the whole body first.  
**Alternatives considered**:
- `formidable`: heavier API, writes temp files by default (adds temp-file cleanup concern). Overkill for a single-endpoint use.
- `multer`: requires Express middleware API. Not applicable to raw Node.js.

**Integration**: `parseMultipart(req): Effect<{ mapId: string; fileBytes: Buffer }, MultipartParseError>` — a thin Effect wrapper around the `busboy` stream pipeline.

---

## 3. Redis Pub/Sub from world-api

**Decision**: `ioredis` v5 (direct, publish-only connection in world-api)  
**Rationale**: Colyseus uses Redis through `@colyseus/redis-driver`/`RedisPresence` for its own matchmaking state — that connection is internal to the Colyseus process and not accessible from world-api. world-api needs its own Redis connection exclusively for publishing `world.session-started`, `world.session-ended`, and `world.map-changed` events. `ioredis` is the standard Node.js Redis client and is already transitively present via Colyseus.  
**Alternatives considered**:
- Sharing the Colyseus Redis connection: architecturally wrong (cross-process in Tier 2/3) and not exposed as a public API.
- `redis` (npm): equally valid; `ioredis` chosen for explicit Promise-based API and better TypeScript types.

**Behavior when `REDIS_URL` is unset**: `RedisPublishService` is a no-op Layer (Tier 1 — local dev without Redis). The publish call logs a debug line and returns `Effect.void`. This preserves the Tier 1 workflow.

**Channel**: `aie-matrix:world-events` (constant extracted to `@aie-matrix/shared-types`).

---

## 4. Session ID Generation

**Decision**: `ulid` npm package (already used in `server/world-api` per CLAUDE.md)  
**Rationale**: ULIDs are lexicographically sortable and URL-safe — appropriate for `(:LiveSession { id })` where sort order by creation time is useful for `GET /live?status=active` ordering. Already in the dep tree.  
**Alternatives considered**: `randomUUID()` from Node.js crypto — simpler, but not sortable. `nanoid` — shorter but no time ordering. ULID is already the project standard (ghost conversation message IDs, ghost-house event IDs).

---

## 5. Admin Token Authentication

**Decision**: Static env-var equality check in a thin Effect helper  
**Rationale**: RFC-0013 OQ-6 explicitly scopes this to a simple equality check; the long-term auth solution is deferred to the "Authentication and Identity" open question in `docs/architecture.md`. Keeping it minimal means the middleware is trivially replaceable.

**Implementation**: `checkAdminToken(req): Effect<void, AdminAuthError>` reads the `Authorization` header, strips the `Bearer ` prefix, and compares to `process.env.ADMIN_TOKEN`. If missing or mismatched, fails with `AdminAuthError`. Route handlers call this first and return `401` on failure. `ADMIN_TOKEN` is never logged (enforced by not including it in any structured log line).

---

## 6. Neo4j Cell Sync Strategy

**Decision**: `MERGE` on `(:Tile { h3Index })`, then set all other properties  
**Rationale**: Cell seeding at publish time must be idempotent — re-publishing the same or an updated map must not create duplicate nodes. `MERGE` on the unique `h3Index` property (constraint `tile_h3_unique` already exists) satisfies this. For a map update, cells removed from the new version are left in Neo4j (orphaned) — they are never in an active session's movement graph, and the `CELL_NOT_IN_MAP` rejection path handles movement attempts to them. Explicit cleanup of orphaned cells is deferred.  
**Alternatives considered**:
- DELETE + CREATE: not idempotent; would break in-flight sessions if a re-publish races with ghost movement.
- Full graph replace inside a Neo4j transaction: feasible but more complex; deferred unless performance demands it.

---

## 7. Map Switch Cell Diff

**Decision**: Compute `removedCells` / `addedCells` by querying Neo4j cell sets for old and new map IDs  
**Rationale**: Since all published maps' cells are in Neo4j at publish time, the diff for `PATCH /live/:id/maps` is a set operation on cell nodes tagged by their source map, with no GCS download at switch time. Each `(:Tile)` node carries the `mapId` from which it was seeded (added as a property during publish). The diff is: old primary `mapId` cells − new primary `mapId` cells = `removedCells`; new − old = `addedCells`.  
**Alternatives considered**: Download both `.map.gram` files from GCS and diff in memory: adds GCS latency and re-parse cost at switch time. Not needed given cells are already in Neo4j.
