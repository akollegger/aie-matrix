# Data Model: Map Management

**Branch**: `015-map-management` | **Date**: 2026-05-17

## Neo4j Nodes

### `:Map`

Represents a published artifact. One node per `mapId`; overwritten on re-publish.

| Property | Type | Constraints | Notes |
|---|---|---|---|
| `mapId` | string | UNIQUE | Logical name; GCS key; user-supplied |
| `gcsPath` | string | | `gs://{GCS_BUCKET}/maps/{mapId}.map.gram` |
| `contentHash` | string | | Implementer-chosen hash; used for idempotency check on re-publish |
| `status` | `"published"` \| `"archived"` | | Transitions: published → archived → published |
| `publishedAt` | datetime | | Set on every publish (including re-publish of archived) |
| `archivedAt` | datetime? | | Set on archive; cleared on re-publish |

**Constraint**: `CREATE CONSTRAINT map_mapid_unique IF NOT EXISTS FOR (m:Map) REQUIRE m.mapId IS UNIQUE`

**State transitions**:
```
[none] --POST /maps--> published
published --DELETE /maps/:mapId--> archived    (rejected if active session references it)
archived --POST /maps--> published             (always; content re-synced if changed)
published --POST /maps (same content)--> published  (idempotent; no writes)
```

---

### `:LiveSession`

Represents a binding between a named world and one or more maps.

| Property | Type | Constraints | Notes |
|---|---|---|---|
| `id` | string (ULID) | UNIQUE | Generated at session creation |
| `name` | string | | Human label; e.g. "AIEWF 2026 Main" |
| `status` | `"active"` \| `"ended"` | | `active` sessions receive traffic; `ended` are archived |
| `startedAt` | datetime | | Set at creation |
| `endedAt` | datetime? | | Set on `DELETE /live/:id` |

**Constraint**: `CREATE CONSTRAINT livesession_id_unique IF NOT EXISTS FOR (s:LiveSession) REQUIRE s.id IS UNIQUE`

**State transitions**:
```
[none] --POST /live--> active
active --DELETE /live/:id--> ended
```

---

### `:TileType`

A tile class definition from a `.map.gram` file. Scoped to a single map. Linked from `(:Map)` via `[:DEFINES { order }]`. Deleted and recreated on re-publish so removed types don't linger.

| Property | Type | Notes |
|---|---|---|
| `mapId` | string | Scope key — part of composite unique constraint `(mapId, identity)` |
| `identity` | string | Gram identity (e.g. `"blue"`) |
| `typeName` | string | Label used as `tileClass` on `(:Tile)` nodes (e.g. `"Blue"`) |
| `name` | string | Human display name |
| `description` | string? | Optional description |
| `capacity` | integer? | Max ghosts per tile |
| `cssStyle` | string? | Raw CSS string from `css\`...\`` literal — re-emit with `css\`\`` wrapper on round-trip |

**Constraint**: `CREATE CONSTRAINT tiletype_map_identity_unique IF NOT EXISTS FOR (t:TileType) REQUIRE (t.mapId, t.identity) IS UNIQUE`

---

### `:ItemType`

An item class definition from a `.map.gram` file. Scoped to a single map. Same lifecycle as `:TileType`.

| Property | Type | Notes |
|---|---|---|
| `mapId` | string | Scope key |
| `identity` | string | Gram identity (e.g. `"badge-sponsor"`) |
| `typeName` | string | Label used in gram (e.g. `"Badge"`) |
| `name` | string | Human display name |
| `description` | string? | Optional description |
| `charGlyph` | string? | Raw char string from `char\`...\`` literal — re-emit with `char\`\`` wrapper on round-trip |
| `takeable` | boolean? | Whether a ghost can pick it up |
| `capacityCost` | integer? | Inventory slots consumed |

**Constraint**: `CREATE CONSTRAINT itemtype_map_identity_unique IF NOT EXISTS FOR (t:ItemType) REQUIRE (t.mapId, t.identity) IS UNIQUE`

---

### `:Tile` (seeded at publish time)

A thing that occupies an H3 coordinate in the world. The `h3Index` is a coordinate attribute, not an identity. Seeded from `.map.gram` during `POST /maps`.

| Property | Type | Notes |
|---|---|---|
| `h3Index` | string | Unique coordinate key (constraint `tile_h3_unique`) |
| `tileClass` | string | Tile type label from the gram (e.g. `"Blue"`, `"Red"`, `"Pentagon"`) — matches `TileType.typeName` |
| `sourceMapId` | string | `mapId` of the map that seeded this tile; used for map-switch tile diff |

---

## Neo4j Relationships

### `(:LiveSession)-[:USES { role }]->(:Map)`

Links a session to its maps. `role: "primary"` is the only value in v1.

| Property | Type | Notes |
|---|---|---|
| `role` | `"primary"` | Extensible for future multi-map sessions |

---

## Cypher Reference Queries

### Publish a map (upsert)
```cypher
MERGE (m:Map { mapId: $mapId })
SET m.gcsPath = $gcsPath,
    m.contentHash = $contentHash,
    m.status = "published",
    m.publishedAt = datetime(),
    m.archivedAt = null
RETURN m
```

### Seed cells from a map (idempotent)
```cypher
UNWIND $cells AS cell
MERGE (c:Tile { h3Index: cell.h3Index })
SET c.sourceMapId = $mapId,
    c.tileClass = cell.tileClass
```
*(additional cell properties set as needed by the `.map.gram` LayerStack walk)*

### Archive a map
```cypher
MATCH (m:Map { mapId: $mapId })
WHERE NOT EXISTS {
  MATCH (s:LiveSession)-[:USES]->(m) WHERE s.status = "active"
}
SET m.status = "archived", m.archivedAt = datetime()
RETURN m
```
*(returns null if map is in an active session — caller returns 409)*

### Start a live session
```cypher
MATCH (m:Map { mapId: $mapId, status: "published" })
CREATE (s:LiveSession {
  id: $sessionId,
  name: $name,
  status: "active",
  startedAt: datetime()
})
CREATE (s)-[:USES { role: $role }]->(m)
RETURN s, m
```

### Switch map on a session (PATCH /live/:id/maps)
```cypher
// Step 1: get old primary map cells
MATCH (s:LiveSession { id: $sessionId })-[:USES { role: "primary" }]->(oldMap:Map)
MATCH (oldCell:Tile { sourceMapId: oldMap.mapId })
RETURN collect(oldCell.h3Index) AS oldCells, oldMap.mapId AS oldMapId

// Step 2: get new primary map cells
MATCH (newCell:Tile { sourceMapId: $newMapId })
RETURN collect(newCell.h3Index) AS newCells

// Step 3: update edges
MATCH (s:LiveSession { id: $sessionId })-[r:USES { role: "primary" }]->()
DELETE r
WITH s
MATCH (newMap:Map { mapId: $newMapId })
CREATE (s)-[:USES { role: "primary" }]->(newMap)
```

### End a session
```cypher
MATCH (s:LiveSession { id: $sessionId, status: "active" })
SET s.status = "ended", s.endedAt = datetime()
RETURN s
```

---

## GCS Artifact Layout

```
gs://{GCS_BUCKET}/
└── maps/
    ├── {mapId}.map.gram       ← artifact; overwritten on re-publish
    └── ...
```

No versioning in GCS. Version history is in git. GCS object ACLs: private; world-api reads via service account ADC.

---

## Effect-ts Service Interfaces (abbreviated)

### `MapManagementService`
```typescript
interface MapManagementOps {
  publish(mapId: string, bytes: Buffer): Effect.Effect<MapRecord, MapPublishError | GcsError>
  list(status?: "published" | "archived"): Effect.Effect<readonly MapRecord[], never>
  get(mapId: string): Effect.Effect<MapRecord, MapNotFoundError>
  archive(mapId: string): Effect.Effect<void, MapNotFoundError | MapAlreadyActiveError>
}
```

### `LiveSessionService`
```typescript
interface LiveSessionOps {
  start(name: string, maps: Array<{ mapId: string; role: string }>): Effect.Effect<SessionRecord, LiveSessionError>
  list(status?: "active" | "ended"): Effect.Effect<readonly SessionRecord[], never>
  get(id: string): Effect.Effect<SessionRecord, SessionNotFoundError>
  switchMaps(id: string, maps: Array<{ mapId: string; role: string }>): Effect.Effect<SessionRecord, LiveSessionError>
  end(id: string): Effect.Effect<void, SessionNotFoundError>
}
```

### `GcsService`
```typescript
interface GcsOps {
  upload(objectPath: string, body: Buffer): Effect.Effect<string, GcsError>  // returns gs:// URL
  download(objectPath: string): Effect.Effect<Buffer, GcsError>
}
```

### `RedisPublishService`
```typescript
interface RedisPublishOps {
  publish(channel: string, payload: unknown): Effect.Effect<void, never>  // never fails; logs on error
}
```
