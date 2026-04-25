# Feature Specification: Map Format Pipeline

**Feature Branch**: `010-tmj-to-gram`  
**Created**: 2026-04-25  
**Status**: Draft  
**Input**: Map format pipeline as described in RFC-0009

## Proposal Context *(mandatory)*

- **Related Proposal**: [`proposals/rfc/0009-map-format-pipeline.md`](../../proposals/rfc/0009-map-format-pipeline.md) (authoritative design), [`proposals/adr/0005-h3-native-map-format.md`](../../proposals/adr/0005-h3-native-map-format.md) (format rationale)
- **Scope Boundary**: The `tools/tmj-to-gram` build-time CLI that converts `.tmj` + `*.items.json` sidecar + `*.tsx` tilesets into a committed `.map.gram` artifact; the `MapService` Effect Layer in `server/world-api/src/map/` that indexes and serves both formats; and the `GET /maps/:mapId?format=...` HTTP endpoint. Tile area (polygon and rectangle) conversion, overlap detection, compression/override logic, and the three-layer test strategy (structural invariants, golden CI byte-equality, headless pixel-diff) are all in scope.
- **Out of Scope**: `server/colyseus/src/mapLoader.ts` — it continues to read `.tmj` directly and is not modified. Neo4j gram-based seed (deferred follow-up). Round-trip `.map.gram → .tmj` conversion. Portal conversion (ignored with a warning, per ADR-0005 descope). Visual hint authoring (`color`, `glyph`) beyond emitting what already exists in `.tsx` properties. Multi-scene `mapId` namespacing beyond collision-as-startup-error.

> **Tight coupling notice**: This specification is intentionally synchronized with RFC-0009 and ADR-0005. Any deviation between this document and those proposals is a defect and must be discussed before implementation proceeds. The RFC is the authoritative source of truth; this document translates it into testable requirements.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Map Author Converts a Tiled Map to Gram (Priority: P1)

A world author has edited `maps/sandbox/freeplay.tmj` in Tiled. They run `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` from the repo root. The CLI reads the `.tmj`, its `.items.json` sidecar, and the referenced `.tsx` tilesets, then writes `maps/sandbox/freeplay.map.gram` next to the source. The author can inspect the gram, commit it, and the PR diff shows exactly which cells changed.

**Why this priority**: The conversion artifact is the foundation for everything else in this RFC — the HTTP endpoint serves it, CI validates it, and RFC-0008's intermedium consumes it. Without a working CLI the entire pipeline stalls.

**Independent Test**: Run `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj`. Assert a `.map.gram` file exists next to the source, that every `location` field is a valid H3 cell at resolution 15, and that the gram parses cleanly with `@relateby/pattern`.

**Acceptance Scenarios**:

1. **Given** `maps/sandbox/freeplay.tmj` with a valid `h3_anchor` custom property and `h3_resolution: 15`, **When** the author runs `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj`, **Then** `maps/sandbox/freeplay.map.gram` is written, the document header record contains `{ kind: "matrix-map", name: "freeplay", elevation: 0 }`, and the CLI exits 0.
2. **Given** a `.tmj` whose `h3_resolution` is not 15, **When** the CLI runs, **Then** it exits non-zero with an error message naming the offending property value. The gram file is not written.
3. **Given** a `.tmj` with no `h3_anchor` property, **When** the CLI runs, **Then** it exits non-zero with a clear error. The gram file is not written.
4. **Given** a `.tmj` with an `--out` flag specifying a different path, **When** the CLI runs, **Then** the gram is written to the specified path, not the default.
5. **Given** a `.tmj` with painted cells on the `layout` layer, **When** converted, **Then** each cell emits an `(<id>:<TileTypeLabel> { location: "<h3Index>" })` node and exactly one `(<typeId>:TileType:<TileTypeLabel> { name })` definition per unique tile type.
6. **Given** a `.tmj` referencing portal point objects, **When** converted, **Then** the CLI logs a warning per portal object and continues; no portal nodes appear in the gram.

---

### User Story 2 — RFC-0008 Intermedium Fetches Gram Format (Priority: P2)

The intermedium (RFC-0008) starts up and calls `GET /maps/freeplay?format=gram` to load the hex scene. It receives the `.map.gram` file body with `Content-Type: text/plain; charset=utf-8`, parses it with `@relateby/pattern`, and renders the hex tiles. No server restart or format negotiation is needed — the endpoint is always available once the world-api starts.

**Why this priority**: This is the primary consumer this RFC unblocks. Without the HTTP endpoint, RFC-0008 cannot begin implementation.

**Independent Test**: With the server running, `curl http://localhost:<port>/maps/freeplay?format=gram` returns HTTP 200, `Content-Type: text/plain; charset=utf-8`, and a body that parses as a valid gram document.

**Acceptance Scenarios**:

1. **Given** a running world-api with `maps/sandbox/freeplay.map.gram` indexed, **When** a client requests `GET /maps/freeplay?format=gram`, **Then** the response is 200 with body equal to the file contents and `Content-Type: text/plain; charset=utf-8`.
2. **Given** `GET /maps/freeplay` with no `format` query parameter, **When** handled, **Then** the response is the gram format (default) — identical to `?format=gram`.
3. **Given** `GET /maps/nonexistent`, **When** handled, **Then** the response is 404 with a structured JSON error body.
4. **Given** `GET /maps/freeplay?format=unknown`, **When** handled, **Then** the response is 400 with a structured JSON error body.

---

### User Story 3 — Phaser Debugger Fetches TMJ Format (Priority: P3)

The Phaser-based debugger that currently loads maps continues to work unchanged. It calls `GET /maps/freeplay?format=tmj` (or the same path it used before) and receives the original `.tmj` JSON. The new `MapRoutes` replaces any prior static-file serving without breaking the debugger.

**Why this priority**: The debugger is a live tool that must not regress. Verifying it keeps working through the new endpoint is a required gate before landing this RFC.

**Independent Test**: `curl http://localhost:<port>/maps/freeplay?format=tmj` returns 200, `Content-Type: application/json`, and the body parses as a valid `.tmj` JSON object matching the source file.

**Acceptance Scenarios**:

1. **Given** a running world-api, **When** a client requests `GET /maps/freeplay?format=tmj`, **Then** the response is 200 with the `.tmj` file body and `Content-Type: application/json`.
2. **Given** the Phaser debugger pointed at the world-api, **When** it loads the map, **Then** it renders the same scene as before (no visual regression against a pre-RFC baseline screenshot).

---

### User Story 4 — CI Validates Committed Gram Artifacts (Priority: P4)

In CI, after every push, a step re-runs `tmj-to-gram` on each `maps/**/*.tmj` and byte-compares the output against the committed `.map.gram`. Any conversion regression that silently changes output without a matching committed-file change fails the build with a diff.

**Why this priority**: The byte-equality check is what makes committed gram files a reliable source of truth rather than a manually maintained approximation. It closes the gap between "passes tests" and "artifact is correct".

**Independent Test**: Modify the conversion logic to emit cells in a different order, run `tmj-to-gram` on the sandbox fixture, and observe that the CI step reports a non-empty diff and exits non-zero.

**Acceptance Scenarios**:

1. **Given** committed `.map.gram` files that exactly match what the current converter produces, **When** CI runs `tmj-to-gram` on each `.tmj` and diffs the output, **Then** no diff is reported and the step exits 0.
2. **Given** a deliberate change to the converter (e.g. different sort order), **When** the developer re-runs the converter locally to regenerate goldens and commits the new `.map.gram`, **Then** CI passes again.
3. **Given** the same `.tmj` converted twice in the same process and on two different CI runners, **When** the outputs are compared, **Then** they are byte-identical (determinism invariant).

---

### User Story 5 — Tile Area (Polygon / Rectangle) Objects Convert Correctly (Priority: P5)

A world author adds a `tile-area` rectangle layer to `maps/sandbox/map-with-polygons.tmj` to declare a `Red` region. On conversion, the CLI emits a `[<id>:Polygon:Red | v1, v2, v3, v4]` node with the four corner cells as vertices. Cells interior to the rectangle that were painted `Red` on the `layout` layer are not emitted as individual nodes (compression). A `Pillar` override cell inside the rectangle is still emitted as an individual node (override).

**Why this priority**: Tile area support is the most complex part of the conversion algorithm. It must work correctly or the gram's implied cell coverage will diverge from the visible Tiled map.

**Independent Test**: Convert `maps/sandbox/map-with-polygons.tmj`. Assert: the gram contains a `Polygon` node for the Red area; no individual `Red` tile nodes exist for cells inside the Red polygon; the `Pillar` override node is present.

**Acceptance Scenarios**:

1. **Given** a rectangle `tile-area` object of type `Red` with no overlapping painted tiles, **When** converted, **Then** the gram contains a `[<id>:Polygon:Red | v1..v4]` node and zero individual `Red` cell nodes for its interior.
2. **Given** a polygon `tile-area` with painted `Pillar` cells inside, **When** converted, **Then** the gram contains the Polygon node and individual `Pillar` nodes for the override cells; no `Blue` individual nodes for the area's interior exist.
3. **Given** a `.tmj` with two overlapping `tile-area` objects, **When** the CLI runs, **Then** it exits non-zero, reporting both object IDs and the cell count of their intersection.
4. **Given** a `.tmj` with a `tile-area` object that has `"ellipse": true`, **When** the CLI runs, **Then** it exits non-zero with a clear error naming the object ID and name.
5. **Given** a `.tmj` with a polygon vertex in the gutter between hexes, **When** the CLI runs, **Then** it exits non-zero naming the object ID, vertex index, and pixel coordinate.
6. **Given** two non-overlapping polygons that share one vertex cell, **When** converted, **Then** the non-overlap check passes and both polygons appear in the gram.

---

### User Story 6 — Startup Validation Catches Malformed Gram (Priority: P6)

When the world-api starts, `MapService.validate()` parses each committed `.map.gram` with `@relateby/pattern`. A gram whose `name` metadata does not match its filename stem causes a typed startup error — the server refuses to start. This catches a copy-paste mistake or a regeneration that was committed under the wrong filename before any HTTP request is served.

**Why this priority**: Fail-fast at startup is cheaper than a confusing 500 at runtime. This gate ensures the artifact-to-endpoint contract is coherent before traffic arrives.

**Independent Test**: Place a malformed `.map.gram` (unparseable gram syntax) in `maps/sandbox/`. Start the server. Observe a typed startup error and a non-zero exit code — no HTTP requests are served.

**Acceptance Scenarios**:

1. **Given** a `.map.gram` with invalid gram syntax, **When** the world-api starts, **Then** startup fails with a typed `GramParseError` before any port is bound.
2. **Given** a `.map.gram` whose `name` metadata field is `"wrongname"` but the file is `freeplay.map.gram`, **When** the world-api starts, **Then** startup fails with a typed `MapNameMismatchError`.
3. **Given** two `.map.gram` files across different scene directories whose `name` metadata fields are identical, **When** the world-api starts, **Then** startup fails with a typed `MapIdCollisionError` naming both files.
4. **Given** all `.map.gram` files valid and names matching filenames, **When** the world-api starts, **Then** `MapService` initialises without error and the HTTP endpoint is available.

---

### Edge Cases

- What happens when a `.tmj` has no `.items.json` sidecar? The CLI proceeds without item nodes; no error or warning. The gram has no `ItemType` definitions and no item instance nodes.
- What happens when a sidecar entry has no corresponding `item-placement` cell? The entry is still emitted as an `ItemType` definition node; definitions and placements are independent.
- What happens when a `tile-area` object's `type` is not in any loaded `.tsx` tileset? The CLI logs a warning with the object ID, name, and unknown type. Conversion continues — the polygon node is still emitted.
- What happens when the `layout` layer contains a painted tile whose type is not in any tileset? Log a warning per cell and continue; the cell is still emitted with its `TileTypeLabel` drawn from the tile's `type` property.
- What happens when there is no `layout` layer? The gram contains only the document header, type definitions, and any item nodes. Conversion succeeds.
- What happens when a `mapId` collision occurs at startup? The server refuses to start regardless of whether the collision is within the same scene or across scenes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tools/tmj-to-gram` MUST be an ESM TypeScript package (`@aie-matrix/tmj-to-gram`) under `tools/tmj-to-gram/`. It MUST be runnable via `pnpm tmj-to-gram convert <path>` from the workspace root.
- **FR-002**: The CLI MUST accept a `.tmj` path as a required positional argument and an optional `--out <path>` flag. When `--out` is omitted, output is written next to the source with the filename stem and `.map.gram` extension.
- **FR-003**: The CLI MUST read `h3_anchor` (required), `h3_resolution` (MUST be 15), `elevation` (default 0), and `map_name` (default = filename stem) from the `.tmj` `properties` array. Missing `h3_anchor` or `h3_resolution ≠ 15` MUST cause a non-zero exit with a clear error message.
- **FR-004**: The CLI MUST emit a gram document header record: `{ kind: "matrix-map", name: <map_name>, elevation: <elevation> }`.
- **FR-005**: For each painted cell on the `layout` layer, the CLI MUST compute its H3 index via `h3.localIjToCell(anchor, { i: col, j: row })`, apply the tile-area compression rule, and emit an individual cell node for cells not covered by a matching tile-area polygon.
- **FR-006**: The CLI MUST emit one `(<typeId>:TileType:<TileTypeLabel> { name })` definition for each unique tile `type` encountered across all sources (`layout` layer, `tile-area` objects). Visual hints (`color`) MUST be emitted only when present in `.tsx` tile properties.
- **FR-007**: For each `tile-area` layer object (rectangle or polygon shape), the CLI MUST perform the full tile-area translation pipeline: reject ellipses, convert pixel vertices to H3 cells, emit a gram `[<id>:Polygon:<TileTypeLabel> | v1..vN]` node, compute the interior cell set for compression and overlap checks.
- **FR-008**: Ellipse `tile-area` objects MUST cause a non-zero exit with an error message naming the object `id` and `name`.
- **FR-009**: A polygon vertex that falls in the gutter between hexes (no containing hex) MUST cause a non-zero exit naming the object `id`, vertex index, and pixel coordinate.
- **FR-010**: After computing interior cell sets for all `tile-area` objects, the CLI MUST assert pairwise empty intersection. Any overlap MUST cause a non-zero exit reporting both object IDs and the overlap cell count.
- **FR-011**: The CLI MUST apply the compression/override rule: interior cells whose layout tile type matches the area type are omitted from individual-node emission; interior cells whose layout tile type differs are kept.
- **FR-012**: For each painted cell on any `item-placement` layer, the CLI MUST emit an item instance node `(<id>:<ItemTypeLabel> { location: "<h3Index>" })`.
- **FR-013**: For each entry in the `*.items.json` sidecar, the CLI MUST emit an `(<itemId>:ItemType:<ItemTypeLabel> { name, color?, glyph? })` definition. Sidecar entries with no matching placement are still emitted. Missing sidecar is not an error.
- **FR-014**: The CLI MUST produce byte-stable (deterministic) output: cells emitted in lexical H3-index order, items in lexical `itemRef` order, `tile-area` objects sorted by `id` before processing.
- **FR-015**: Portal point objects MUST be ignored with a per-object warning log. No portal nodes are emitted.
- **FR-016**: `MapService` MUST be an Effect `Context.Tag` + `Layer` in `server/world-api/src/map/MapService.ts`. At startup it MUST scan `maps/**/*.{tmj,map.gram}`, build an in-memory index keyed by `mapId`, and call `validate()` to parse each gram and verify `name` metadata matches the filename stem. A malformed gram, a name mismatch, or a `mapId` collision MUST each produce a distinct typed startup error.
- **FR-017**: `MapService.raw(mapId, format)` MUST return the on-disk byte stream for the requested format. `MapNotFoundError` MUST be thrown when `mapId` is unknown; `UnsupportedFormatError` MUST be thrown when `format` is neither `"tmj"` nor `"gram"`.
- **FR-018**: `MapRoutes` MUST mount `GET /maps/:mapId` (and `GET /maps/:mapId?format=tmj|gram`) on the world-api router. Default format MUST be `gram`. `Content-Type` MUST be `text/plain; charset=utf-8` for gram and `application/json` for tmj.
- **FR-019**: `MapNotFoundError` and `UnsupportedFormatError` MUST each have a `Match.tag` branch in `server/src/errors.ts:errorToResponse()`. The build MUST fail (`Match.exhaustive`) if either branch is missing.
- **FR-020**: `MapRoutes` MUST share request tracing and structured logging with existing world-api routes per `docs/guides/effect-ts.md`.

### Key Entities

- **`.map.gram` artifact**: A committed, derived file produced by `tmj-to-gram`. Contains a document header record, `TileType` definitions, individual tile cell nodes, `Polygon` nodes for tile-area objects, `ItemType` definitions, and item instance nodes. The source of truth is always `.tmj`; the gram is re-derivable.
- **`mapId`**: The `name` metadata field from the gram document header. Verified at startup against the filename stem. Used as the URL path segment in `GET /maps/:mapId`.
- **`TileType` definition**: A gram node `(<typeId>:TileType:<TileTypeLabel> { name, color? })` emitted once per unique tile type in the source map.
- **`ItemType` definition**: A gram node `(<itemId>:ItemType:<ItemTypeLabel> { name, color?, glyph? })` emitted once per sidecar entry.
- **`Polygon` node**: A gram node `[<id>:Polygon:<TileTypeLabel> | v1, v2, ..., vN]` where vertices are H3 cell IDs derived from the tile-area shape.
- **`MapService` index entry**: An in-memory record `{ tmj: string, gram: string }` mapping file paths, keyed by `mapId`.

### Interface Contracts *(mandatory)*

- **IC-001**: `.map.gram` gram format — document header, `TileType` definitions, cell instance nodes, `Polygon` area nodes, `ItemType` definitions, item instance nodes — defined in `specs/010-tmj-to-gram/contracts/ic-001-map-gram-format.md`.
- **IC-002**: `GET /maps/:mapId` HTTP API contract — path, query parameters, response bodies, content types, status codes, error shapes — defined in `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`.
- **IC-003**: `tmj-to-gram` CLI interface — positional arguments, flags, exit codes, warning and error message formats — defined in `specs/010-tmj-to-gram/contracts/ic-003-cli-interface.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A world author can run `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` from the repo root and produce a byte-identical gram on any machine with Node.js 24 installed — no environment-specific output.
- **SC-002**: `GET /maps/freeplay?format=gram` returns 200 within the same p99 latency budget as other world-api endpoints (file I/O; no gram parsing on request path).
- **SC-003**: `GET /maps/freeplay?format=tmj` returns 200 with the original JSON body — the Phaser debugger continues to work with zero code changes on its side.
- **SC-004**: CI byte-equality check on `maps/sandbox/*.map.gram` catches any conversion change that alters output, forcing it to surface as a PR diff.
- **SC-005**: The three-layer test suite passes: (1) structural invariants pass for every `maps/sandbox/` fixture, (2) golden CI byte-equality check passes, (3) headless pixel-diff between `.tmj`-rendered and `.map.gram`-rendered SVGs is zero pixels.
- **SC-006**: Server startup with all sandbox `.map.gram` files present succeeds and the `/maps` endpoint is reachable within the normal startup window.
- **SC-007**: A malformed or name-mismatched `.map.gram` causes a typed startup error with a clear message before the HTTP port is bound — no silent swallowing.
- **SC-008**: Adding `MapService` and `MapRoutes` requires no changes to `server/colyseus/src/` — the Colyseus room load path is untouched.

## Assumptions

- `maps/sandbox/freeplay.tmj` already exists and has valid `h3_anchor` and `h3_resolution: 15` properties (the user has already produced a manual `freeplay.map.gram` that this CLI will regenerate and replace).
- `@relateby/pattern` is already available in the monorepo (used by `server/world-api/src/rules/gram-rules.ts`) and `fast-xml-parser` is already available (used for tileset parsing). No new external dependencies are needed for the core converter.
- `h3-js` is already installed across the affected packages (added in `005-h3-coordinate-system`).
- The `.tsx` tileset files referenced by the `.tmj` are relative paths from the map file, following Tiled's default convention.
- The `items.json` sidecar is located by replacing the `.tmj` extension with `.items.json` (filename-stem convention), the same way `mapLoader.ts` currently locates it.
- The Colyseus room load path (`mapLoader.ts`) is not modified in this RFC. During the transition, the same `.tmj` is read by two separate code paths (Colyseus room state and world-api HTTP serving).
- `MapService` uses the gram's `name` metadata as `mapId`. Collision across multiple scenes is a startup error (deferred namespacing per RFC-0009 Open Question 4).
- The Layer 3 visual-parity test is test-only and is not a runtime dependency. The fallback color/glyph table lives in `tools/tmj-to-gram/test/render/fallbacks.ts` and covers the sandbox fixtures.
- The `pixelmatch` or equivalent pixel-diff library is a dev dependency of the test package only.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0009-map-format-pipeline.md` — must be kept in sync. Resolved open questions (e.g. committed artifact, content-type choice, polygon-to-cells provider decision) must be reflected back in the RFC before the spec is considered final.
- `server/world-api/README.md` — document the new `GET /maps/:mapId` endpoint and the `MapService` Layer.
- `tools/tmj-to-gram/README.md` — CLI usage (`pnpm tmj-to-gram convert`), inputs, output format, how to regenerate goldens for the Layer 3 test, how to add a new sandbox fixture.
- `maps/sandbox/README.md` (create if absent) — document the `.tmj` authoring conventions (`h3_anchor`, `h3_resolution`, `tile-area` layer), sidecar format, and how to regenerate `.map.gram` after a Tiled edit.
- `docs/architecture.md` — note the two-read transition (Colyseus reads `.tmj`; world-api reads `.map.gram`) and flag the follow-up RFC that will unify them.
- `server/src/errors.ts` — `MapNotFoundError` and `UnsupportedFormatError` must appear as new entries with their HTTP mappings documented in the file's header comment.
