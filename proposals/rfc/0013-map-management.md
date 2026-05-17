# RFC-0013: Map Management — Publish, Activate, and Archive

**Status:** draft  
**Date:** 2026-05-17  
**Authors:** @akollegger  
**Related:** [ADR-0007](../adr/0007-three-tier-deployment.md) (three-tier deployment), [RFC-0009](0009-map-format-pipeline.md) (map format pipeline), [RFC-0012](0012-speaker-rooms.md) (speaker rooms)

## Summary

This RFC defines the lifecycle API for `.map.gram` map artifacts in the aie-matrix world: how an operator publishes a new map to the cluster, switches the active map while the world is live, and archives a retired map. It replaces the `AIE_MATRIX_MAP` startup file-read pattern in Tier 2/3 deployments (ADR-0007) with a managed lifecycle backed by GCS (artifact store) and Neo4j (active-map pointer and world graph). Ghost evacuation policy — what happens to ghosts on cells that cease to exist when a map switch occurs — is a first-class concern of this RFC.

## Motivation

ADR-0007 establishes that maps are authored artifacts stored in GCS and seeded into Neo4j at publish time; the "active map" is a Neo4j pointer that all services read from at startup and on change. Nothing currently implements this: world-api reads a local `.map.gram` at startup from `AIE_MATRIX_MAP`, and there is no mechanism to switch maps without restarting the process.

This creates three concrete problems:

1. **Multi-replica deployments are broken for map changes.** Two Colyseus replicas reading different local files is a split-brain. The only safe change today is a rolling restart with a new `AIE_MATRIX_MAP` value — which is a deploy, not a configuration change.
2. **Live map switching is impossible.** Conference-day operation may require switching from a rehearsal map to the production Moscone floor plan, or switching between floor maps as the day progresses. A rolling restart is too slow and drops all WebSocket connections.
3. **Map versions are untracked.** There is no record of which map was active when, who published it, or what its content hash was. This makes post-conference replay and debugging harder.

## Design

### Neo4j map registry

All published maps are recorded in Neo4j. The `(:ActiveMap)` singleton points to the currently live version:

```
(:MapVersion {
  id:          string,   // ULID — stable identifier across the cluster
  mapId:       string,   // logical name, e.g. "freeplay", "moscone-west-l2"
  version:     string,   // author-supplied semver or timestamp label
  gcsPath:     string,   // gs://{GCS_BUCKET}/maps/{mapId}/{id}.map.gram
  contentHash: string,   // SHA-256 of the .map.gram file
  status:      "published" | "active" | "archived",
  publishedAt: datetime,
  activatedAt: datetime?,
  archivedAt:  datetime?
})

(:ActiveMap { singleton: true })-[:POINTS_TO]->(:MapVersion)
```

`(:ActiveMap)` has at most one `POINTS_TO` edge. Switching the active map is an atomic Neo4j write: delete the old edge, create the new one.

### Admin HTTP surface

All map management endpoints live under `/admin/maps` and require an operator bearer token (`Authorization: Bearer {ADMIN_TOKEN}`). Ghosts have no access to these endpoints; their MCP tool surface is unchanged.

`ADMIN_TOKEN` is injected as a Kubernetes `Secret` in Tier 3, a docker-compose `Secret` in Tier 2, and a `.env` value in Tier 1.

#### `POST /admin/maps/publish`

Upload and register a new map version. Does **not** activate it.

```
Content-Type: multipart/form-data
  file:        <.map.gram binary>
  mapId:       string            // logical name
  version:     string            // author label
  itemsSidecar?: <.items.json binary>   // optional; falls back to embedded items in gram
```

Server steps:
1. Parse and validate the `.map.gram`: `kind: "matrix-map"` header, LayerStack walk, all cells have `h3Index`, no duplicate indices.
2. Compute SHA-256 of the file. If a `MapVersion` with the same `contentHash` already exists, return it (idempotent).
3. Upload to GCS: `gs://{GCS_BUCKET}/maps/{mapId}/{ulid()}.map.gram`.
4. If `itemsSidecar` provided, upload alongside: `gs://{GCS_BUCKET}/maps/{mapId}/{id}.items.json`.
5. Create `(:MapVersion { ..., status: "published" })` in Neo4j.
6. Return `{ id, mapId, version, gcsPath, status: "published" }`.

Validation failures return `400` with a structured error listing the offending cells or layers.

#### `POST /admin/maps/activate/:mapVersionId`

Make a published map version the live world. This is the operation with the most operational impact.

Server steps:
1. Fetch `(:MapVersion { id: mapVersionId })` from Neo4j; reject with `404` if not found, `409` if already active.
2. Download `.map.gram` from GCS.
3. **Seed Neo4j** — within a transaction:
   - Merge `(:Cell { h3Index })` nodes for every cell in the new map.
   - Merge adjacency `[:ADJACENT]` edges.
   - Merge portal/elevator `[:PORTAL | :ELEVATOR]` relationships.
   - Do **not** delete cells from the previous map yet — ghosts may still be on them (see evacuation below).
4. **Update active-map pointer** — in the same transaction: delete `(:ActiveMap)-[:POINTS_TO]->` old, create `(:ActiveMap)-[:POINTS_TO]->` new.
5. Set old `MapVersion.status = "published"`, new `MapVersion.status = "active"`.
6. **Broadcast `world.map-changed`** via Redis pub/sub. Payload:
   ```json
   {
     "type": "world.map-changed",
     "mapVersionId": "<new id>",
     "mapId": "<new mapId>",
     "removedCells": ["<h3Index>", ...],   // cells in old map not in new map
     "addedCells": ["<h3Index>", ...]      // cells in new map not in old map
   }
   ```
7. Return `{ id, mapId, version, status: "active", evacuatedGhostCount }`.

#### `POST /admin/maps/archive/:mapVersionId`

Retire a published (not active) map version.

1. Reject with `409` if the version is currently active.
2. Set `MapVersion.status = "archived"`, `archivedAt = now()` in Neo4j.
3. GCS object is **not deleted** (retained for audit and replay).

#### `GET /admin/maps`

List all map versions with status. Supports `?status=published|active|archived` filter.

#### `GET /admin/maps/active`

Return the currently active `MapVersion` metadata. Used by services at startup to determine which map to load.

### Service startup (replacing `AIE_MATRIX_MAP`)

At startup, each service determines which map to use:

```
if AIE_MATRIX_MAP is set:
  # Tier 1 — local dev
  load from local file path
  optionally seed Neo4j if SEED_NEO4J=true
else:
  # Tier 2/3 — fetch active map from Neo4j
  query: MATCH (:ActiveMap)-[:POINTS_TO]->(m:MapVersion) RETURN m
  if no record found: fail with clear error ("no active map — run POST /admin/maps/activate first")
  download .map.gram from m.gcsPath
  load from downloaded bytes
```

Both paths call the same internal `loadHexMap(bytes, options)` function. No branching in business logic.

### `world.map-changed` handling per service

When a service receives the Redis `world.map-changed` broadcast:

**world-api:**
- Downloads new `.map.gram` from GCS (already in Neo4j from the activate step).
- Rebuilds in-memory movement graph and cell index.
- Rejects movement commands referencing `removedCells` with `CELL_NOT_IN_MAP`.
- Applies ghost evacuation (see below).

**Colyseus:**
- Updates `ghostTiles` schema — removes entries for ghosts on `removedCells`.
- Broadcasts a `message.map-changed` room event to all connected clients with the `removedCells` and `addedCells` arrays.
- Colyseus does not re-download the map; it trusts world-api as the movement authority.

**ghost-house:**
- Delivers a `aie-matrix.world-event.v1` of type `world.map-changed` to each adopted ghost agent, including the `removedCells` list, so agents can re-plan if their current cell was removed.

### Ghost evacuation policy

When the active map changes, ghosts whose current cell is in `removedCells` (exists in the old map but not the new one) must be handled. Two invariants must hold:

1. No ghost may persist on a cell that does not exist in the active map's Neo4j graph.
2. Evacuation must not drop ghost sessions or lose ghost state.

**Evacuation procedure:**

Each `.map.gram` may declare a `respawnCell` in its document header:

```gram
{ kind: "matrix-map", name: "Moscone West L2", respawnCell: h3`8f2830828052d25` }
```

If present, all ghosts on removed cells are teleported to the `respawnCell` in the new map. The teleport is:
- Written to Neo4j (`GhostPosition` updated).
- Broadcast as a Colyseus `ghostTiles` patch.
- Delivered to the ghost agent as a `world.map-changed` event (the agent discovers its new position on next `whereami`).

If `respawnCell` is absent, ghosts on removed cells are placed in a **limbo state**: they retain their position record but `go` and `whereami` return a `GHOST_IN_LIMBO` error until the ghost issues `go` with a valid target cell. This preserves ghost sessions without requiring a respawnCell to be authored.

**Speaker rooms (RFC-0012):** If a speaker ghost's claimed room polygon is removed in the new map, the claim is released automatically and the ghost transitions back to `"attendee"` role. Listening ghosts in the removed polygon are also released from listening state.

### Operational sequencing for a live map switch

A safe map switch sequence in production:

```
1. Pause new ghost adoptions (optional but recommended — set a flag via /admin/adoptions/pause)
2. POST /admin/maps/publish  → get mapVersionId
3. POST /admin/maps/activate/:mapVersionId
   → world.map-changed fires; services update; ghost evacuation runs
4. Resume ghost adoptions
5. POST /admin/maps/archive/:previousMapVersionId  (when confident)
```

Steps 1 and 4 are operational policy, not enforced by the API. The API is safe to call without them; pausing adoptions just avoids ghosts adopting during the brief (~seconds) window between the pointer swap and service updates.

### Tier 1 (local dev) behaviour unchanged

`AIE_MATRIX_MAP` continues to work exactly as today. No changes to the local dev workflow. `pnpm dev` reads the file, optionally seeds Neo4j, and runs. The `/admin/maps/*` endpoints exist but are only needed if the developer wants to test the publish workflow locally.

## Open Questions

1. **Evacuation: respawnCell vs limbo** — should `respawnCell` be required or remain optional? Requiring it enforces a deliberate design decision in every map; making it optional is more forgiving for early maps but means limbo is a real operational state. Recommendation: optional for now, required before any map goes to production.

2. **Activate atomicity** — if Neo4j seeding succeeds but the Redis broadcast fails (Redis is briefly unavailable), the pointer is updated but services haven't reloaded. Should the activate step roll back? Or should services poll for pointer changes on a short interval as a fallback? Recommendation: services should poll `GET /admin/maps/active` on a 30-second heartbeat as a fallback to the Redis event.

3. **Partial map switch** — can two maps be active simultaneously across different "zones" (e.g., different floors of Moscone West)? The current design assumes one global active map. Multi-zone maps (one map per floor) might be better modeled as separate `mapId` values, each with their own `(:ActiveMap)` node, rather than a single global pointer. This is a significant design fork — raise as a separate RFC if needed.

4. **GCS access in Tier 2** — docker-compose staging doesn't naturally have GCS credentials. Should Tier 2 use a local MinIO container as a GCS-compatible backend, or should it use a real GCS bucket (with credentials injected)? MinIO is simpler operationally; real GCS is closer to Tier 3 parity.

5. **Speaker room state across a map switch** — RFC-0012 defines `ClaimRule` as checking cell membership in the polygon. If the polygon geometry changes in the new map (different cell set for Hall A), should existing listening ghosts be re-evaluated? The current proposal releases claims on removed polygons; listeners in still-present polygons are not affected.

6. **Map switch rate limiting** — should the API enforce a minimum time between activations to prevent operators from rapidly cycling maps? A 30-second cooldown would give services time to fully load the new map before another switch is attempted.

## Alternatives

**`AIE_MATRIX_MAP` + rolling restart.** Change the env var, trigger a rolling deploy. No new API surface, no evacuation logic. Rejected: a rolling restart in Kubernetes drops WebSocket connections (Colyseus sessions), takes 2–5 minutes per service, and is unacceptably disruptive for a live conference. It also doesn't solve the multi-replica split-brain.

**Map as Colyseus room configuration.** The active map is a Colyseus server config; switching is a Colyseus Admin API call. Rejected: this makes Colyseus the source of truth for the map, contradicting the ADR-0007 hierarchy where Neo4j is the runtime source of truth. world-api would need to poll Colyseus for the current map config.

**Redis as the map store (not Neo4j).** Store the active map pointer in Redis instead of Neo4j — faster reads, automatic expiry. Rejected: Redis is ephemeral coordination, not persistent world state (ADR-0007 § Source-of-truth hierarchy). A Redis restart would erase the active-map pointer, forcing a manual re-activation. Neo4j Aura is the appropriate store for persistent world state.

**Git-based map deployment.** Maps are merged via PR; CI triggers publish + activate. Adds review and audit trail; publish is a CI step, not an HTTP call. A viable future addition, but not appropriate as the primary mechanism for a live event where map corrections may need to happen in minutes, not pull-request-review time.

**Polling instead of Redis pub/sub for `world.map-changed`.** Services poll `GET /admin/maps/active` on a short interval rather than receiving a push event. Simpler (no Redis dependency for this specific feature), but introduces up to the poll interval of lag during which replicas hold inconsistent map state. Redis pub/sub gives near-instant consistency across replicas, which is important for ghost evacuation correctness.

## Related Decisions

- **[ADR-0007: Three-Tier Deployment Strategy](../adr/0007-three-tier-deployment.md)** — establishes GCS as the artifact store and Neo4j as the runtime source of truth; this RFC implements the map lifecycle that ADR-0007 defers.
- **[RFC-0009: Map Format Pipeline](0009-map-format-pipeline.md)** — `.map.gram` artifacts produced by the `tmj-to-gram` CLI are the input to `POST /admin/maps/publish`.
- **[RFC-0012: Speaker Rooms](0012-speaker-rooms.md)** — room claims and listening state must be released cleanly when a map switch removes or changes the polygon geometry that backs a named room.
