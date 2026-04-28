# RFC-0009: Map Format Pipeline (.tmj → .map.gram → HTTP)

**Status:** implemented  
**Date:** 2026-04-25  
**Authors:** @akollegger  
**Related:** [ADR-0005](../adr/0005-h3-native-map-format.md) (H3-native map format),
[RFC-0004](0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0006](0006-world-objects.md) (world objects / items sidecar),
[RFC-0008](0008-human-spectator-client.md) (intermedium / human spectator client)

## Summary

Implement the artifact, conversion, and serving halves of [ADR-0005](../adr/0005-h3-native-map-format.md). A new build-time CLI (`tools/tmj-to-gram`) converts a Tiled `.tmj` plus its `*.items.json` sidecar into a single `.map.gram` artifact. The world-api gains a `GET /maps/:mapId` endpoint that serves either format from the same source. The intermedium (RFC-0008) consumes `?format=gram`; the Phaser debugger consumes `?format=tmj`. The runtime room-load path inside Colyseus is **out of scope** for this RFC: the artifact and the endpoint contract are enough to unblock RFC-0008 without churning Colyseus internals.

## Motivation

ADR-0005 fixes the format. RFC-0008 needs a stable map endpoint to render the hex scene at startup. Two pieces of work follow directly:

1. **Conversion** — `.tmj` + `*.items.json` → `.map.gram`, runnable locally and in CI.
2. **Serving** — `GET /maps/:mapId?format=...` on world-api, debugger-compatible (`tmj`), intermedium-compatible (`gram`).

A third piece — switching the runtime Colyseus room loader from `.tmj` to `.map.gram` — is intentionally deferred. AGENTS.md flags `server/colyseus/src/` as off-limits to mid-flight refactors, and the switch requires a new Effect-Layer seam through the colyseus-bridge that is its own design problem. RFC-0008's intermedium does not need the runtime path to switch — only the HTTP endpoint to exist. Scoping this RFC to artifact + serving keeps the work landable in one PR and unblocks RFC-0008 without disturbing the room.

## Design

### Components and scope

```
maps/<scene>/<map>.tmj                ┐
maps/<scene>/<map>.items.json         ├── input (authored in Tiled, RFC-0006 sidecar)
maps/<scene>/*.tsx                    ┘

  ↓ tools/tmj-to-gram (CLI; build-time; not a runtime dependency)

maps/<scene>/<map>.map.gram           ── derived artifact (committed)

  ↑ GET /maps/:mapId?format=gram|tmj
       served by world-api MapRoutes

Consumers:
  - Phaser debugger        → ?format=tmj    (no change)
  - Intermedium (RFC-0008) → ?format=gram   (new)

Out of scope:
  - server/colyseus/src/mapLoader.ts (continues to read .tmj as today)
  - Neo4j gram-based seed (deferred to a follow-up)
```

During the transition, the `.tmj` is read twice in different contexts: once by Colyseus's existing `mapLoader.ts` for room state, and once by the world-api MapService for HTTP serving. Both read the same source files. Consolidating to a single load path is a follow-up RFC.

### `tools/tmj-to-gram` CLI

A new package, `@aie-matrix/tmj-to-gram`, in `tools/tmj-to-gram/`. ESM TypeScript per the workspace convention. Dependencies: `h3-js`, `@relateby/pattern` (already in repo, used by `server/world-api/src/rules/gram-rules.ts`), and `fast-xml-parser` (already in repo for tileset parsing).

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj
# writes maps/sandbox/freeplay.map.gram next to the source

pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj --out path/to/out.map.gram
```

**Inputs:**
- A `.tmj` path (required).
- The matching `*.items.json` sidecar, located by filename-stem convention (per `mapLoader.ts`).
- External `.tsx` tileset files referenced by the `.tmj`.

**Translation rules:**
- Read the `.tmj` properties: `h3_anchor` (required), `h3_resolution` (must be 15), `elevation` (default 0), `map_name` (default = filename stem).
- Emit the gram **document header** record: `{ kind: "matrix-map", name: <map_name>, elevation: <elevation> }`.
- For each painted cell on the `layout` layer:
  - Compute its H3 index via `h3.localIjToCell(anchor, { i: col, j: row })` — same call the legacy loader uses.
  - Apply the *tile-area compression rule* (next subsection); cells whose tile type matches an enclosing `tile-area` are not emitted as individual nodes.
  - Otherwise emit `(<id>:<TileTypeLabel> { location: h3\`<hex>\` })` (tagged string; see IC-001).
- For each unique tile `type` encountered (whether on `layout`, introduced by a `tile-area`, or both): emit one `(<typeId>:TileType:<TileTypeLabel> { name })` definition. Visual hints (`color`) are emitted only when present in tile properties — see Open Question 6.
- For each object on a `tile-area` layer: see *Tile area translation* below.
- For each painted cell on any `item-placement` layer: emit `(<id>:<ItemTypeLabel> { location: h3\`<hex>\` })`. The `ItemTypeLabel` is derived from the sidecar's `itemClass` field.
- For each `*.items.json` entry: emit one `(<itemId>:ItemType:<ItemTypeLabel> { name, color?, glyph? })` definition. Sidecar entries that are not placed are still emitted as definitions; placement and definition are independent.
- The map boundary is the axis-aligned bounding box of all H3 cells covered by the map (polygon-derived plus individually emitted), per ADR-0005. It is not authored and not stored in the gram.
- **Portals are out of scope** per ADR-0005's descope. The utility ignores any Tiled point objects that look like portal markers and logs a warning.

### Tile area translation

ADR-0005 Part 1 specifies the authoring conventions; this is the conversion algorithm.

**Pipeline per `tile-area` object:**

1. **Reject ellipses early.** A Tiled object with an `"ellipse": true` flag fails the conversion with a clear error pointing at the object's `id` and `name`. ADR-0005 excludes ellipses; the utility never silently approximates them.

2. **Pixel → hex → H3 per vertex.** Build the vertex pixel list:
   - **Polygon shapes** — use the object's `polygon` array of `{x, y}` points, offset by the object's `(x, y)`.
   - **Rectangle shapes** — synthesize four vertex points at the rect corners (`(x, y)`, `(x+w, y)`, `(x+w, y+h)`, `(x, y+h)`), in clockwise order.
   For each vertex, run point-in-hex resolution against the Tiled hex grid (`tilewidth`, `tileheight`, `hexsidelength`, `staggeraxis`, `staggerindex`) to find the `(col, row)` of the hex containing the point. Convert via `h3.localIjToCell(anchor, { i: col, j: row })`. ADR-0005's vertex-in-hex authoring rule guarantees each pixel lands inside exactly one hex; if a vertex falls in a gutter (no hex contains it), fail-closed with the offending object id, vertex index, and pixel coordinate.

3. **Emit a gram polygon node.** `[<id>:Polygon:<TileTypeLabel> | ref1, ref2, ..., refN]` where each `refK` is a Gram identifier for a tile instance defined in the same file (`cell-<h3>` when that layout cell is emitted, or `poly-<id>-v<i>` vertex stubs when the shape implies that hex and layout does not emit a `cell-*`). Values match the H3 indices from step 2, in vertex order. Tiled rectangles and polygons both lower to the same gram form (the gram has no rectangle primitive — see ADR-0005 Part 2).

4. **Compute interior cell set.** Run `h3.polygonToCells` over the vertex list (or the equivalent — see Open Question 8). The result is the strict **fill interior**. It is *not* enumerated into the gram. It is used for **pairwise non-overlap checks** only (below).

5. **Shape cover vs `layout`.** Build **shape cover** = fill interior ∪ **every vertex hex** (defining corners are always treated as part of the authored shape, independent of `polygonToCells` boundary behavior). For each H3 in shape cover:
   - If the `layout` layer has no painted tile at that cell, do nothing (the polygon instantiates it implicitly).
   - If the `layout` layer has a tile whose type matches the area's `type`, **omit** it from the individual-tile emission list (polygon is authoritative; no redundant `cell-*`).
   - If the `layout` layer has a tile whose type differs from the area's `type`, **keep** it in the emission list (override rule).
   The tile-emit step in *Translation rules* above consumes this filtered list.

6. **Type-mismatch warning.** If the area's `type` does not resolve to a known tile type in the loaded `.tsx` tilesets, log a warning naming the object id, name, and unknown type. Do not fail.

**Cross-area validation:**

- **Overlap detection.** After step 4 has run for every `tile-area` object, assert pairwise empty intersection of the **fill interior** sets (`polygonToCells` only — not vertex-only extensions). Any overlap fails the conversion with the two offending object ids and the cell count of their intersection. ADR-0005's non-overlap rule is enforced here; failure is the only correct response.

**Determinism note.** Tiled `draworder` (`"index"` or `"topdown"`) is irrelevant once non-overlap is enforced — no two areas claim the same cell, so iteration order does not affect output. The conversion sorts areas by `id` before processing for stable error messages and stable polygon-node ordering in the gram.

**Determinism.** Byte-stable output for the same input. Cells are emitted in lexical H3-index order; items are emitted in lexical `itemRef` order. This makes the artifact diff-friendly when committed and lets CI re-derive it as an equality check.

### `MapService` and HTTP endpoint (world-api)

A new directory `server/world-api/src/map/`:

- `MapService.ts` — Effect `Context.Tag` + `Layer`. At startup, scans `maps/**/*.{tmj,map.gram}` and builds an in-memory index keyed by `mapId`. `mapId` is the gram file's `name` metadata field (verified against the filename stem convention; a mismatch is a startup error). Each `mapId` maps to a `{ tmj, gram }` pair of file paths.
- `MapService.raw(mapId, format)` — returns the on-disk byte stream of the requested format. `MapNotFoundError` if `mapId` is unknown; `UnsupportedFormatError` if `format` is neither `"tmj"` nor `"gram"`.
- `MapService.validate()` (startup) — parses each `.map.gram` once with `@relateby/pattern` and asserts the `name` metadata field is present and matches the file's index entry. Catches malformed gram before the first HTTP request. No `LoadedMap` production here — that belongs to the follow-up RFC that switches the runtime path.
- `MapRoutes.ts` — HTTP handler mounted on the world-api router, alongside `/mcp` and `/registry`. Routes:

```
GET /maps/:mapId
GET /maps/:mapId?format=tmj
GET /maps/:mapId?format=gram
```

Default format is `gram`. Content-Type:

| format | Content-Type |
|---|---|
| `gram` | `text/plain; charset=utf-8` (normative; see § Open Questions item 2 — **Resolved**) |
| `tmj` | `application/json` |

Errors flow through `errorToResponse()` in `server/src/errors.ts`. Two new tagged errors are added: `MapNotFoundError` (→ 404) and `UnsupportedFormatError` (→ 400). Both must have a `Match.tag` branch in `errorToResponse` per AGENTS.md's "Match.exhaustive as a compile gate" convention; the build fails if either is omitted.

The endpoint shares request tracing and structured logging with the existing world-api routes per `docs/guides/effect-ts.md`.

### Tests

Syntactic correctness of the gram alone is a weak guarantee — a `.map.gram` can parse cleanly and still misrepresent the source map. The test strategy verifies the conversion at three layers, each catching a different failure mode.

**Layer 1 — Structural invariants (unit tests).** Property-style assertions over the conversion output for each fixture:
- Every emitted `location` (as `h3\`…\`` tagged string content, or legacy quoted form in older artifacts) decodes to a valid H3 index (`h3.isValidCell`) at resolution 15.
- Every individual tile node references a `TileType` that is also defined in the gram.
- Every item instance node references an `ItemType` that is also defined in the gram.
- Every `tile-area` polygon's vertex reference list is non-empty; each reference resolves to a defined instance whose `location` is a valid H3 cell at resolution 15.
- Pairwise interior cell sets of `tile-area` polygons do not intersect (non-overlap invariant).
- Shape-primary invariant: for every H3 in a polygon's **shape cover** (fill ∪ vertices), a `layout`-painted tile of the matching type is *not* present as an individual `cell-*` node, and a non-matching painted tile *is* present (override).
- Bounding-box invariant: the AABB derived from all emitted cells matches the AABB derived from the legacy `mapLoader.ts` output for the same `.tmj`.
- Item invariant: every entry in `*.items.json` appears as a definition; every placement appears as an instance.

**Layer 2 — Committed golden artifacts (CI byte-equality).** `maps/sandbox/*.map.gram` is checked in. A CI step re-runs `tmj-to-gram` on each `.tmj` and asserts byte equality against the committed gram. Any conversion change that affects output is forced to surface as a reviewable diff in the PR. Determinism (Layer 1) and golden artifacts (Layer 2) together let CI catch silent semantic drift even when no test was specifically written for the new behavior.

**Layer 3 — Headless reference renderer + pixel-diff (visual parity).** The risk this layer addresses: the gram parses, the structural invariants hold, but the resulting world *looks* wrong (a rotated polygon, a shifted anchor, a tile-class color mismatch, an off-by-one in `localIjToCell`). The test that catches this is rendering both formats and pixel-comparing the result.

A test-only `tools/tmj-to-gram/test/render/` tree contains:
- A shared **render intermediate** (merged terrain + items) built from `.tmj` (polygon shape cover + layout merge, mirroring conversion geometry) and from `.map.gram` (`Gram.parse` + `h3.polygonToCells` **plus** vertex hexes for each polygon).
- A minimal **flat-color SVG** emitter for human inspection, plus a **direct RGBA rasterizer** (same hex layout math) feeding `pngjs` so `pixelmatch` stays deterministic (no SVG→raster stack in CI).
- A pixel-diff harness (`pixelmatch`) that fails on any non-zero diff between the TMJ-derived and gram-derived PNGs.

For each fixture in `maps/sandbox/`, the test asserts the two PNGs are identical, then compares the TMJ-derived PNG to a committed **golden** snapshot. Color / item-marker fallbacks for types without hints live in `tools/tmj-to-gram/test/render/fallbacks.ts` — see Open Question 8.

The `golden/` directory holds reference PNGs from the TMJ path. Regenerate with `pnpm --filter @aie-matrix/tmj-to-gram golden:regen` when visuals change intentionally.

**Polygon-specific test fixtures.** `maps/sandbox/map-with-polygons.tmj` exercises:
- A rectangle area (`Red`) with no overlapping painted tiles → all cells implicit, no individual nodes emitted for the area's shape cover.
- A polygon area (`Blue`) covering a region that contains painted `Pillar` overrides → shape-primary omission emits zero redundant `Blue` individual nodes, override emits the `Pillar` nodes as expected.
- An area whose `type` introduces a tile class with no painted tiles → polygon-only fill works.
- Two non-overlapping polygons sharing a vertex → no-overlap check passes.
- (Negative) A handcrafted `.tmj` with two overlapping `tile-area` objects → conversion fails-closed with both object ids reported.
- (Negative) A handcrafted `.tmj` containing an `"ellipse": true` object → conversion fails-closed with a clear error.
- (Negative) A handcrafted `.tmj` with a polygon vertex in the gutter between hexes → conversion fails-closed naming the object id, vertex index, and pixel coordinate.

**Other tests:**
- **Determinism.** Convert the same `.tmj` twice in the same process and on different machines (CI matrix); the output bytes must match.
- **HTTP contract tests.** `GET /maps/freeplay?format=gram` → 200 + file body; `format=tmj` → 200 + JSON; default format is `gram`; unknown `mapId` → 404; unknown `format` → 400.
- **Startup validation.** A handcrafted `.map.gram` with malformed gram syntax causes a typed startup error. A gram whose `name` metadata does not match the filename stem causes a typed startup error. `mapId` collision across scenes causes a typed startup error.

### Migration sequence

1. Land `tools/tmj-to-gram` with the parity TCK against `maps/sandbox/`.
2. Run the CLI on `maps/sandbox/*.tmj`. Commit the resulting `.map.gram` files (the user has already done this manually for `freeplay.map.gram`; it will be regenerated and re-committed).
3. Land `MapService` and `MapRoutes`. The endpoint is additive — no flag, no toggle.
4. RFC-0008 implementation work consumes `GET /maps/:mapId?format=gram`.
5. (Out of scope; follow-up RFC) Switch the runtime room loader from `mapLoader.ts` to a gram-based loader. This requires an Effect-Layer seam through the colyseus-bridge and is its own change.

## Open Questions

1. ~~**Committed artifact vs derived-on-build.**~~ **Resolved.** Commit `.map.gram` files to the repository and add a CI step that re-converts each tracked `.tmj` and asserts byte equality against the committed `.map.gram`. Rationale: PR diffs stay reviewable (the author's Tiled edit and the derived gram land together); any silent converter drift fails CI instead of slipping through. Recorded in `specs/010-tmj-to-gram/research.md` (OQ-1).

2. ~~**`gram` content-type.**~~ **Resolved.** Serve gram bodies as `text/plain; charset=utf-8`. No vendor MIME type for now; revisit when the intermedium (RFC-0008) or another consumer has a concrete need for Content-Type–based discovery. Recorded in `specs/010-tmj-to-gram/research.md` (OQ-2).

3. ~~**Polygon support timing.**~~ **Resolved.** Polygon and rectangle `tile-area` objects are in scope for this RFC; see *Tile area translation* in Design. The sandbox fixture `maps/sandbox/map-with-polygons.tmj` exercises every shape and edge case the conversion must handle.

4. ~~**`mapId` namespacing.**~~ **Resolved.** `mapId` collision is a startup error. `MapIdCollisionError` is a typed startup failure in `MapService`; the server refuses to start rather than silently shadowing a map. Reopen when multi-scene production maps land and `<scene>/<name>` namespacing is needed.

5. ~~**Where the gram parser lives.**~~ **Resolved.** The two consumers (`MapService.validate()` and `server/world-api/src/rules/gram-rules.ts`) remain independent. No shared `gram/` module was introduced. Revisit when a third consumer appears.

6. ~~**Visual hint authoring (color, glyph).**~~ **Resolved.** Visual hints are left blank in the gram for now. The Layer 3 test renderer uses a static fallback table in `tools/tmj-to-gram/test/render/fallbacks.ts` (test-only; does not influence runtime). Authoring convention deferred to a follow-up once the intermedium has a concrete rendering need.

7. ~~**Round-trip back to `.tmj`.**~~ **Resolved.** No round-trip is implemented or needed. `.tmj` remains the source of truth; the gram is a derived artifact. The question was considered and closed.

8. ~~**Reference renderer fallback table.**~~ **Resolved.** Implemented as a static checked-in table in `tools/tmj-to-gram/test/render/fallbacks.ts` covering the sandbox tile types (`Blue`, `Cyan`, `Green`, `Yellow`, `Red`, `Purple`). Test-only; does not affect runtime rendering. Convention: add a row when adding a new sandbox fixture.

9. ~~**Polygon-to-cells provider.**~~ **Resolved.** Use `h3.polygonToCells` on `[lat, lng]` rings derived from each Tiled vertex (grid cell → `h3.localIjToCell(anchor, { i, j })` → `h3.cellToLatLng`, then pass vertices at resolution 15). Flood-fill in pure hex-grid space remains a documented fallback if projection precision ever fails at venue scale. Recorded in `specs/010-tmj-to-gram/research.md` (OQ-9).

## Alternatives

**Generate `.map.gram` on the fly inside world-api on each request.** Skip the discrete CLI; have the HTTP handler convert `.tmj` to gram lazily. Rejected: conversion errors would surface at the first HTTP request after deploy rather than at build/CI time, and authors would have no local tool to validate their Tiled work without running the server. A discrete CLI also gives the conversion its own testable surface.

**Skip the gram artifact and serve a JSON projection of `LoadedMap` over HTTP.** The intermedium could consume an already-parsed JSON payload, avoiding a gram parser in the client. Rejected: ADR-0005's rationale for gram is that it is a graph-shaped, committable record of the world. A JSON-projection convenience can be added without disturbing the format. Doing JSON-only would miss the architectural intent and re-introduce the translation layer ADR-0005 set out to remove.

**Static-file serving for `.tmj` (debugger) and dynamic serving only for `.map.gram` (intermedium).** Two endpoints, two surfaces. Rejected: a single `GET /maps/:mapId?format=...` endpoint is one route, one error path, one set of contract tests. Splitting saves a small amount of code at the cost of operational and documentation duplication.

**Move `mapLoader.ts` from `server/colyseus/` to `server/world-api/` in this RFC.** Relocate the legacy loader and rewrite it on top of `@relateby/pattern` in a single change. Rejected: AGENTS.md flags Colyseus internals as off-limits to mid-flight refactors. Touching the room load path also forces an Effect-Layer seam through the colyseus-bridge that is its own design problem. Bundling it would double the scope of this RFC and risk it landing nothing. Deferred to a follow-up RFC.
