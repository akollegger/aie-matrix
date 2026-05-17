# RFC-0013: Map Management — Publish, Activate, and Archive

**Status:** draft  
**Date:** 2026-05-17  
**Authors:** @akollegger  
**Related:** [ADR-0007](../adr/0007-three-tier-deployment.md) (three-tier deployment), [RFC-0009](0009-map-format-pipeline.md) (map format pipeline), [RFC-0012](0012-speaker-rooms.md) (speaker rooms)

## Summary

This RFC defines two HTTP resource surfaces for map lifecycle management in the aie-matrix world server: `/maps/` for artifact CRUD (publish, retrieve, archive) and `/live/` for live session management (binding a world to one or more maps). Map versioning is explicitly out of scope — the server treats each `mapId` as a single current artifact; authors use git for version history. The degenerate case (one live session, one map) is the initial implementation target; the resource model is shaped to accommodate multiple simultaneous worlds without a future refactor.

## Motivation

ADR-0007 establishes that maps are GCS artifacts with Neo4j as the runtime source of truth, and defers the management API to this RFC. Two problems must be solved:

1. **Maps need a lifecycle.** A map must be published before it can be used, and retired when it is superseded. Today this is done by setting `AIE_MATRIX_MAP` and restarting the process — which drops all WebSocket connections and doesn't work in multi-replica deployments.

2. **"Active map" is really a live session concept, not a map property.** Treating activation as a verb on a map resource (`/maps/activate`) conflates two distinct concerns: map artifact management and world configuration. Separating them allows the model to grow from one world/one map to many worlds/many maps without a breaking API change.

The degenerate case the initial implementation covers: one live session, one world, one map.

## Design

### Neo4j model

Maps and live sessions are separate nodes:

```
(:Map {
  mapId:       string,    // logical name — "freeplay", "moscone-west-l2"
  gcsPath:     string,    // gs://{GCS_BUCKET}/maps/{mapId}.map.gram
  contentHash: string,    // SHA-256; used for cache validation
  status:      "published" | "archived",
  publishedAt: datetime,
  archivedAt:  datetime?
})

(:LiveSession {
  id:     string,         // ULID
  name:   string,         // human label — "AIEWF 2026 Main"
  status: "active" | "ended",
  startedAt: datetime,
  endedAt:   datetime?
})-[:USES { role: "primary" }]->(:Map)
```

`mapId` is the unique key for `(:Map)`. Publishing overwrites the existing node and GCS object — there is one current artifact per `mapId`. Version history lives in git.

`[:USES]` carries a `role` property for future multi-map sessions (e.g., `"primary"`, `"floor-2"`, `"vendor-area"`). In the initial implementation every session has exactly one `[:USES]` edge with `role: "primary"`.

`World` is implicit in `LiveSession` (the `name` field) rather than a separate node. If persistent world identity across sessions becomes necessary, a `(:World)` node can be introduced without breaking the API surface.

### `/maps/` — artifact management

Standard HTTP verbs on the `maps` resource. All endpoints require `Authorization: Bearer {ADMIN_TOKEN}`.

#### `POST /maps`

Publish or replace a map artifact.

```
Content-Type: multipart/form-data
  mapId:         string            // logical name; becomes the Neo4j/GCS key
  file:          <.map.gram>       // artifact
  itemsSidecar?: <.items.json>     // optional; stored alongside if provided
```

Server steps:
1. Parse and validate the `.map.gram`: `kind: "matrix-map"` header, LayerStack walk, all navigable cells have `h3Index`.
2. Compute SHA-256. If an existing `(:Map { mapId })` has the same `contentHash`, return it unchanged (idempotent).
3. Upload to `gs://{GCS_BUCKET}/maps/{mapId}.map.gram` (overwrites any existing object).
4. Upsert `(:Map { mapId, gcsPath, contentHash, status: "published", publishedAt: now() })`.
5. Return `{ mapId, gcsPath, status: "published" }`.

#### `GET /maps`

List all maps. Optional `?status=published|archived` filter.

Returns `[{ mapId, status, publishedAt, gcsPath }]`.

#### `GET /maps/:mapId`

Return metadata for one map. `404` if not found.

#### `DELETE /maps/:mapId`

Archive a map. Rejects with `409` if the map is referenced by an active `LiveSession`.

Sets `status = "archived"`, `archivedAt = now()` in Neo4j. GCS object is retained.

### `/live/` — live session management

A live session is the binding between a running world and its maps.

All endpoints require `Authorization: Bearer {ADMIN_TOKEN}`.

#### `POST /live`

Start a live session.

```json
{
  "name": "AIEWF 2026 Main",
  "maps": [{ "mapId": "moscone-west-l2", "role": "primary" }]
}
```

Server steps:
1. Resolve each `mapId` to an existing `(:Map { status: "published" })`. Reject with `422` if any map is unknown or archived.
2. Create `(:LiveSession { id: ulid(), name, status: "active", startedAt: now() })`.
3. Create `[:USES { role }]` edges.
4. Seed Neo4j world graph from the primary map's `.map.gram` (download from GCS, merge `(:Cell)` nodes and relationships).
5. Broadcast `world.session-started` via Redis pub/sub. Payload: `{ sessionId, maps: [{ mapId, role }] }`.
6. Return the full session object (see `GET /live/:id`).

#### `GET /live`

List live sessions. Default: `?status=active`.

#### `GET /live/:id`

Return session detail:

```json
{
  "id": "01JVXYZ...",
  "name": "AIEWF 2026 Main",
  "status": "active",
  "startedAt": "2026-06-29T09:00:00Z",
  "world": { "name": "AIEWF 2026 Main" },
  "maps": [{ "mapId": "moscone-west-l2", "role": "primary", "gcsPath": "gs://..." }]
}
```

The `world` object is present in the response for API forward-compatibility even though it is not a separate Neo4j node in the initial implementation.

#### `PATCH /live/:id/maps`

Swap or update map associations on a running session. This is the live map switch operation.

```json
{
  "maps": [{ "mapId": "moscone-west-l3", "role": "primary" }]
}
```

Server steps:
1. Resolve new `mapId` values as above.
2. Compute `removedCells` and `addedCells` by diffing old and new primary maps.
3. Seed Neo4j from the new primary map (merge new cells; do **not** yet delete old cells — ghost evacuation runs first).
4. Delete old `[:USES]` edges, create new ones.
5. Broadcast `world.map-changed` via Redis pub/sub:
   ```json
   {
     "type": "world.map-changed",
     "sessionId": "...",
     "maps": [{ "mapId": "moscone-west-l3", "role": "primary" }],
     "removedCells": ["<h3Index>", ...],
     "addedCells": ["<h3Index>", ...]
   }
   ```
6. Return the updated session object.

#### `DELETE /live/:id`

End a live session.

1. Set `status = "ended"`, `endedAt = now()`.
2. Broadcast `world.session-ended` via Redis pub/sub.
3. Does not archive maps; map lifecycle is independent.

### Service startup and session binding

Session binding differs by consumer type:

**Server processes** (world-api, Colyseus, ghost-house) are told their session at deploy time via `LIVE_SESSION_ID`. They do not discover sessions — they are assigned one.

```
if AIE_MATRIX_MAP is set:
  # Tier 1 — local dev; load from local file, no session needed
  loadFromFile(AIE_MATRIX_MAP)
elif LIVE_SESSION_ID is set:
  # Tier 2/3 — load primary map from assigned session
  session = GET /live/{LIVE_SESSION_ID}
  primaryMap = session.maps.find(m => m.role === "primary")
  loadFromGCS(primaryMap.gcsPath)
else:
  # Tier 2/3 with single session (degenerate case convenience)
  sessions = GET /live?status=active
  if sessions.length != 1: fail loudly
  # same as above from here
```

The "take first if exactly one" path is a Tier 1/2 convenience for the simple case. In any deployment with more than one active session, `LIVE_SESSION_ID` is required and its absence is a startup error, not a guess.

Both load paths call the same internal `loadHexMap(bytes, options)`.

**Browser clients** (Intermedium) discover sessions via `GET /live?status=active` and handle the result themselves:
- If the client has a stored session ID (localStorage), it attempts to re-join that session.
- If the stored session is no longer active, or if this is a first visit, the client presents the list of active sessions and lets the attendee choose.
- The chosen session ID is stored for reconnection.

This means clients are resilient to session restarts without any server-side "last known session" tracking.

### `world.map-changed` handling per service

**world-api:** Rebuilds in-memory movement graph and cell index. Applies ghost evacuation (below). Rejects movement commands on `removedCells` with `CELL_NOT_IN_MAP`.

**Colyseus:** Removes `ghostTiles` entries for ghosts on `removedCells`. Broadcasts a `message.map-changed` room event to connected clients with `removedCells` and `addedCells`.

**ghost-house:** Delivers `aie-matrix.world-event.v1` of type `world.map-changed` to each adopted ghost agent.

### Ghost evacuation

Ghosts on `removedCells` after a map switch cannot remain there. A map may declare a `respawnCell` in its gram header:

```gram
{ kind: "matrix-map", name: "Moscone West L2", respawnCell: h3`8f2830828052d25` }
```

If present: ghosts on removed cells are teleported to `respawnCell` — Neo4j position updated, Colyseus patch broadcast, `world.map-changed` event delivered to the agent.

If absent: affected ghosts enter **limbo** — their position is retained but `go` and `whereami` return `GHOST_IN_LIMBO` until they issue `go` with a valid target. This preserves sessions without requiring every map to declare a respawn point.

**Speaker rooms (RFC-0012):** Claims on polygons removed by the map switch are released automatically. Listening ghosts in removed polygons exit listening state.

## Open Questions

1. **`respawnCell` required or optional for production?** Making it required enforces deliberate design; optional is forgiving for early maps. Recommendation: optional now, required before conference-day maps are activated.

2. **Map switch atomicity.** If Neo4j seeding succeeds but the Redis `world.map-changed` broadcast fails, the session record is updated but services haven't reloaded. Mitigation: services should poll `GET /live?status=active` on a 30-second heartbeat as a fallback to the push event.

3. **Tier 2 GCS substitute.** docker-compose staging doesn't naturally have GCS credentials. Options: a MinIO container as a GCS-compatible backend, or inject real GCS credentials into the Compose environment. MinIO is closer to operational simplicity; real GCS is closer to Tier 3 parity.

4. ~~**Multiple simultaneous sessions.**~~ **Resolved.** Server processes receive their session assignment via `LIVE_SESSION_ID` at deploy time; they do not discover sessions. Browser clients store their last session ID and re-join on reconnect, or present a session picker on first visit. The "take first active session" path is retained only as a single-session convenience for Tier 1/2.

5. **Speaker room state across map switch.** If a polygon's geometry changes in the new map (same name, different cell set), existing listeners in the still-present polygon are not re-evaluated. Only ghosts on fully removed polygons are released. Is this the right behaviour?

## Alternatives

**`/admin/maps/<verb>/` action endpoints.** The original draft used `POST /admin/maps/publish`, `POST /admin/maps/activate/:id`, etc. Rejected: verbs-as-paths don't compose. Adding a second world or a second map requires new verbs rather than new resource instances. Standard HTTP verbs on resource paths scale naturally.

**`AIE_MATRIX_MAP` + rolling restart.** No new API; change the env var, redeploy. Rejected: a rolling restart drops WebSocket connections, takes 2–5 minutes, and doesn't work across replicas that share no filesystem.

**Map versioning server-side.** Track every published artifact as an immutable version record. Rejected by the author: versioning belongs in git. The server tracks one current artifact per `mapId`; overwriting is explicit and intentional.

**`World` as an explicit Neo4j entity.** A `(:World)` node as an intermediate between `LiveSession` and `Map`. Deferred: the `world` key already appears in the `GET /live/:id` response body, so the API shape supports it. The backing node can be added without breaking the contract when persistent world identity across sessions is needed.

**Redis as the session store (not Neo4j).** Store the active session in Redis for faster reads. Rejected: Redis is ephemeral coordination (ADR-0007 § Source-of-truth hierarchy). A Redis restart would drop the session record and leave all services unable to start. Neo4j Aura is the correct store for persistent world state.

## Related Decisions

- **[ADR-0007: Three-Tier Deployment Strategy](../adr/0007-three-tier-deployment.md)** — establishes GCS as the artifact store and Neo4j as the runtime source of truth; this RFC implements the map lifecycle that ADR-0007 defers.
- **[RFC-0009: Map Format Pipeline](0009-map-format-pipeline.md)** — `.map.gram` artifacts produced by the `tmj-to-gram` CLI are the input to `POST /maps`.
- **[RFC-0012: Speaker Rooms](0012-speaker-rooms.md)** — room claims and listening state must be released cleanly when a map switch removes or changes the polygon geometry that backs a named room.
