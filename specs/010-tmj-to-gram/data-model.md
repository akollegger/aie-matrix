# Data Model: Map Format Pipeline (010-tmj-to-gram)

**Branch**: `010-tmj-to-gram` | **Date**: 2026-04-25

## Overview

This document defines the entities, data structures, and state transitions for the `tmj-to-gram` CLI pipeline and the `MapService` HTTP layer. Two new packages are introduced: `tools/tmj-to-gram` (build-time CLI) and `server/world-api/src/map/` (runtime service + routes).

---

## Build-Time Entities (tools/tmj-to-gram)

### `TmjDocument` (input)

The parsed content of a Tiled `.tmj` file. Relevant fields consumed by the converter:

| Field | Type | Notes |
|---|---|---|
| `width` | `number` | Number of tile columns |
| `height` | `number` | Number of tile rows |
| `tilewidth` | `number` | Pixel width of each tile |
| `tileheight` | `number` | Pixel height of each tile |
| `hexsidelength` | `number` | Pixel length of hex side |
| `staggeraxis` | `"x" \| "y"` | Hex stagger axis |
| `staggerindex` | `"odd" \| "even"` | Hex stagger index |
| `properties` | `TmjProperty[]` | Map-level custom properties |
| `layers` | `TmjLayer[]` | Tile and object layers |
| `tilesets` | `TmjTilesetRef[]` | External `.tsx` source references |

### `TmjProperty` (input)

| Field | Type | Extracted values |
|---|---|---|
| `name` | `string` | `h3_anchor`, `h3_resolution`, `elevation`, `map_name` |
| `type` | `string` | `"string"`, `"int"` |
| `value` | `string \| number` | Property value |

### `TmjLayer` (input)

Two concrete shapes:

**Tile layer** (`type: "tilelayer"`, `class: "layout"` or `"item-placement"`):

| Field | Type |
|---|---|
| `type` | `"tilelayer"` |
| `class` | `"layout" \| "item-placement"` |
| `name` | `string` (informational only) |
| `data` | `number[]` (GID array, row-major, 0 = empty) |
| `width` | `number` |
| `height` | `number` |

**Object layer** (`type: "objectgroup"`, `class: "tile-area"`):

| Field | Type |
|---|---|
| `type` | `"objectgroup"` |
| `class` | `"tile-area"` |
| `objects` | `TmjObject[]` |

### `TmjObject` (input)

| Field | Type | Notes |
|---|---|---|
| `id` | `number` | Unique within the map |
| `name` | `string` | Author-assigned name |
| `type` | `string` | Tile type label (e.g. `"Red"`) |
| `x` | `number` | Pixel x of object origin |
| `y` | `number` | Pixel y of object origin |
| `width` | `number` | For rectangles |
| `height` | `number` | For rectangles |
| `ellipse` | `boolean \| undefined` | If true → conversion error |
| `polygon` | `{x: number, y: number}[] \| undefined` | Polygon vertex offsets |

Rectangle shape: `polygon` is absent, `width`/`height` > 0. Synthesize four corners: `(x,y)`, `(x+w,y)`, `(x+w,y+h)`, `(x,y+h)`.

### `TsxTileset` (input — parsed from `.tsx` via `fast-xml-parser`)

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Tileset name |
| `tiles` | `TsxTile[]` | Tile definitions |

### `TsxTile` (input)

| Field | Type | Notes |
|---|---|---|
| `id` | `number` | Tile local ID within tileset |
| `type` | `string` | Tile type label (e.g. `"Blue"`) |
| `properties` | `{name: string, value: unknown}[]` | Custom properties (`color`, `capacity`, etc.) |

### `ItemSidecar` (input — `*.items.json`)

A JSON object mapping item reference keys to item definitions:

```typescript
type ItemSidecar = Record<string, {
  name: string;
  itemClass: string;       // used as ItemTypeLabel in gram
  carriable: boolean;
  capacityCost: number;
  glyph?: string;
  color?: string;
  description?: string;
  attrs?: Record<string, unknown>;
}>;
```

---

## Intermediate Entities (converter pipeline)

### `MapContext` (computed at parse time)

Holds all validated top-level properties extracted from the `.tmj`:

| Field | Type | Source |
|---|---|---|
| `h3Anchor` | `string` | `h3_anchor` property |
| `h3Resolution` | `15` | `h3_resolution` property (validated = 15) |
| `elevation` | `number` | `elevation` property (default 0) |
| `mapName` | `string` | `map_name` property or filename stem |
| `tilewidth` | `number` | TMJ top-level |
| `tileheight` | `number` | TMJ top-level |
| `hexsidelength` | `number` | TMJ top-level |
| `staggeraxis` | `"x"` | TMJ top-level |
| `staggerindex` | `"odd" \| "even"` | TMJ top-level |

### `TileTypeRegistry` (computed)

A `Map<string, TileTypeEntry>` keyed by type label. Populated from all `.tsx` tilesets and from `tile-area` object `type` fields.

```typescript
interface TileTypeEntry {
  label: string;        // e.g. "Blue"
  name: string;         // from tsx tile.type
  color?: string;       // from tsx tile properties (absent in current sandbox)
  typeId: string;       // stable ID for the gram node, e.g. "tileType_Blue"
}
```

### `GidMap` (computed)

A `Map<number, string>` mapping Tiled GID → tile type label. Built from tileset GID offsets and the per-tile `type` field in each `.tsx`.

### `TileAreaPolygon` (computed from `tile-area` objects)

| Field | Type | Notes |
|---|---|---|
| `id` | `number` | Tiled object ID (used for stable ordering and error messages) |
| `name` | `string` | Tiled object name |
| `typeLabel` | `string` | Tile type this area represents |
| `vertexCells` | `string[]` | H3 cell IDs for each vertex, in order |
| `interiorCells` | `Set<string>` | All H3 cells inside the polygon (from `polygonToCells`) |

### `CellEmissionList` (computed)

The filtered list of individual tile cells to emit as gram nodes. Starts as all non-empty cells on the `layout` layer, minus cells covered by a matching `tile-area` (compression rule), plus cells covered by a `tile-area` whose layout tile type differs (override rule).

```typescript
interface CellEmission {
  id: string;           // stable generated ID, e.g. ULID or h3-derived
  typeLabel: string;
  h3Index: string;
}
```

### `ItemEmission` (computed from `item-placement` layer + sidecar)

```typescript
interface ItemTypeEntry {
  typeId: string;       // from sidecar key, e.g. "key-brass"
  label: string;        // from sidecar itemClass, e.g. "Key"
  name: string;
  glyph?: string;
  color?: string;
}

interface ItemInstanceEmission {
  id: string;           // stable ID, e.g. ULID
  typeLabel: string;    // from sidecar itemClass
  h3Index: string;
}
```

---

## Output Entity: `.map.gram`

A plain-text gram document. Canonical section order:

1. **Document header record** — metadata
2. **TileType definitions** — one per unique tile type encountered
3. **Polygon area nodes** — one per `tile-area` object, sorted by Tiled object `id`
4. **Individual tile cell nodes** — sorted lexically by H3 index
5. **ItemType definitions** — one per sidecar entry, sorted by sidecar key
6. **Item instance nodes** — sorted lexically by H3 index, then by item ref

```gram
{
    kind: "matrix-map",
    name: "<map_name>",
    elevation: <elevation>
}

(<typeId>:TileType:<TileTypeLabel> { name: "<name>" })
[<areaId>:Polygon:<TileTypeLabel> | <v1>, <v2>, ..., <vN>]
(<cellId>:<TileTypeLabel> { location: "<h3Index>" })

(<itemTypeId>:ItemType:<ItemTypeLabel> { name: "<name>", glyph?: "...", color?: "..." })
(<instanceId>:<ItemTypeLabel> { location: "<h3Index>" })
```

---

## Runtime Entities (server/world-api/src/map/)

### `MapIndexEntry` (in-memory, keyed by `mapId`)

```typescript
interface MapIndexEntry {
  mapId: string;          // from gram name metadata = filename stem
  tmjPath: string;        // absolute path to .tmj
  gramPath: string;       // absolute path to .map.gram
}
```

### `MapIndex` (in-memory map inside `MapService`)

`Map<string, MapIndexEntry>` — keyed by `mapId`. Built at startup by scanning `maps/**/*.{tmj,map.gram}`.

### `MapServiceOps` (interface behind `Context.Tag`)

```typescript
interface MapServiceOps {
  /** Returns the raw file content for the requested format. */
  raw(mapId: string, format: "gram" | "tmj"): Effect.Effect<
    ReadableStream | string,
    MapNotFoundError | UnsupportedFormatError
  >;
  /** Called at startup; parses each gram and validates name metadata. */
  validate(): Effect.Effect<void, GramParseError | MapNameMismatchError | MapIdCollisionError>;
}
```

### Typed Errors (new)

| Class | Tag | HTTP | Fields |
|---|---|---|---|
| `MapNotFoundError` | `"MapError.NotFound"` | 404 | `mapId: string` |
| `UnsupportedFormatError` | `"MapError.UnsupportedFormat"` | 400 | `format: string` |
| `GramParseError` | `"MapError.GramParse"` | 500 (startup only) | `path: string, cause: string` |
| `MapNameMismatchError` | `"MapError.NameMismatch"` | 500 (startup only) | `path: string, expected: string, actual: string` |
| `MapIdCollisionError` | `"MapError.IdCollision"` | 500 (startup only) | `mapId: string, paths: string[]` |

`MapNotFoundError` and `UnsupportedFormatError` are added to `HttpMappingError` in `server/src/errors.ts` and must have `Match.tag` branches in `errorToResponse()`.

The startup-only errors (`GramParseError`, `MapNameMismatchError`, `MapIdCollisionError`) cause the Layer to fail before any HTTP port is bound; they are not part of `HttpMappingError`.

---

## State Transitions

### CLI pipeline (tools/tmj-to-gram)

```
TMJ file path (CLI arg)
  → validate path exists + .tmj extension
  → parse TMJ JSON → TmjDocument
  → extract & validate MapContext (h3_anchor, h3_resolution=15)
  → load & parse all referenced .tsx tilesets → TileTypeRegistry + GidMap
  → load *.items.json sidecar (if present) → ItemSidecar
  → scan layout layer → initial CellEmissionList (full)
  → scan tile-area objects → List<TileAreaPolygon>
    → reject ellipses
    → convert pixel vertices → H3 cells (per vertex: pixel→col,row→h3.localIjToCell)
    → compute interior sets (h3.polygonToCells on vertex lat/lngs)
    → assert pairwise non-overlap
  → apply compression/override → CellEmissionList (filtered)
  → scan item-placement layers → List<ItemInstanceEmission>
  → sort all outputs (lexical H3 order, area by id, items by sidecar key)
  → serialize to gram text
  → write to output path
```

### MapService startup

```
Startup (Layer.scoped)
  → glob maps/**/*.{tmj,map.gram}
  → pair .tmj and .map.gram by filename stem + directory
  → build MapIndex (keyed by filename stem)
  → detect mapId collisions → MapIdCollisionError
  → for each .map.gram:
    → read file
    → Gram.parse() → GramParseError on failure
    → extract name metadata → MapNameMismatchError if ≠ filename stem
  → all valid → MapIndex ready
```

### HTTP request (MapRoutes)

```
GET /maps/:mapId?format=gram|tmj
  → parse :mapId path param
  → parse ?format query param (default "gram")
  → MapService.raw(mapId, format)
    → MapNotFoundError → 404
    → UnsupportedFormatError → 400
  → stream file to response with appropriate Content-Type
```
