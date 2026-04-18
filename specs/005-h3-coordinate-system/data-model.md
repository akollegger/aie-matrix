# Data Model: H3 Geospatial Coordinate System

**Feature**: 005-h3-coordinate-system  
**Date**: 2026-04-18

---

## Changed Types

### `CellId` (`server/colyseus/src/mapTypes.ts`)

**Before**:
```typescript
export type CellId = `${number},${number}`;
// e.g., "5,3"
```

**After**:
```typescript
export type CellId = string;  // H3 res-15 index, e.g. "8f2830828052d25"
```

The `CellId` type becomes a plain string branded with documented semantics. The template-literal constraint is removed because H3 index strings do not follow that pattern. Validation (valid H3 index, correct resolution) is enforced at map load time, not at the type level.

---

### `CellRecord` (`server/colyseus/src/mapTypes.ts`)

**Before**:
```typescript
export interface CellRecord {
  col: number;
  row: number;
  tileClass: string;
  neighbors: Partial<Record<Compass, CellId>>;
}
```

**After**:
```typescript
export interface CellRecord {
  col: number;          // Tiled column — retained for authoring, NOT used for graph traversal
  row: number;          // Tiled row — retained for authoring, NOT used for graph traversal
  h3Index: string;      // Canonical cell identity: H3 res-15 index string
  tileClass: string;
  neighbors: Partial<Record<Compass, string>>;  // values are H3 index strings
}
```

`col` and `row` are retained so the Phaser client's `tileCoords` backward-compat path can still read them, and so map authors can correlate debug output with Tiled coordinates.

---

### `LoadedMap` (`server/colyseus/src/mapTypes.ts`)

**Before**:
```typescript
export interface LoadedMap {
  width: number;
  height: number;
  cells: Map<CellId, CellRecord>;
}
```

**After**:
```typescript
export interface LoadedMap {
  width: number;
  height: number;
  cells: Map<string, CellRecord>;  // key is h3Index
  anchorH3: string;                // H3 index of Tiled (col=0, row=0)
}
```

The `cells` map is keyed by `h3Index`. `anchorH3` is stored for diagnostics and potential re-derivation.

---

### `TmjMapFile` (new internal type in `server/colyseus/src/mapLoader.ts`)

Represents the parsed `.tmj` JSON structure. Gains two required custom map-level properties:

```typescript
interface TmjCustomProperties {
  name: "h3_anchor" | "h3_resolution";
  type: "string" | "int";
  value: string | number;
}

interface TmjMapFile {
  width: number;
  height: number;
  tilesets: TmjTileset[];
  layers: TmjLayer[];
  properties?: TmjCustomProperties[];  // new: map-level custom properties
}
```

At load time, the loader extracts:
- `h3_anchor`: required string property; must be a valid H3 res-15 index
- `h3_resolution`: optional integer property; defaults to 15; must equal 15 if present

Missing or invalid `h3_anchor` causes `loadHexMap` to reject with a typed `MapLoadError`.

---

### `GhostRecord` (`server/registry/src/store.ts`)

**Before**:
```typescript
export interface GhostRecord {
  id: string;
  ghostHouseId: string;
  caretakerId: string;
  tileId: string;        // CellId "col,row" format
  status: "active" | "stopped";
}
```

**After**:
```typescript
export interface GhostRecord {
  id: string;
  ghostHouseId: string;
  caretakerId: string;
  h3Index: string;       // H3 res-15 index string (was tileId)
  status: "active" | "stopped";
}
```

`tileId` renamed to `h3Index`. All registry reads and writes must be updated. The registry is in-memory (no migration needed for persistence).

---

## Unchanged Types

### `Compass` (`shared/types/src/compass.ts`)

```typescript
export const COMPASS_DIRECTIONS = ["n", "s", "ne", "nw", "se", "sw"] as const;
export type Compass = (typeof COMPASS_DIRECTIONS)[number];
```

No change. Six compass labels remain valid; pentagon cells will simply have 5 of the 6 directions populated in their `neighbors` map.

---

### `WorldSpectatorState` (`server/colyseus/src/room-schema.ts`)

The Colyseus schema fields are **not renamed** (they remain `ghostTiles` and `tileCoords`). The values stored in `ghostTiles` change from `"col,row"` strings to H3 index strings. The `tileCoords` map is retained for Phaser client backward compatibility and populated from the CellRecord's `col`/`row` fields at broadcast time.

---

## Neo4j Node Schema

### Cell node

```
(:Cell {
  h3Index: string,    // identity property — unique, indexed
  col: integer,       // Tiled column (metadata only)
  row: integer,       // Tiled row (metadata only)
  tileClass: string
})
```

**Relationship types**:
- `(:Cell)-[:ADJACENT {direction: "n"|"s"|"ne"|"nw"|"se"|"sw"}]->(:Cell)` — compass neighbors
- `(:Cell)-[:PORTAL {name: string}]->(:Cell)` — pentagon portals and authored world portals
- `(:Cell)-[:ELEVATOR {name: string, display: string}]->(:Cell)` — vertical traversal

**Constraints**:
```cypher
CREATE CONSTRAINT cell_h3_unique IF NOT EXISTS FOR (c:Cell) REQUIRE c.h3Index IS UNIQUE;
```

---

## Pentagon Portals (Seeded at Startup)

At server startup, `h3.getPentagons(15)` returns the 12 global pentagon H3 indices at resolution 15. The server creates `(:PentagonPortal {h3Index: string})` nodes for each and establishes `PORTAL` relationships between all 12 (fully connected topology, default per research decision 4). These nodes are virtual — they do not appear in any loaded `.tmj` map. A ghost can enter the pentagon portal network only if a map cell happens to share an H3 index with a pentagon (extremely unlikely at venue scale; covered by synthetic tests only).

---

## `.tmj` Map File Extension

Two custom map-level properties are added to Tiled `.tmj` files:

| Property Name | Tiled Type | Required | Example Value | Notes |
|---|---|---|---|---|
| `h3_anchor` | string | Yes | `"8f2830828052d25"` | H3 res-15 index of Tiled (0,0) |
| `h3_resolution` | int | No | `15` | Defaults to 15; must be 15 if present |

**Validation at load time**:
- `h3_anchor` present and non-empty
- `h3.isValidCell(h3_anchor)` returns true
- `h3.getResolution(h3_anchor) === 15`
- `h3_resolution`, if present, equals 15

Failure in any check rejects map load with a `MapLoadError` carrying a descriptive message.
