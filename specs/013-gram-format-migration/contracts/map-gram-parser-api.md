# Contract: @aie-matrix/map-gram Public API

**Package**: `@aie-matrix/map-gram`  
**Version**: 0.1.0  
**Target**: Node.js 24 + browser (Vite/ESM)

---

## IC-001: Output shape compatibility

The parser produces `ParsedMap`. Downstream consumers adapt it to their own interfaces (`CellRecord`, `WorldTile`) — the shared package does NOT export either of those types.

```typescript
import { parseMapGram } from "@aie-matrix/map-gram"
import type { ParsedMap, ParsedCell, ParsedPortal, ParsedRule } from "@aie-matrix/map-gram"
```

---

## Primary export: `parseMapGram`

```typescript
/**
 * Parse a .map.gram text document into a structured map representation.
 *
 * Performs Gram validation, walks the AST, expands polygon fills (using H3
 * polygonToCellsExperimental with containmentOverlapping), and applies layers
 * in LayerStack order.
 *
 * @throws {MapGramParseError} if the document is malformed, missing a
 *   LayerStack, or contains invalid H3 indices
 */
export function parseMapGram(gramText: string): Promise<ParsedMap>
```

### Constraints
- Input must be a valid gram document with `kind: "matrix-map"` root record
- A `LayerStack` walk must be present; files without one are rejected with `MapGramParseError("missing-layer-stack")`
- Polygon vertex lists with fewer than 3 vertices → **warning logged, polygon skipped** — parsing continues (not a thrown error). No upper bound is enforced; real authored maps contain polygons with 7+ vertices and `polygonToCellsExperimental` handles any count ≥ 3.
- All H3 indices in geometry arrays must pass `h3.isValidCell()`; invalid cells → `MapGramParseError("invalid-h3")`
- `polygonToCellsExperimental` returning 0 cells for a polygon → warning logged, polygon skipped (not an error)

---

## Error type: `MapGramParseError`

```typescript
export class MapGramParseError extends Error {
  readonly cause: "missing-layer-stack"  // no LayerStack in document
                | "invalid-h3"           // includes .detail with the bad H3 index
                | "gram-syntax"          // includes upstream gram error
  readonly detail?: string               // human-readable; names the problematic construct
}
```

Polygons with invalid vertex counts are **not** thrown — they are logged as warnings and skipped. Only hard-structural failures (missing LayerStack, unparseable H3 indices, gram syntax errors) produce a `MapGramParseError`.

---

## IC-002: Portal data availability

Portals are NOT merged into `ParsedMap.cells`. They are a separate ordered list.

```typescript
interface ParsedPortal {
  fromCell: string   // H3 index
  toCell: string     // H3 index
  mode: string       // e.g., "Door", "Stairs", "Teleporter"
}
```

Consumers that do not use portals may safely ignore `ParsedMap.portals`.

---

## IC-003: tmj-to-gram output format

Any `.map.gram` file produced by the updated `tmj-to-gram` tool is valid input to `parseMapGram`. Both authoring paths (native editor and Tiled conversion) produce the same layered format.

Format invariants guaranteed by the updated serializer:
- Exactly one `LayerStack` per file
- Polygon vertices are written in centroid-sorted order (matching `computeCellsFromVertices` sort)
- Each TileType and ItemType is declared before its first use
- Movement rules are generated for every declared TileType

---

## IC-004: Sole parser — no internal reimplementation

Neither `server/colyseus` nor `clients/intermedium` may contain gram parsing logic. Both MUST import from `@aie-matrix/map-gram`.

Acceptable adapter code in consumers:
```typescript
// OK — adapting ParsedCell to a consumer-specific shape
const worldTile: WorldTile = {
  h3Index: cell.h3Index,
  tileType: cell.tileType[0]!.toLowerCase() + cell.tileType.slice(1) as TileType,
  items: Object.freeze([...cell.items]),
  neighbors: Object.freeze(gridDisk(cell.h3Index, 1).filter(c => c !== cell.h3Index)),
}
```

Not acceptable:
```typescript
// NOT OK — reimplementing polygon extraction
const cellRe = /\(:Polygon:(\w+)\s*\{.*?geometry:\s*\[([^\]]+)\]/g
```

---

## Downstream consumers

| Consumer | Package | Adapter file | Spec reference |
|---|---|---|---|
| Colyseus map loader | `@aie-matrix/colyseus` | `server/colyseus/src/mapLoader.gram.ts` | IC-001 |
| Intermedium client | `clients/intermedium` | `clients/intermedium/src/services/gramParser.ts` | IC-001 |
| tmj-to-gram tool | `@aie-matrix/tmj-to-gram` | (producer, not consumer) | IC-003 |
| world-api server | `@aie-matrix/world-api` | `server/world-api/src/map/MapService.ts` | (validation only; uses `Gram.validate` from `@relateby/pattern` directly) |
