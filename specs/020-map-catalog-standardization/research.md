# Research: Map Catalog Standardization & Moscone West Map

**Date**: 2026-05-25  
**Feature**: 020-map-catalog-standardization

## Decision: ADR Required Before TMJ Removal

**Decision**: A short ADR (ADR-0009 or amendment to ADR-0005) documenting the full deprecation of TMJ support is needed to satisfy Constitution §I.  
**Rationale**: ADR-0005 established `.map.gram` as canonical but explicitly stated "Tiled remains the authoring tool" and "server serves both formats." RFC-0009 deferred the Colyseus runtime switch. Neither document formally deprecates the `?format=tmj` HTTP endpoint. This feature removes a public API capability; that decision must be recorded.  
**Alternatives considered**: Treating it as a PR-only change — rejected because it alters a public contract (IC-002) and a cross-package interface.

---

## Decision: `loadTmjMap` Removal Scope is Narrow

**Decision**: `loadTmjMap()` in `server/colyseus/src/mapLoader.ts` (lines 234–411) is already marked `@internal` and is not called at runtime — it is only referenced in the test file via an alias. Removal is safe and limited to the colyseus package.  
**Rationale**: `loadHexMap()` (lines 216–231) is the production gram path. `loadTmjMap()` was preserved only for test backward compatibility. The `mapLoader.test.ts` imports `loadTmjMap as loadHexMap`, which will need to be updated to call `loadHexMap` directly with a `.map.gram` fixture.  
**Alternatives considered**: Keeping `loadTmjMap` for backward compatibility — rejected because no live caller exists and the code misleads future contributors.

---

## Decision: MapService `raw()` Becomes Gram-Only

**Decision**: Remove the `format: "gram" | "tmj"` parameter from `MapServiceOps.raw()`. The method signature becomes `raw(mapId: string): Effect.Effect<Buffer, MapNotFoundError | MapFileReadError>`. Remove `tmjPath` from `MapIndexEntry`.  
**Rationale**: The only non-gram caller of `raw(mapId, "tmj")` is `MapRoutes.ts`; once routes drop TMJ the overloaded format parameter has no use. Simplifying the interface removes a class of runtime errors (path-not-found for gram-only maps requesting TMJ).  
**Alternatives considered**: Keeping the signature but making TMJ return 404 — rejected as dead code; the constitution requires removing dead branches, not gating them.

---

## Decision: HTTP API Contract IC-002 Superseded

**Decision**: `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md` must be superseded by a new contract artifact at `specs/020-map-catalog-standardization/contracts/ic-001-maps-http-api.md`.  
**Rationale**: The downstream consumers listed in IC-002 (Phaser debugger using `?format=tmj`) are AIEWF-era tools unlikely to still need TMJ. The intermedium and CI health-check consumers already use `?format=gram`. The updated contract removes the `tmj` download URL and `?format=tmj` query support entirely.  
**Alternatives considered**: Amending IC-002 in-place — acceptable but superseding makes the history cleaner; the old contract stays as a historical record.

---

## Decision: `tools/tmj-to-gram` Tombstoned, Not Deleted

**Decision**: Mark `tools/tmj-to-gram` as deprecated in its `package.json` and `README.md`. Add a `"deprecated": true` field. Keep the source for historical reference; exclude from `pnpm dev` workspace.  
**Rationale**: The conversion tool has no live callers once all `.tmj` files are deleted from `maps/`. Keeping source allows future developers to understand the conversion logic. Hard-deletion of non-trivial tooling should go through a separate cleanup PR.  
**Alternatives considered**: Full deletion — acceptable but slightly riskier if a `.tmj` file reappears from a backup or external contribution.

---

## Decision: Moscone West Map Design Approach

**Decision**: Rewrite `maps/moscone/moscone-west-ground-floor.map.gram` (rename to `moscone-west.map.gram` for consistency with Moscone South naming pattern) with a polygon-based floor plan representing the AIEWF event layout.  
**Rationale**: The existing file defines only a bare building footprint with two floor polygons and a single `Floor` tile type. It provides no navigational structure. The rewrite uses the same H3 anchor region (`8f283082aa...` prefix, resolution 15) and layers named areas as distinct TileTypes on top of the base floor polygon.

**Venue areas to define** (as TileType definitions):
- `floor` — general traversable floor (base layer)
- `wall` — impassable boundary (capacity 0)
- `lobby` — Lobby / Entry area (north entrance, Howard Street side)
- `corridor` — Hallway / circulation
- `expo` — Expo Hall (main vendor floor)
- `stage` — Main Stage / keynote area
- `room_2001`, `room_2002`, `room_2003` — Session rooms (Levels 2/3 breakout rooms)
- `booth_neo4j`, `booth_anthropic`, `booth_langchain` — Named vendor booths in Expo Hall (illustrative; names TBD per actual exhibitors)

**Polygon strategy**:
1. Outer Building polygon (`Floor` fill) — reuse existing 8-vertex polygon from current file
2. Override inner polygons for each named zone
3. Explicit Tile nodes for individual vendor booth cells where polygon granularity is insufficient
4. Wall tiles placed at structural boundaries

**Naming convention**: `{ kind: "matrix-map", name: "Moscone West", elevation: 0 }` — aligns with IC-003 from the spec.

**H3 coordinate source**: The existing file uses H3 cells in the `8f283082aa` prefix range (37.7842° N, 122.4015° W — confirmed Moscone West, San Francisco). New polygon vertices will be chosen within this anchor range using `h3.latLngToCell` to identify cells at key floor-plan points.

---

## Proposal Linkage Summary

| Document | Status | Relationship |
|----------|--------|--------------|
| `proposals/adr/0005-h3-native-map-format.md` | Implemented | Established `.map.gram` canonical; TMJ as authoring bridge |
| `proposals/rfc/0009-map-format-pipeline.md` | Implemented | Deferred Colyseus runtime switch; world-api HTTP TMJ serving |
| ADR-0009 (new) | To be written | Formally closes TMJ bridge; records gram-only decision |
| `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md` | Superseded by this feature | Old HTTP API contract including TMJ |

---

## File Impact Map

| File | Action | Why |
|------|--------|-----|
| `server/world-api/src/map/MapService.ts` | Remove `tmjPath`, `tmj` format branch, `.tmj` glob scan | TMJ deprecated |
| `server/world-api/src/map/MapRoutes.ts` | Remove `tmj` link, `normalizeFormat` TMJ branch | TMJ deprecated |
| `server/world-api/src/map/map-errors.ts` | Remove `UnsupportedFormatError` if TMJ was its only trigger | TMJ deprecated |
| `server/world-api/test/map-routes.test.ts` | Remove `assertTmjJsonShape` and TMJ-format test cases | TMJ deprecated |
| `server/world-api/test/MapService.test.ts` | Update to reflect gram-only `MapIndexEntry` | TMJ deprecated |
| `server/colyseus/src/mapLoader.ts` | Delete `loadTmjMap` and all TMJ types/helpers | TMJ deprecated |
| `server/colyseus/src/mapLoader.test.ts` | Replace TMJ test fixtures with gram equivalents | TMJ deprecated |
| `server/colyseus/src/mapTypes.ts` | Review — may define TMJ-related types | TMJ deprecated |
| `maps/sandbox/*.tmj` | Delete 4 files | Converted; `.map.gram` counterparts exist |
| `maps/sandbox/*.items.json` | Delete legacy sidecars | Superseded by gram inline items |
| `maps/moscone/moscone-west.tmx` | Delete | Source file; no server loader reads .tmx |
| `maps/moscone/moscone-west-ground-floor.map.gram` | Rewrite → rename `moscone-west.map.gram` | Add venue structure |
| `tools/tmj-to-gram/package.json` | Add `"deprecated": true` | Tombstone |
| `tools/tmj-to-gram/README.md` | Add deprecation notice | Tombstone |
| `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md` | Add superseded header | Contract history |
| `specs/020-map-catalog-standardization/contracts/ic-001-maps-http-api.md` | Create (gram-only) | New contract |
| `proposals/adr/0009-tmj-deprecation.md` | Create | Constitution I requirement |
| `maps/moscone/README.md` | Create | Document venue naming |
| `docs/architecture.md` | Update TMJ open question → resolved | Documentation impact |
