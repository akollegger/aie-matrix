# Implementation Plan: Map Format Pipeline

**Branch**: `010-tmj-to-gram` | **Date**: 2026-04-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-tmj-to-gram/spec.md`

## Summary

Build the `.tmj → .map.gram` conversion pipeline: a new `@aie-matrix/tmj-to-gram` CLI package that converts Tiled `.tmj` + `*.items.json` sidecar + `*.tsx` tilesets into a committed `.map.gram` artifact; and a `MapService` Effect Layer + `MapRoutes` HTTP handler in `server/world-api` that indexes, validates, and serves both formats at `GET /maps/:mapId?format=gram|tmj`. This unblocks RFC-0008 (intermedium) and keeps the Phaser debugger working. See [research.md](./research.md) for all resolved open questions.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)
**Primary Dependencies**: `effect` v3+, `@effect/cli`, `@effect/platform-node`, `h3-js`, `@relateby/pattern`, `fast-xml-parser`, `zod` 3, `ulid` (node IDs), `pixelmatch` (Layer 3 test only), `pngjs` (Layer 3 test only)
**Storage**: On-disk `.map.gram` and `.tmj` files under `maps/`; in-memory `Map<mapId, MapIndexEntry>` in `MapService`
**Testing**: `vitest` (unit + structural invariants), `vitest` integration (HTTP contract), Layer 3 pixel-diff (`pixelmatch`)
**Target Platform**: Node.js 24 server (build-time CLI + runtime HTTP endpoint)
**Project Type**: CLI tool + Effect service + HTTP route (within existing monorepo)
**Performance Goals**: `MapService.raw()` is byte-passthrough (no gram re-parsing on request path); p99 latency equal to other world-api file-serving endpoints
**Constraints**: No modification to `server/colyseus/src/` — Colyseus internals are off-limits per AGENTS.md
**Scale/Scope**: 4 sandbox fixture maps; expandable to multi-floor Moscone maps; ~1 new package + 1 new directory in world-api

## Constitution Check

- [x] **Proposal linkage**: RFC-0009 (`proposals/rfc/0009-map-format-pipeline.md`) and ADR-0005 (`proposals/adr/0005-h3-native-map-format.md`) are the authoritative designs. Scope matches exactly.
- [x] **Boundary preservation**: `server/colyseus/src/mapLoader.ts` is not modified. `MapService` wraps around the gram files, not inside Colyseus. Effect Layer pattern followed per AGENTS.md.
- [x] **Contract artifacts**: IC-001 (gram format), IC-002 (HTTP API), IC-003 (CLI interface) are defined in `specs/010-tmj-to-gram/contracts/`.
- [x] **Verifiable increments**: 6 independently testable user stories. CLI has smoke test + Layer 1/2/3 test suite. HTTP endpoint has contract tests. Startup validation has dedicated negative tests. `quickstart.md` documents how to run each locally.
- [x] **Documentation impact**: `tools/tmj-to-gram/README.md`, `server/world-api/README.md`, `maps/sandbox/README.md` (update), `docs/architecture.md` (two-read transition note), `server/src/errors.ts` (new error entries).

**Post-design re-check**: All design decisions conform to the constitution. No PoC shortcuts introduced. The compression/override rule is complex but is fully specified in the RFC — no deviation.

## Project Structure

### Documentation (this feature)

```text
specs/010-tmj-to-gram/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-001-map-gram-format.md
│   ├── ic-002-maps-http-api.md
│   └── ic-003-cli-interface.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code

```text
tools/
└── tmj-to-gram/                   # @aie-matrix/tmj-to-gram (NEW package)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── cli.ts                 # @effect/cli entry — "convert" subcommand
        ├── converter/
        │   ├── parse-tmj.ts       # TMJ JSON → TmjDocument
        │   ├── parse-tsx.ts       # .tsx XML → TileTypeRegistry + GidMap (fast-xml-parser)
        │   ├── map-context.ts     # Extract + validate MapContext from TmjDocument
        │   ├── tile-area.ts       # TileAreaPolygon pipeline (vertex→H3, polygonToCells, overlap)
        │   ├── cell-emission.ts   # Layout layer → CellEmissionList (with compression/override)
        │   ├── item-emission.ts   # item-placement + sidecar → ItemEmissions
        │   └── serialize-gram.ts  # Emit gram text in canonical section order
        └── test/
            ├── unit/              # Layer 1: structural invariant tests per fixture
            ├── ci/                # Layer 2: byte-equality golden check
            └── render/            # Layer 3: SVG renderer + pixel-diff
                ├── fallbacks.ts   # Color/glyph table for tile types without visual hints
                ├── svg-renderer.ts
                ├── tmj-adapter.ts
                ├── gram-adapter.ts
                └── golden/        # Committed reference PNGs

server/world-api/src/
└── map/                           # NEW directory
    ├── MapService.ts              # Context.Tag + Layer (scoped; startup scan + validate)
    ├── MapRoutes.ts               # GET /maps/:mapId handler
    └── map-errors.ts              # MapNotFoundError, UnsupportedFormatError,
                                   # GramParseError, MapNameMismatchError, MapIdCollisionError

maps/sandbox/
├── freeplay.tmj                   # Existing (unchanged)
├── freeplay.map.gram              # Regenerated by CLI (committed artifact)
├── map-with-polygons.tmj          # Existing (used for polygon fixture tests)
├── map-with-polygons.map.gram     # New committed artifact
└── README.md                      # Update: tile-area authoring + gram regeneration
```

**Structure Decision**: Single new package `tools/tmj-to-gram/` for the CLI (consistent with `tools/` convention for build-time utilities). The world-api gains a new `map/` subdirectory alongside the existing `rules/` subdirectory — same depth, same pattern. No new top-level directories added.

## Complexity Tracking

No constitution violations. The compression/override algorithm is inherently complex (it was already specified in RFC-0009) but does not violate any principle — it is documented, specified, and testable.

---

## Implementation Phases

### Phase A: `tools/tmj-to-gram` CLI

1. Scaffold `tools/tmj-to-gram/` package (`package.json`, `tsconfig.json`, add to `pnpm-workspace.yaml`)
2. Implement `parse-tmj.ts` — read and type the `.tmj` JSON
3. Implement `parse-tsx.ts` — read `.tsx` via `fast-xml-parser`, build `TileTypeRegistry` + `GidMap`
4. Implement `map-context.ts` — extract + validate `MapContext` (h3_anchor required, h3_resolution=15)
5. Implement `tile-area.ts` — full pipeline: reject ellipses → pixel→H3 vertices → `polygonToCells` → overlap check
6. Implement `cell-emission.ts` — layout layer scan → compression/override filtering
7. Implement `item-emission.ts` — item-placement layer + sidecar fold
8. Implement `serialize-gram.ts` — deterministic gram text emission in canonical section order
9. Wire `cli.ts` — `@effect/cli` `convert` subcommand, stdin-free, exit codes per IC-003
10. Add `pnpm tmj-to-gram` workspace script to root `package.json`

### Phase B: Layer 1 tests (structural invariants)

11. Unit tests for `map-with-polygons.tmj` and `freeplay.tmj` — all IC-001 validation rules
12. Negative fixture tests: ellipse object, gutter vertex, overlapping tile-area objects

### Phase C: Committed golden artifacts

13. Run CLI on all sandbox `.tmj` files, commit resulting `.map.gram` files
14. Layer 2 CI step: byte-equality check script

### Phase D: `MapService` + `MapRoutes` (world-api)

15. `map-errors.ts` — five new typed errors per data-model
16. `MapService.ts` — `Layer.scoped` with startup glob, pair .tmj/.gram by stem, validate each gram
17. `MapRoutes.ts` — `GET /maps/:mapId` handler, format negotiation, byte-passthrough serving
18. Wire `MapService` + `MapRoutes` into `server/world-api/src/index.ts` + `server/src/errors.ts`

### Phase E: Layer 3 visual parity + integration tests

19. `tools/tmj-to-gram/test/render/` — SVG renderer, two adapters, pixel-diff harness, fallbacks table
20. HTTP contract tests for IC-002 assertions
21. Startup validation tests (malformed gram, name mismatch, mapId collision)

### Phase F: Documentation

22. `tools/tmj-to-gram/README.md`
23. `server/world-api/README.md` — document `GET /maps/:mapId`
24. `maps/sandbox/README.md` — tile-area authoring conventions, gram regeneration
25. `docs/architecture.md` — two-read transition note
