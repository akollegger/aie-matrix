# Research: H3 Geospatial Coordinate System

**Feature**: 005-h3-coordinate-system  
**Date**: 2026-04-18

---

## Decision 1: H3 Library Selection

**Decision**: Use `h3-js` (the official Uber H3 JavaScript port) as the H3 library across all packages.

**Rationale**:
- `h3-js` is pure JavaScript (no native bindings), so it runs identically in Node.js and the browser. The spectator overlay client is browser-delivered, so a native-binding library (`h3-node`) cannot be used there.
- `h3-js` is the reference implementation for JS/TS; `h3-node` uses the C core via NAPI but adds a native build step and is Node-only.
- Performance difference is negligible for map-load-time computation (a single pass over ~2,000 cells).
- Using the same library in server and client packages avoids index string format discrepancies.

**Alternatives Considered**:
- `h3-node`: Faster (native bindings), but Node-only. Rejected because the map overlay client runs in the browser.
- No library (raw bit manipulation): H3 indices encode resolution and coordinates in a specific 64-bit layout; implementing this from scratch would be error-prone and unmaintainable.

**Installation**: `pnpm add h3-js` in `server/colyseus`, `server/world-api`, and `client/map-overlay`.

---

## Decision 2: Tiled → H3 Index Derivation Strategy

**Decision**: Use `h3.localIjToCell(anchorH3, { i: col, j: row })` to map each Tiled (col, row) to an H3 cell index.

**Rationale**:
- H3 exposes a local IJ coordinate frame anchored at any cell via `cellToLocalIj` / `localIjToCell`. This maps local integer offsets directly to H3 cells, analogous to how Tiled grid offsets work.
- For a venue-scale map (≤50×40 cells), the local IJ frame is always valid (the API has a maximum k-ring radius; at res 15 with a 50-cell span, k≈50 which is well within the supported range).
- This is a single call per cell (O(n) over all cells) with no iterative error accumulation, unlike step-by-step neighbor traversal.
- Drift characteristic: IJ-to-cell uses H3's internal grid geometry, not rectangular projection. Two cells at the same Tiled column but different rows will map to H3 cells whose centroids may not align on a perfect rectangular grid. For conference venue scale, this distortion is cosmetically negligible (< a few meters over 50 cells). Exact drift measurement is deferred to implementation testing (RFC open question 1).

**Alternatives Considered**:
- Iterative neighbor traversal: Walk from anchor one step at a time per compass direction. Accumulates rounding errors across the grid, and requires mapping odd-q axial deltas to H3 direction enums (complex, error-prone).
- Lat/lng-to-H3 per cell: Requires the map author to supply per-cell GPS coordinates — defeats the anchor abstraction.
- gridPathCells: H3's path function works between two cells but is not designed for bulk rectangular grid derivation.

**API call**:
```typescript
import { localIjToCell } from "h3-js";
const h3Index = localIjToCell(anchorH3, { i: col, j: row });
```

---

## Decision 3: Compass Direction Assignment for H3 Neighbors

**Decision**: Assign compass labels to H3 neighbors by computing the bearing from each cell's lat/lng centroid to each neighbor's centroid and quantizing to the nearest 60° sector.

**Rationale**:
- H3 does not expose compass direction as a concept; it uses internal direction enums for algorithmic traversal. These enums have no stable correspondence to geographic N/S/E/W.
- Bearing computation (using the equirectangular approximation: `atan2(Δlng, Δlat)`) is accurate to < 1° over a 200m venue span.
- Quantizing 360° into six 60°-wide sectors centered at N=0°, NE=60°, SE=120°, S=180°, SW=240°, NW=300° produces stable, perceptually correct labels at venue scale.
- This approach computes compass assignment once at map load time; runtime movement uses the pre-computed neighbors map (no change to `evaluateGo`).

**Implementation**:
```typescript
import { cellToLatLng, gridDisk } from "h3-js";

function assignCompassToNeighbors(cell: string): Partial<Record<Compass, string>> {
  const [lat0, lng0] = cellToLatLng(cell);
  const ring = gridDisk(cell, 1).filter(c => c !== cell);
  const result: Partial<Record<Compass, string>> = {};
  for (const neighbor of ring) {
    const [lat1, lng1] = cellToLatLng(neighbor);
    const bearing = Math.atan2(lng1 - lng0, lat1 - lat0) * (180 / Math.PI);
    const normalized = (bearing + 360) % 360;
    const label = bearingToCompass(normalized);
    result[label] = neighbor;
  }
  return result;
}
```

---

## Decision 4: Pentagon Detection and Portal Seeding

**Decision**: Use `h3.getPentagons(15)` at server startup to obtain the 12 global pentagon H3 indices at resolution 15, and use `h3.isPentagon(cell)` in the map loader to flag pentagon cells.

**Rationale**:
- `h3.getPentagons(resolution)` is a documented H3 API that returns all 12 pentagonal cell indices for a given resolution. This is authoritative and requires no hardcoding.
- Pentagon cells have 5 neighbors returned by `gridDisk(cell, 1)` (excluding the cell itself); no special-casing is needed in neighbor traversal.
- The compass assignment loop (Decision 3) naturally handles 5-neighbor cells — it assigns a compass label to each of the 5 neighbors and leaves one label slot absent.
- Pentagon portal seeding: at server startup, the Neo4j world graph upserts `PORTAL` edges between all 12 pentagon cells (fully connected or icosahedron-adjacency — topology deferred to follow-up RFC). For this RFC, fully connected (diameter 1) is the safe default.

**No conference venue will contain a pentagon cell at res 15.** Pentagon behavior is verified with synthetic test data.

---

## Decision 5: Non-Adjacent Traversal Storage in Neo4j

**Decision**: Represent non-adjacent exits (elevators, portals) as Neo4j relationships with a distinct type from `ADJACENT` (e.g., `PORTAL`, `ELEVATOR`), carrying a `name` property that is the exit label shown to ghosts.

**Rationale**:
- The current graph already uses `ADJACENT` relationships between neighboring cells. Adding typed relationships with display names requires no schema migration beyond adding new relationship types.
- The `exits` MCP tool queries Neo4j for both `ADJACENT` neighbors (compass directions already in CellRecord) and named non-adjacent relationships.
- The `traverse` tool validates that the named exit exists as a relationship from the ghost's current cell before moving.
- Neo4j relationship queries for non-adjacent exits are O(degree) — fast for small numbers of portal/elevator exits per cell.

---

## Decision 6: Colyseus State and Registry Position Format

**Decision**: Change `ghostTiles` values and `GhostRecord.tileId` from `"col,row"` strings to H3 index strings. Rename `GhostRecord.tileId` to `GhostRecord.h3Index` for clarity. Keep `tileCoords` in `WorldSpectatorState` for backward compatibility with the Phaser client during a transition period, derived from H3 index at broadcast time.

**Rationale**:
- The Colyseus `ghostTiles` schema broadcasts ghost positions to all spectators. The Phaser client reads these values. Changing the format is a breaking change for the Phaser client.
- Mitigation: Retain `tileCoords: MapSchema<TileCoord>` in the Colyseus schema and update it from the H3 index at broadcast time by looking up the CellRecord's retained `col`/`row` fields. This avoids a hard cut-over for the Phaser client.
- The map overlay client reads `ghostTiles` directly as H3 indices.
- Long-term, `tileCoords` can be removed once the Phaser client is updated or deprecated.

---

## Decision 7: Map Overlay Client Package Location

**Decision**: New package at `client/map-overlay/` as a standalone browser app (no framework other than vanilla TS + MapLibre GL JS). Map renderer choice (MapLibre GL vs. Leaflet) deferred to implementation spec per RFC.

**Rationale**:
- Separate from `client/phaser/` to avoid coupling the existing spectator client to the new geospatial dependency.
- Browser-delivered (no server-side rendering) to support phone-based conference attendee experience.
- MapLibre GL JS is the leading open-source vector map library; Leaflet is simpler but raster-focused. Both support H3 overlays via GeoJSON rendering. Final choice deferred.

---

## Resolved RFC Open Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Anchor projection drift | Use `localIjToCell`; measure empirically during implementation. Acceptable threshold: ≤200m at far corner of 50×40 map. |
| 2 | Pentagon portal topology | Fully connected (diameter 1) as safe default. Topology RFC deferred. |
| 3 | Sub-cell GPS positioning | Out of scope for this feature. |
| 4 | Map authoring at scale | Out of scope; manual Tiled authoring sufficient for conference floor. |
| 5 | Map overlay package name/tech | `client/map-overlay/`; map renderer deferred to package implementation spec. |
| 6 | Pentagon neighbor count assumption | `gridDisk(cell, 1).filter(c => c !== cell)` handles 5-neighbor case naturally. |
