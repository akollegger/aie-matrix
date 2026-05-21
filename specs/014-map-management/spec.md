# Feature Specification: Map Management — Publish, Activate, and Archive

**Feature Branch**: `015-map-management`  
**Created**: 2026-05-17  
**Status**: Draft  
**Input**: User description: "Work on proposals/rfc/0013-map-management.md"

## Clarifications

### Session 2026-05-17

- Q: Does `POST /live` block until Neo4j seeding completes, or is seeding async/decoupled? → A: Seeding is decoupled from activation. `POST /maps` syncs all map cells into Neo4j at publish time (synchronous). `POST /live` activates an already-synced map — it only creates the session record and `:USES` edges. Session activation is only valid for maps whose cells are already present in Neo4j (guaranteed by a successful publish).
- Q: Which write happens first during `POST /maps`, and what is the failure behavior? → A: GCS upload first, then Neo4j cell sync. If GCS upload fails, nothing is written and the error is returned cleanly. If GCS succeeds but Neo4j sync fails, the map is NOT marked published and the operator must retry; the retry overwrites the GCS object idempotently.
- Q: Does re-publishing an archived map with identical content restore it to published, or does idempotency leave it archived? → A: Re-publishing always reverts an archived map to `published`, regardless of whether the content changed. Idempotency (no re-upload, no re-sync) applies only to already-published maps with unchanged content.
- Q: Should `POST /maps` enforce an application-level upload size limit, and is the `.items.json` sidecar parameter needed? → A: No application-level size limit — infrastructure (reverse proxy / load balancer) enforces it; document expected size range in Assumptions. The `itemsSidecar` parameter is dropped entirely: `.map.gram` files already encode item types, item placements, tile types, rules, and layers inline (see `maps/sandbox/canonical.map.gram`). No separate sidecar format is needed or supported.
- Q: Which services block their `/health` readiness on session binding, and what HTTP status indicates not-ready? → A: All three server processes (world-api, Colyseus, agent-host) return `503` from `/health` until their session binding is established. Kubernetes `readinessProbe` withholds traffic until the endpoint returns `200`.

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0013](../../proposals/rfc/0013-map-management.md) — Map Management — Publish, Activate, and Archive; [ADR-0007](../../proposals/adr/0007-three-tier-deployment.md) — Three-Tier Deployment Strategy
- **Scope Boundary**: Two HTTP resource surfaces in `server/world-api/`: `/maps/` for artifact lifecycle (publish, retrieve, archive) and `/live/` for live session management (start, switch maps, end). Includes ghost evacuation logic triggered by a map switch and server-process startup binding via `LIVE_SESSION_ID`. Implementation targets **Tier 1 (local dev)** — Neo4j via Docker Desktop, GCS local-file stub, Redis no-op.
- **Out of Scope**: Map versioning (authors use git); Tier 2/3 deployment — Dockerfiles, `docker-compose.yml` staging config, MinIO GCS substitute, Helm charts, and Kubernetes manifests are deferred to the [ADR-0007](../../proposals/adr/0007-three-tier-deployment.md) follow-on; any UI for map management (operator uses HTTP/CLI).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator Publishes a Map (Priority: P1)

An operator has a `.map.gram` file and wants to make it available for use in a live world session. They POST the file to the management API and receive confirmation that it is published and addressable by name.

**Why this priority**: Publishing is the prerequisite for every other operation. Nothing else in this feature can be tested without at least one published map.

**Independent Test**: Send `POST /maps` with a valid `.map.gram` file and a `mapId`. Confirm the map is retrievable via `GET /maps/:mapId` with `status: "published"` and that Neo4j contains `(:Tile)` nodes for the map's navigable cells. Item types and item placements defined in the gram file are also available via world-api after publish. No live session or ghost is required.

**Acceptance Scenarios**:

1. **Given** a valid `.map.gram` file and a unique `mapId`, **When** the operator POSTs to `/maps`, **Then** the response is `{ mapId, gcsPath, status: "published" }`, the map appears in `GET /maps?status=published`, and Neo4j contains `(:Tile)` nodes for each navigable cell in the artifact.
2. **Given** an already-published map with the same `mapId` and identical content, **When** the operator POSTs again, **Then** the response returns the existing record unchanged (idempotent — no duplicate upload).
3. **Given** a file with a missing `kind: "matrix-map"` header or cells without `h3Index`, **When** the operator POSTs to `/maps`, **Then** the server returns a validation error and no artifact is stored.

---

### User Story 2 — Operator Starts a Live Session (Priority: P2)

With at least one published map (whose cells are already in Neo4j), the operator starts a live session that binds the world to that map. Session activation is a lightweight operation — no seeding occurs. Connected services detect the session and begin serving the world graph already present in Neo4j.

**Why this priority**: A published map is inert until a session is started. Session creation notifies all services which map is active, making the world navigable immediately (cells were seeded at publish time).

**Independent Test**: POST to `/live` with a published `mapId`. Confirm `GET /live?status=active` returns the session with `status: "active"`. Confirm the world-api movement graph references cells from that map. No GCS download should occur at this step.

**Acceptance Scenarios**:

1. **Given** a published map whose cells are already in Neo4j, **When** the operator POSTs to `/live` with `{ name, maps: [{ mapId, role: "primary" }] }`, **Then** a session record is created, `[:USES]` edges are attached, and all subscribed services receive a `world.session-started` event on `aie-matrix:world-events`. No GCS download or Neo4j cell merge occurs at this step.
2. **Given** an archived or unknown `mapId`, **When** the operator POSTs to `/live`, **Then** the server returns `422` and no session is created.
3. **Given** a running server with `LIVE_SESSION_ID` set, **When** the process starts, **Then** it loads the primary map from GCS via `GET /live/{LIVE_SESSION_ID}` and does not read any local `.map.gram` file.
4. **Given** a running server with no `AIE_MATRIX_MAP` and no `LIVE_SESSION_ID` and exactly one active session, **When** the process starts, **Then** it loads that session's primary map automatically.
5. **Given** no `LIVE_SESSION_ID` and more than one active session, **When** the process starts, **Then** it fails loudly with a clear error message.

---

### User Story 3 — Operator Switches the Map on a Running Session (Priority: P3)

The world is live with attendees connected. The operator needs to change the active map — for example, moving from a conference-lobby map to a main-stage map — without dropping any WebSocket connections.

**Why this priority**: The live map switch is the highest-risk operation. It requires coordinated state changes across Neo4j, Redis pub/sub, world-api, Colyseus, and agent-host. It can be deferred to a follow-on if the session start/end path is solid.

**Independent Test**: With a running session and a second published map, PATCH the session's maps. Confirm `world.map-changed` is broadcast, `removedCells` are rejected by world-api's movement check, and any ghost on a removed cell is evacuated or enters limbo.

**Acceptance Scenarios**:

1. **Given** an active session using map A and a published map B, **When** the operator PATCHes `/live/:id/maps` with map B, **Then** world-api rejects `go` commands to `removedCells` with `CELL_NOT_IN_MAP`, and Colyseus broadcasts a `message.map-changed` room event to connected clients.
2. **Given** a ghost on a cell present in map A but removed in map B, and map B declares a `respawnCell`, **When** the map switch completes, **Then** the ghost is teleported to `respawnCell` (Neo4j position updated, Colyseus patch broadcast).
3. **Given** a ghost on a removed cell and map B has no `respawnCell`, **When** the map switch completes, **Then** the ghost enters limbo — `go` and `whereami` return `GHOST_IN_LIMBO` until the ghost issues a `go` to a valid cell.
4. **Given** speaker room claims on polygons removed by the map switch, **When** the switch completes, **Then** those claims are released and listeners in removed polygons exit listening state.

---

### User Story 4 — Operator Archives a Map and Ends a Session (Priority: P4)

The event is over. The operator ends the live session and archives the map so it no longer appears as an active artifact.

**Why this priority**: Clean lifecycle closure prevents stale sessions and archived maps from cluttering the active state. Can be tested entirely independently of the map switch path.

**Independent Test**: Start and then end a session via `DELETE /live/:id`. Confirm `GET /live?status=active` returns empty. Archive the map via `DELETE /maps/:mapId`. Confirm `GET /maps?status=published` no longer includes it.

**Acceptance Scenarios**:

1. **Given** an active session, **When** the operator DELETEs `/live/:id`, **Then** the session status becomes `"ended"`, a `world.session-ended` event is broadcast, and `GET /live?status=active` returns an empty list.
2. **Given** a map not referenced by any active session, **When** the operator DELETEs `/maps/:mapId`, **Then** the map status becomes `"archived"` and it no longer appears in `GET /maps?status=published`. The GCS artifact is retained.
3. **Given** a map that is the primary map of an active session, **When** the operator DELETEs `/maps/:mapId`, **Then** the server returns `409 Conflict` and the map remains published.

---

### Edge Cases

- What happens when a map is published with the same `mapId` as an archived map? → Always reverts to `"published"`. If content changed, GCS and Neo4j are re-written. If content is identical, status is updated to `"published"` without re-uploading or re-syncing (idempotency applies to the data writes, not the status transition).
- What happens if GCS upload fails during publish? → The publish fails cleanly; no Neo4j write occurs and the map is not created.
- What happens if GCS upload succeeds but the Neo4j cell sync fails? → The publish is considered failed; the map MUST NOT be marked `"published"`. The GCS object exists but is inert. On retry, the operator re-POSTs and the GCS object is overwritten idempotently before Neo4j sync is re-attempted.
- What happens if Neo4j seeding succeeds but the `world.session-started` broadcast fails? → The session record exists but services may not have reloaded. Services should poll `GET /live?status=active` on a heartbeat as a fallback (see RFC-0013 OQ-2).
- What happens if `LIVE_SESSION_ID` references a session that no longer exists or has ended? → Startup error; fail loudly with a clear message identifying the session ID.
- What if a map switch diff produces zero `removedCells` and zero `addedCells` (maps are identical)? → The operation is a no-op on the world graph; the broadcast still fires so downstream services can update their session record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an operator to publish a `.map.gram` artifact via HTTP, addressable by a logical `mapId`. Publishing performs two writes in order: (1) upload artifact to GCS, (2) sync navigable cells into Neo4j as `(:Tile)` nodes. Both must succeed for the map to be marked `"published"`. If GCS upload fails, no Neo4j write occurs. If Neo4j sync fails after a successful GCS upload, the map is NOT marked published; the operator retries and the GCS object is overwritten idempotently.
- **FR-002**: The system MUST validate `.map.gram` artifacts on publish: `kind: "matrix-map"` header, LayerStack walk, and all navigable cells having `h3Index`. Item types, item placements, tile types, and movement rules are encoded inline in the `.map.gram` — no separate sidecar file is accepted or required. Invalid artifacts MUST be rejected before any storage or Neo4j write occurs.
- **FR-003**: Publishing a map that is already `"published"` with unchanged content MUST be idempotent — the server returns the existing record without re-uploading to GCS or re-syncing Neo4j. Publishing a map that is `"archived"` MUST always restore it to `"published"`, re-syncing Neo4j cells if the content changed, and updating the status regardless.
- **FR-004**: The system MUST allow an operator to activate a live session referencing one or more published maps. Activation is a lightweight operation: it creates the session record and `[:USES]` edges in Neo4j, then notifies services via Redis pub/sub. No GCS download or cell seeding occurs at activation time — cells are guaranteed present from the publish step.
- **FR-004a**: Session activation MUST be rejected with `422` if any referenced map has not been successfully published (i.e., its cells are not present in Neo4j).
- **FR-005**: Starting a session with an unknown or archived `mapId` MUST be rejected with a `422` error.
- **FR-006**: The system MUST allow an operator to switch the primary map on a running session via a PATCH operation, without restarting any service process. The diff of `removedCells` and `addedCells` is computed from cells already in Neo4j — no GCS download is required at switch time.
- **FR-007**: After a map switch, world-api MUST reject movement commands targeting `removedCells` with `CELL_NOT_IN_MAP`.
- **FR-008**: Ghosts on `removedCells` after a map switch MUST be evacuated to the map's declared `respawnCell`, or placed in limbo if no `respawnCell` is declared. Limbo MUST persist until the ghost successfully moves to a valid cell.
- **FR-009**: Speaker room claims on polygons removed by a map switch MUST be released automatically.
- **FR-010**: The system MUST allow an operator to archive a map. Archiving a map referenced by an active session MUST be rejected with `409 Conflict`.
- **FR-011**: The system MUST allow an operator to end a live session. Ending a session MUST NOT archive its maps.
- **FR-012**: All `/maps/` and `/live/` endpoints MUST require authentication via `Authorization: Bearer {ADMIN_TOKEN}`.
- **FR-013**: Server processes (world-api, Colyseus, agent-host) MUST load their assigned map from the session specified by `LIVE_SESSION_ID` when that variable is set, and MUST NOT read map data from local disk in Tier 2/3 deployments.
- **FR-014**: When `LIVE_SESSION_ID` is not set and exactly one active session exists, server processes MUST load that session's primary map automatically. When multiple sessions exist, the absence of `LIVE_SESSION_ID` MUST be a startup error.

### Key Entities

- **Map**: A published artifact identified by `mapId`. Carries a GCS location, content hash (for idempotency), publication timestamp, and status (`published` | `archived`). One current artifact per `mapId`; history is in git.
- **LiveSession**: A binding between a named world and one or more maps. Carries a ULID, name, status (`active` | `ended`), and timestamps. References Maps via `[:USES { role }]` edges; initial implementation uses `role: "primary"` for the sole map.
- **Cell**: A navigable hex tile (H3 resolution 15) seeded into Neo4j from the primary map's `.map.gram` when a session starts or a map switch occurs.

### Interface Contracts

- **IC-001**: `POST /maps` — multipart form: `mapId` (string), `file` (.map.gram). No sidecar parameter. Response: `{ mapId, gcsPath, status }`. Item types, placements, tile types, and rules are read from the `.map.gram` itself.
- **IC-002**: `POST /live` — JSON body: `{ name: string, maps: [{ mapId, role }] }`. Response: full session object.
- **IC-003**: `PATCH /live/:id/maps` — JSON body: `{ maps: [{ mapId, role }] }`. Response: updated session object.
- **IC-004**: `world.map-changed` event on Redis channel `aie-matrix:world-events` — payload: `{ type, sessionId, maps, removedCells, addedCells }`. Channel constant MUST be extracted into `@aie-matrix/shared-types`.
- **IC-005**: `LIVE_SESSION_ID` env var — consumed by world-api, Colyseus, and agent-host at startup to identify the assigned session.
- **IC-006**: `/health` on world-api, Colyseus, and agent-host MUST return `503` until session binding is established (session loaded and map context available). Once ready, `/health` returns `200`. Kubernetes `readinessProbe` targets this endpoint; no traffic is routed to a service until it passes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can publish a map, start a session, and have ghost agents navigating the new world without restarting any server process.
- **SC-002**: A live map switch completes without dropping any active WebSocket connections; connected clients receive the `message.map-changed` room event.
- **SC-003**: A ghost on a removed cell is relocated to the respawn cell or enters limbo within one broadcast cycle of the map switch event — no ghost is left on a cell that no longer exists in the world graph.
- **SC-004**: Server processes started in Tier 2/3 with `LIVE_SESSION_ID` set never read a `.map.gram` file from local disk; all map data flows from GCS through the session record.
- **SC-005**: Archiving a map that is actively in use is rejected every time; no active session loses its primary map due to an archive operation.

## Assumptions

- **Tier 1 is the implementation target.** Neo4j runs locally via Docker Desktop. `GCS_BUCKET` unset → `GcsService` uses a local `tmp/gcs/` stub. `REDIS_URL` unset → `RedisPublishService` is a no-op. Tier 2/3 deployment (Dockerfiles, `docker-compose.yml`, MinIO, Helm, GCS credentials) is deferred to the ADR-0007 follow-on.
- **Neo4j required for map management.** When `NEO4J_URI` is unset, `/maps/` and `/live/` return `503` with a clear error. The existing `AIE_MATRIX_MAP` local-file path remains the Tier 1 fallback for running without any DB.
- `ADMIN_TOKEN` is a static env-var secret validated by equality check in an Effect-ts middleware layer. The long-term auth solution follows the "Authentication and Identity" open question in `docs/architecture.md` (see RFC-0013 OQ-6).
- `server/world-api/` owns both `/maps/` and `/live/` routes, exposed on the same port as existing MCP and registry routes.
- All route handlers use Effect-ts `Layer` / `Context.Tag` patterns per `docs/guides/effect-ts.md`. No globals, no `if (!service)` guards.
- The degenerate case (one session, one map, one world) is the v1 implementation target. The resource model is shaped for multi-session but initial implementation need only support one active session at a time.
- `respawnCell` in the map gram header is optional for v1; it will be required for conference-day maps before the event (RFC-0013 OQ-1).
- `.map.gram` files for conference maps are expected to be small (tens of KB at most). No application-level upload size limit is enforced; the infrastructure layer (reverse proxy or load balancer) provides the ceiling.
- `.items.json` sidecars are a legacy PoC artifact and are not supported by this feature. All item definitions and placements are authored inline in `.map.gram` (see `maps/sandbox/canonical.map.gram` for the canonical format).

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — Update the "Selected environment variables" table to include `LIVE_SESSION_ID`, `GCS_BUCKET`, and `ADMIN_TOKEN`. Update the "Map formats" section to reflect the GCS/Neo4j runtime path replacing the local-file path for Tier 2/3.
- `proposals/rfc/0013-map-management.md` — Update status from `draft` to `accepted` when this spec is approved.
- `server/world-api/README.md` — Add documentation for the `/maps/` and `/live/` endpoints and the `LIVE_SESSION_ID` / `ADMIN_TOKEN` env vars.
