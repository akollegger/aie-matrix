# Implementation Plan: Map Catalog Standardization & Moscone West Map

**Branch**: `020-map-catalog-standardization` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/020-map-catalog-standardization/spec.md`

## Summary

Remove all TMJ/Tiled-format support from the running server (world-api MapService + MapRoutes, colyseus mapLoader), delete legacy `.tmj`/`.tmx`/`.items.json` map source files, tombstone the `tools/tmj-to-gram` converter, and rewrite `maps/moscone/moscone-west.map.gram` with a complete AIEWF ground-floor venue layout (Lobby, Expo Hall with named vendor booths, Session Rooms, Main Stage, Corridors, and Walls).

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `@relateby/pattern` (gram AST), `h3-js` ≥ 4 (H3 cell math), `@colyseus/core` 0.15.57, `vitest` (tests)  
**Storage**: Files — `.map.gram` in `maps/`; GCS in staging/production (not touched by this feature)  
**Testing**: `vitest` unit tests in `server/world-api` and `server/colyseus`  
**Target Platform**: Node.js server packages (`server/world-api`, `server/colyseus`)  
**Project Type**: Cleanup + content (no new packages; changes within existing monorepo packages)  
**Performance Goals**: No regression in map catalog load time (startup validation of all `.map.gram` files must complete in < 5 s locally)  
**Constraints**: Must not change the gram-format public API; only removes the TMJ side-path  
**Scale/Scope**: ~5 TypeScript source files modified, ~8 files deleted, 1 new map file authored

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Proposal linkage** ✅ — ADR-0005 and RFC-0009 establish `.map.gram` as canonical. A new ADR-0009 will be written in this feature to formally close the TMJ bridge (Constitution §I — required because `?format=tmj` is a public API capability being removed).
- **Boundary-preserving** ✅ — Changes are scoped to `server/world-api/src/map/`, `server/colyseus/src/`, and `maps/`. No new package boundaries introduced.
- **Verifiable increments** ✅ — Three independently testable user slices defined in spec. Existing unit tests cover gram-format paths; TMJ tests will be replaced with gram equivalents.
- **Contract-explicit interfaces** ✅ — IC-002 (old TMJ-aware HTTP contract) is formally superseded; a new `contracts/ic-001-maps-http-api.md` in this spec directory replaces it. `MapIndexEntry` interface change is documented in IC-002 of the spec.
- **Documentation impact** ✅ — `docs/architecture.md`, `specs/010-*/contracts/ic-002`, `maps/moscone/README.md` enumerated in spec and research.

**Post-Phase-1 re-check**: No new violations introduced. `UnsupportedFormatError` in `map-errors.ts` must be checked — if its only trigger was `format=tmj`, it can be removed; otherwise retained.

## Project Structure

### Documentation (this feature)

```text
specs/020-map-catalog-standardization/
├── plan.md              # This file
├── research.md          # Phase 0 complete
├── contracts/
│   └── ic-001-maps-http-api.md    # Gram-only HTTP API contract (supersedes IC-002 from spec-010)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code Changes

```text
# Modified — server/world-api
server/world-api/src/map/
├── MapService.ts          # Remove tmjPath, .tmj glob, "tmj" format branch
├── MapRoutes.ts           # Remove tmj link field, ?format=tmj handling
└── map-errors.ts          # Remove UnsupportedFormatError (if TMJ-only)

server/world-api/test/
├── map-routes.test.ts     # Remove assertTmjJsonShape + TMJ test cases
├── MapService.test.ts     # Update MapIndexEntry assertions (no tmjPath)
└── MapService-startup.test.ts  # Review for TMJ references

# Modified — server/colyseus
server/colyseus/src/
├── mapLoader.ts           # Delete loadTmjMap() + all TMJ types/helpers (lines 10–78, 234–411)
├── mapLoader.test.ts      # Replace TMJ test fixtures with gram equivalents
└── mapTypes.ts            # Review/remove TMJ-specific types

# Deleted — maps
maps/sandbox/
├── freeplay.tmj           # DELETE (gram counterpart exists)
├── map-with-polygons.tmj  # DELETE (gram counterpart exists)
├── read-and-collect.tmj   # DELETE (gram counterpart exists)
├── redbluegreen.tmj       # DELETE (gram counterpart exists)
├── common.items.json      # DELETE (legacy sidecar)
├── freeplay.items.json    # DELETE (legacy sidecar)
└── read-and-collect.items.json  # DELETE (legacy sidecar)

maps/moscone/
└── moscone-west.tmx       # DELETE (Tiled source; no server loader reads .tmx)

# Modified/Created — maps
maps/moscone/
├── moscone-west.map.gram  # REWRITE from moscone-west-ground-floor.map.gram
└── README.md              # CREATE — venue naming convention, H3 anchor, area taxonomy

# Tombstoned — tools
tools/tmj-to-gram/
├── package.json           # Add "deprecated": true
└── README.md              # Add deprecation notice header

# New — proposals
proposals/adr/
└── 0009-tmj-deprecation.md  # New ADR closing the TMJ bridge

# Updated — docs
specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md   # Add superseded header
docs/architecture.md                                        # Resolve open TMJ question
```

**Structure Decision**: All changes stay within existing package boundaries. No new top-level directories. `specs/020-map-catalog-standardization/contracts/` is the only new subdirectory, following the established spec contract pattern.

## Complexity Tracking

No constitution violations. No complexity tracking required.

---

## Phase 0: Research

✅ Complete. See [research.md](./research.md).

**Key findings**:
1. `loadTmjMap()` in colyseus is already `@internal`, not called at runtime — removal is safe
2. `MapService.raw()` needs format parameter removed; gram-only maps already reject TMJ requests
3. ADR-0009 needed to satisfy Constitution §I before the HTTP API change lands
4. IC-002 must be formally superseded; downstream "Phaser debugger" consumer is AIEWF-era and acceptable to drop TMJ for
5. Moscone West H3 cells are in `8f283082aa...` range (37.7842° N, 122.4015° W) at resolution 15

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md).

### Interface Contract: Maps HTTP API (gram-only)

**File**: `specs/020-map-catalog-standardization/contracts/ic-001-maps-http-api.md`

**Supersedes**: `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`

**Changes from IC-002**:
- `GET /maps/:mapId` — only `?format=gram` supported; `?format=tmj` returns `400`
- Response body for collection no longer includes `_links.tmj` per entry
- `MapIndexEntry` TypeScript interface: `tmjPath` field removed; `{ mapId: string; gramPath: string }`

### Moscone West Map Design

The rewritten gram file (`maps/moscone/moscone-west.map.gram`) defines a ground-floor layout for the AI Engineer World's Fair venue at Moscone West.

**TileType definitions**:

| Identity | TypeName | capacity | Notes |
|----------|----------|----------|-------|
| `floor` | `Floor` | 4 | General traversable surface |
| `wall` | `Wall` | 0 | Impassable structural boundary |
| `lobby` | `Lobby` | 6 | Main entry / welcome area |
| `corridor` | `Corridor` | 4 | Hallway / circulation path |
| `expo` | `ExpoHall` | 8 | Main vendor exhibition floor |
| `stage` | `MainStage` | 12 | Keynote / main stage area |
| `room_2001` | `Room2001` | 6 | Session room 2001 |
| `room_2002` | `Room2002` | 6 | Session room 2002 |
| `room_2003` | `Room2003` | 6 | Session room 2003 |
| `booth_a` | `VendorBoothA` | 3 | Vendor booth (illustrative: Neo4j) |
| `booth_b` | `VendorBoothB` | 3 | Vendor booth (illustrative: Anthropic) |
| `booth_c` | `VendorBoothC` | 3 | Vendor booth (illustrative: LangChain) |

**Layer structure**:
1. `ground` — tile layer (base; initially empty)
2. `building` — polygon layer, `Floor` fill (outer building footprint from existing file)
3. `lobby_layer` — polygon, `Lobby` fill (entry zone, north side)
4. `expo_layer` — polygon, `ExpoHall` fill (main floor)
5. `stage_layer` — polygon, `MainStage` fill (west end)
6. `corridor_layer` — polygon, `Corridor` fill (circulation paths)
7. `rooms_layer` — polygon, `Room200X` fills (breakout rooms, upper south)
8. `booths_layer` — explicit Tile overrides for each vendor booth cell
9. `walls_layer` — explicit Tile overrides for wall cells at structural boundaries

**Rules**:
```gram
[rules:Rules |
  (floor)-[:GO]->(floor),
  (floor)-[:GO]->(lobby),
  (floor)-[:GO]->(corridor),
  (lobby)-[:GO]->(lobby),
  (lobby)-[:GO]->(corridor),
  (lobby)-[:GO]->(expo),
  (corridor)-[:GO]->(corridor),
  (corridor)-[:GO]->(expo),
  (corridor)-[:GO]->(room_2001),
  (corridor)-[:GO]->(room_2002),
  (corridor)-[:GO]->(room_2003),
  (corridor)-[:GO]->(stage),
  (expo)-[:GO]->(expo),
  (expo)-[:GO]->(booth_a),
  (expo)-[:GO]->(booth_b),
  (expo)-[:GO]->(booth_c),
  (booth_a)-[:GO]->(expo),
  (booth_b)-[:GO]->(expo),
  (booth_c)-[:GO]->(expo),
  (room_2001)-[:GO]->(room_2001),
  (room_2002)-[:GO]->(room_2002),
  (room_2003)-[:GO]->(room_2003),
  (stage)-[:GO]->(stage)
]
```

Note: Wall has no `GO` rules (capacity 0 enforces impassability).

**H3 coordinate approach**: New polygon vertices are picked from the `8f283082aa...` and `8f283082ab...` H3 cell range that covers the Moscone West building footprint (already established in the existing file). Interior zone polygons are defined by 4–6 vertices that tile the building area. Exact cell indices are determined during implementation using `h3.latLngToCell` at resolution 15 for known floor-plan coordinates.

### Verification Path

1. Run `pnpm typecheck` — zero errors  
2. Run `pnpm test` in `server/world-api` — all tests pass (after TMJ test cases replaced)  
3. Run `pnpm test` in `server/colyseus` — all tests pass (after TMJ fixture swap)  
4. Start `pnpm dev`, call `GET /maps` — no `tmj` field in responses  
5. Call `GET /maps/freeplay?format=tmj` — expect `400`  
6. Call `GET /maps/moscone-west` — entry present with `name: "Moscone West"`  
7. Parse `maps/moscone/moscone-west.map.gram` with `@aie-matrix/map-gram` — ≥ 200 cells returned  

### Quickstart

See [quickstart.md](./quickstart.md).
