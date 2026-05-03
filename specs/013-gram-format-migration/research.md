# Research: .map.gram Format Migration

**Branch**: `013-gram-format-migration` | **Date**: 2026-05-03

## 1. Gram AST Parsing Strategy

**Decision**: Use `Gram.parse()` AST walk from `@relateby/pattern` — no regex.

**Rationale**: The `@relateby/pattern` library already exposes a full AST via `Gram.parse()`. Subjects have `identity`, `labels` (HashSet), and `properties` (HashMap). Relationships (walks) expose ordered `elements` for layer membership and LayerStack ordering. The map editor's `import-gram.ts` already demonstrates the exact pattern: walk all subjects, check labels, extract geometry from the `ArrayVal` property type. Regex parsing cannot recover layer structure or type declarations; the AST can.

**Alternatives considered**:
- Regex (current intermedium approach) — cannot extract polygon geometry arrays, layer ordering, or TileType declarations without fragile multi-line patterns
- Manual string splitting — same fragility, no benefit over AST

**Key API**:
```typescript
const patterns = await Effect.runPromise(Gram.parse(gramText));
// patterns: Pattern<Subject>[]
// Walk via pattern.elements for relationships, pattern.value for subjects
```

Tagged string values (`h3\`...\``, `css\`...\``, `char\`...\``) surface as `{ _tag: "TaggedStringVal", tag: "h3", content: "..." }` in the property map.

---

## 2. Polygon Fill Algorithm

**Decision**: `polygonToCellsExperimental(ring, 15, POLYGON_TO_CELLS_FLAGS.containmentOverlapping)` — exact copy of the map editor's reference implementation.

**Rationale**: The map editor in `tools/map-editor/src/map/polygon-geometry.ts` already defines the canonical `computeCellsFromVertices()` function. The shared parser must use the identical algorithm so that the cells stored by the editor and the cells computed by the parser are the same set.

**Algorithm** (`computeCellsFromVertices`):
1. Convert each vertex H3 cell to `[lat, lng]` via `h3.cellToLatLng()`
2. Sort points by angle from centroid: `Math.atan2(lat - cLat, lng - cLng)` — prevents self-intersecting rings
3. Close the ring: append first point at the end
4. Call `polygonToCellsExperimental([...sorted, sorted[0]], 15, POLYGON_TO_CELLS_FLAGS.containmentOverlapping)`

**Alternatives considered**:
- `polygonToCells` (non-experimental) — uses centroid containment; vertex cells at polygon boundary may be excluded; inconsistent with editor output
- `containmentFull` flag — excludes boundary cells; vertices would be missing from fill

**Note**: `polygonToCellsExperimental` and `POLYGON_TO_CELLS_FLAGS` are exported from `h3-js` 4. Both Node.js and browser builds are supported.

---

## 3. Shared Package Browser Compatibility

**Decision**: `@aie-matrix/map-gram` uses only `h3-js` and `@relateby/pattern` — no Node.js-only imports.

**Rationale**: The intermedium client runs in the browser (Vite build). Both `h3-js` 4 and `@relateby/pattern` ship browser-compatible ESM. Neither `fs` nor `path` is needed; the parser takes a string and returns data. The Gram WASM module in `@relateby/pattern` is already loaded in the browser by the intermedium client today.

**Alternatives considered**:
- Node-only package with a separate browser shim — unnecessary complexity; the algorithm has no platform-specific dependencies

---

## 4. CellRecord col/row Fields for Gram-Loaded Maps

**Decision**: Set `col: 0, row: 0` for all cells loaded from `.map.gram` files.

**Rationale**: `col` and `row` in `CellRecord` are Tiled grid artefacts inherited from `.tmj` loading. No Colyseus room code reads them for routing, pathfinding, or gameplay decisions — routing uses `h3Index` and `neighbors`. Setting them to 0 satisfies the type contract without changing the interface or breaking any consumer.

**Where this is documented**: `mapLoader.gram.ts` adapter will contain a comment noting the intent.

**Alternatives considered**:
- Making `col`/`row` optional — would change the CellRecord interface and require type-guard updates in callers
- Deriving grid coords from H3 — H3 cells are not on a rectilinear grid; no meaningful col/row can be computed

---

## 5. Colyseus anchorH3 for Gram-Loaded Maps

**Decision**: `anchorH3` in `LoadedMap` is set to the lexicographically smallest H3 index in the loaded cell set.

**Rationale**: The `anchorH3` field was used for Tiled grid origin alignment; no Colyseus game logic uses it after initial load. A deterministic value (lex-min cell) avoids null/undefined while remaining testable. If the format later adds an explicit anchor property to the gram header, this default can be replaced.

**Alternatives considered**:
- Null / empty string — may cause downstream null-reference errors in existing code that reads `loadedMap.anchorH3`
- A fixed hardcoded cell — not deterministic across maps

---

## 6. tmj-to-gram Serializer Scope

**Decision**: Change only `serialize-gram.ts`; leave `cell-emission.ts`, `tile-area.ts`, and `item-emission.ts` unchanged.

**Rationale**: The three data-gathering modules already produce the right intermediate representations (`CellEmission`, `TileAreaPolygon`, `ItemInstanceEmission`). The only change is how those structures are serialized to text. Keeping the data pipeline untouched minimises regression risk and preserves the existing determinism rule (IC-001 in the original tmj-to-gram spec).

**What changes in `serialize-gram.ts`**:
- Group `TileAreaPolygon` objects into a polygon `Layer` walk; emit vertex cells as `geometry` array
- Group remaining `CellEmission` objects (not implied by a polygon) into a tile `Layer` walk
- Group `ItemInstanceEmission` objects into an items `Layer` walk
- Emit a `LayerStack` walk in order: polygon layer → tile layer → items layer
- Emit `Rules` walk: one `(typeId)-[:GO]->(typeId)` per TileType (auto-generated, as before)
- Remove all old-format flat cell node emission

---

## 7. world-api Validation Tightening

**Decision**: `MapService.ts` rejects any `.map.gram` file that lacks a `LayerStack` subject, in addition to the existing `kind: "matrix-map"` header check.

**Rationale**: The old-format files that lack `LayerStack` are no longer valid after this migration. Failing fast at server startup (with a clear error message) is safer than silently loading an empty or partial map at runtime.

**Implementation**: Check `Gram.parseWithHeader()` result for a subject with label `"LayerStack"`. If absent, return a `Data.TaggedError` that maps to a 422 response in `errorToResponse()`.
