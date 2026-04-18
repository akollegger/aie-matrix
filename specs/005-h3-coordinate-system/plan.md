# Implementation Plan: H3 Geospatial Coordinate System

**Branch**: `005-h3-coordinate-system` | **Date**: 2026-04-18 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/005-h3-coordinate-system/spec.md`

## Summary

Replace the `"col,row"` `CellId` string with H3 res-15 index strings as the canonical cell identity across the ghost world. Map loading derives H3 indices from a new `h3_anchor` Tiled map property. Compass direction assignment shifts from static axial-delta lookup to bearing-quantization at load time. The ghost MCP interface gains a `traverse` tool for named non-adjacent exits. A new `client/map-overlay` package renders ghost positions on a real-world map. The 12 H3 pentagon cells are seeded as global portals at server startup.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `h3-js` (new, all affected packages), `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3  
**Storage**: Neo4j (world graph — cell identity property changes to `h3Index`); in-memory Colyseus schema  
**Testing**: `pnpm test` (unit), `pnpm test:tck` (ghost contract tests, server must be running)  
**Target Platform**: Node.js 24 server; browser (spectator overlay client)  
**Project Type**: monorepo — server packages + new browser client package  
**Performance Goals**: Map load under 500ms for a 2,000-cell map; ghost position broadcast latency unchanged  
**Constraints**: Breaking change on `CellId` format — Phaser client compatibility maintained via retained `tileCoords` map; no existing ghost agent should require code changes for basic `go` navigation  
**Scale/Scope**: Venue-scale maps (≤2,000 cells); ~12 simultaneous ghosts; ~100 spectator connections

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Proposal linkage**: RFC-0004 (`proposals/rfc/0004-h3-geospatial-coordinate-system.md`) explicitly covers this feature's full scope. Branch and spec trace back to RFC-0004.
- [x] **Boundary-preserving**: Changes are contained to `server/colyseus`, `server/world-api`, `server/registry`, and a new `client/map-overlay` package. No new top-level directory beyond `client/map-overlay` (parallel to existing `client/phaser`). `shared/types` `Compass` type unchanged.
- [x] **Shared interfaces**: IC-005 through IC-009 documented under `contracts/`. `CellRecord` change, `exits`/`traverse` MCP schema, Colyseus broadcast, and `.tmj` map schema all have contract artifacts.
- [x] **Verifiable increments**: Four independently testable user stories (P1–P4). Each has `pnpm test:tck` coverage and a `quickstart.md` smoke-test path.
- [x] **Documentation impact**: `docs/architecture.md`, RFC-0004 status, map authoring guide (new), ghost MCP docs — enumerated in spec.

**Post-Phase-1 recheck**: No constitution violations introduced. `client/map-overlay` is justified by RFC-0004 and parallel to `client/phaser`. No new top-level directory.

## Project Structure

### Documentation (this feature)

```text
specs/005-h3-coordinate-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-005-cell-record-schema.md
│   ├── ic-006-exits-response-schema.md
│   ├── ic-007-traverse-tool-schema.md
│   ├── ic-008-colyseus-position-broadcast.md
│   └── ic-009-tmj-map-schema.md
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code

```text
server/colyseus/src/
├── mapTypes.ts          # CellId, CellRecord, LoadedMap — modified
├── mapLoader.ts         # H3 anchor parsing, localIjToCell, bearing-compass — modified
├── hexCompass.ts        # neighborOddq replaced with H3 bearing-based assignment — modified
└── room-schema.ts       # ghostTiles values: "col,row" → h3Index; tileCoords retained — modified

server/world-api/src/
├── mcp-server.ts        # exits (extended), traverse (new tool), whereami (h3Index field) — modified
└── movement.ts          # traverseEffect + evaluateTraverse (new); evaluateGo cell lookup updated — modified

server/registry/src/
└── store.ts             # GhostRecord.tileId → h3Index — modified

maps/sandbox/
└── freeplay.tmj         # Add h3_anchor and h3_resolution custom map properties — modified

client/map-overlay/      # NEW package: @aie-matrix/client-map-overlay
├── package.json
├── src/
│   ├── main.ts          # Colyseus connection, ghostTiles subscription
│   ├── overlay.ts       # H3 → lat/lng → map marker rendering
│   └── map.ts           # MapLibre GL or Leaflet setup (deferred choice)
└── index.html

ghosts/tck/              # TCK contract tests — update expected cell ID format
```

**Structure Decision**: No new top-level directories. `client/map-overlay` is a new package under the existing `client/` directory, parallel to `client/phaser`. All server-side changes are modifications to existing packages.

## Complexity Tracking

No constitution violations requiring justification. `client/map-overlay` is a new package but is in scope per RFC-0004 and follows the existing `client/` pattern.

---

## Phase 0: Research — COMPLETE

See [`research.md`](research.md) for all decisions and rationale.

**Key decisions**:
1. **H3 library**: `h3-js` (browser + Node compatible; used in server and overlay client)
2. **Anchor projection**: `h3.localIjToCell(anchorH3, { i: col, j: row })` — O(n), no drift accumulation
3. **Compass assignment**: Bearing-to-60°-sector quantization at map load time
4. **Pentagon detection**: `h3.getPentagons(15)` at startup; `h3.isPentagon(cell)` in loader
5. **Non-adjacent storage**: Neo4j `PORTAL`/`ELEVATOR` typed relationships with `name` property
6. **Colyseus compatibility**: Retain `tileCoords` map populated from `CellRecord.col`/`row`
7. **Overlay client location**: `client/map-overlay/`; map renderer choice deferred

---

## Phase 1: Design — COMPLETE

### Artifacts Generated

- [`data-model.md`](data-model.md) — Updated `CellId`, `CellRecord`, `LoadedMap`, `GhostRecord`, Neo4j node schema, pentagon portal seeding
- [`contracts/ic-005-cell-record-schema.md`](contracts/ic-005-cell-record-schema.md) — CellRecord schema with h3Index, migration impact table
- [`contracts/ic-006-exits-response-schema.md`](contracts/ic-006-exits-response-schema.md) — exits tool response including non-adjacent exits
- [`contracts/ic-007-traverse-tool-schema.md`](contracts/ic-007-traverse-tool-schema.md) — traverse tool input/output schema
- [`contracts/ic-008-colyseus-position-broadcast.md`](contracts/ic-008-colyseus-position-broadcast.md) — ghostTiles format change, Phaser compat path
- [`contracts/ic-009-tmj-map-schema.md`](contracts/ic-009-tmj-map-schema.md) — .tmj h3_anchor/h3_resolution property spec
- [`quickstart.md`](quickstart.md) — anchor setup, server startup, smoke test via ghost CLI, TCK, overlay client

### Implementation Order (for task generation)

The following order minimizes breaking periods for dependent packages:

**Stage 1 — Foundation (no external breakage)**
1. Add `h3-js` dependency to `server/colyseus` and `server/world-api`
2. Update `mapTypes.ts`: add `h3Index` to `CellRecord`, update `LoadedMap`
3. Update `hexCompass.ts`: add bearing-to-compass utility (alongside existing `neighborOddq` — both can coexist)
4. Update `mapLoader.ts`: parse `h3_anchor`, call `localIjToCell`, assign compass via bearing
5. Update `maps/sandbox/freeplay.tmj`: add `h3_anchor` and `h3_resolution` properties

**Stage 2 — Server broadcast and registry**
6. Update `room-schema.ts`: switch `tileCoords` keys to h3Index; `ghostTiles` values to h3Index
7. Update `MatrixRoom.ts`: ghost position strings are now h3Index
8. Update `server/registry/src/store.ts`: rename `tileId` → `h3Index` in `GhostRecord`

**Stage 3 — MCP interface extension**
9. Update `mcp-server.ts`: `whereami` adds `h3Index`; `exits` includes non-adjacent exits; register `traverse` tool
10. Add `evaluateTraverse` to `movement.ts`; update `evaluateGo` cell lookup to use h3Index key

**Stage 4 — Neo4j pentagon seeding**
11. Seed 12 pentagon `PORTAL` relationships at server startup (fully connected topology)
12. Query non-adjacent exits in `exits` tool implementation

**Stage 5 — Contract tests and overlay client**
13. Update `ghosts/tck` expected cell ID format in all scenarios
14. Scaffold `client/map-overlay` package with Colyseus connection and H3 → lat/lng marker rendering
