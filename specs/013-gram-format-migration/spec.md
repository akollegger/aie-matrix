# Feature Specification: .map.gram Format Migration

**Feature Branch**: `013-gram-format-migration`
**Created**: 2026-05-03
**Status**: Draft
**Input**: User description: "migrate from tmj to new .map.gram file format across all servers and tools as described above, using canonical.map.gram as the reference example"

## Proposal Context *(mandatory)*

- **Related Proposal**: ADR-0005 (H3-Native Map Format), RFC-0009 (Map Format Pipeline), RFC-0010 (H3GeoJSON Map Editor)
- **Scope Boundary**: Update all map-consuming and map-producing components to support the layered `.map.gram` format introduced by the map editor (exemplified by `maps/sandbox/canonical.map.gram`). This includes the intermedium client parser, the Colyseus map loader, and the tmj-to-gram conversion tool. All existing old-format `.map.gram` files are converted to the layered format as part of this migration.
- **Out of Scope**: Multi-floor `.map.gram` wrapper format; Neo4j graph seeding from gram files; portal visualization in the intermedium client; movement-rule pathfinding in the client; map authoring UI changes; changes to the A2A ghost-house server.

## Clarifications

### Session 2026-05-03

- Q: Is backward compatibility required for old flat-cell format files? → A: No. All consumers exist within this repository; old-format files will be converted as part of this migration.
- Q: Should the parsing algorithm be shared code or parallel implementations? → A: New shared workspace package used by both Colyseus and intermedium.
- Q: How should old flat-cell `.map.gram` files be converted? → A: Re-run the updated `tmj-to-gram` tool against the original `.tmj` source files.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Map Author: Zero-Step Publishing (Priority: P1)

A map author creates or edits a map in the native map editor, exports it as a `.map.gram` file, drops it into the `maps/` directory, and the map is immediately usable in live gameplay and the spectator client — with no manual conversion step required.

Previously, Tiled-authored maps required a `tmj-to-gram` conversion pass, and even then the Colyseus server still read the original `.tmj` file. The layered `.map.gram` format is the single source of truth.

**Why this priority**: Every map authored with the new editor is currently broken in gameplay because Colyseus still reads `.tmj`. This is the most impactful gap.

**Independent Test**: Drop `canonical.map.gram` into `maps/sandbox/`, start the Colyseus server, and confirm a game room initialises with the correct tile topology. Value delivered: a fully playable map authored natively.

**Acceptance Scenarios**:

1. **Given** a `.map.gram` file using the layered format (polygon + tile + items layers), **When** the Colyseus game server starts, **Then** the room loads with the correct set of navigable cells, tile types, and initial item placements — with no `.tmj` file present.
2. **Given** the same `.map.gram` file, **When** the intermedium spectator client connects, **Then** it renders a tile map matching the authored layout (polygon fill expanded, tile overrides applied, items shown).
3. **Given** a `.map.gram` file that has no LayerStack declaration, **When** any consumer loads the file, **Then** the consumer reports a clear parse error identifying the missing structure.

---

### User Story 2 — Developer: Shared Parser Contract (Priority: P2)

A developer working on either the server or the client uses the same conceptual parsing algorithm to go from a `.map.gram` text document to a flat cell index (`h3Index → tileType + items`). The algorithm is the same in both consumers; only the runtime environment differs.

**Why this priority**: Without a shared mental model for parsing, the two consumers will diverge again. Establishing the canonical parse sequence (polygon fill → tile override → items overlay, respecting LayerStack order) prevents future drift.

**Independent Test**: Write a unit test that runs the parse algorithm against `canonical.map.gram` and asserts the expected cell count, tile types at specific H3 indices, and item placement — verifying both consumers produce identical output from the same input.

**Acceptance Scenarios**:

1. **Given** `canonical.map.gram`, **When** both the Colyseus loader and the intermedium parser process it, **Then** they produce an identical set of `(h3Index, tileType, items[])` tuples.
2. **Given** a polygon layer with four vertex H3 cells, **When** either consumer parses the file, **Then** all interior cells (computed via H3 polygon containment) are included in the output — not just the four vertices.
3. **Given** a tile layer with a `:Tile:Pillar` at an H3 cell that is also covered by a `:Polygon:Floor`, **When** either consumer parses the file, **Then** the cell's tile type is `Pillar` (tile override wins over polygon fill).

---

### User Story 3 — Map Author: Tiled-to-gram Conversion (Priority: P3)

A map author who still uses Tiled as their authoring tool runs `tmj-to-gram` on their `.tmj` file and receives a `.map.gram` file in the layered format that any consumer can load without further processing.

**Why this priority**: Until Tiled is fully retired as an authoring tool (per ADR-0005), the conversion pipeline must produce the layered format so converted maps enjoy the same first-class support as natively authored ones.

**Independent Test**: Run `tmj-to-gram` on an existing `.tmj` fixture, load the output in both consumers, and verify the cell topology matches what the current `.tmj`-based Colyseus loader would produce.

**Acceptance Scenarios**:

1. **Given** a valid `.tmj` file with a `layout` layer and optional item-placement layers, **When** `tmj-to-gram` converts it, **Then** the output is a `.map.gram` file using the layered format (with polygon and/or tile layers, an items layer if applicable, a LayerStack, and movement rules).
2. **Given** the converted `.map.gram`, **When** either consumer parses it, **Then** the result is the same cell topology as if Colyseus had read the original `.tmj` directly.

---

### Edge Cases

- What happens when a polygon layer contains fewer than 3 or more than 6 vertex cells? The parser logs a warning identifying the polygon by label and skips it; parsing continues and the file is not rejected.
- What happens when a `.map.gram` file has no LayerStack? Consumers must emit a clear error — not silently produce an empty map.
- What happens when a tile override references an H3 cell not covered by any polygon? The tile is included as a standalone cell (no implicit polygon fill required).
- What happens when an items layer places an item on a cell not present in any tile or polygon layer? The item is attached to an implicit "open" floor cell at that H3 index (matching current behaviour for item-only cells).
- What happens when `h3.polygonToCellsExperimental` returns zero cells for a given polygon? The consumer logs a warning and skips that polygon.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Colyseus map loader MUST load navigable floor topology from `.map.gram` files using the layered format, replacing the current `.tmj` reader.
- **FR-002**: The intermedium client parser MUST expand polygon layers into filled cells by applying H3 polygon containment using the vertex H3 cells stored in the `geometry` array.
- **FR-003**: Consumers MUST apply layer ordering as declared in the LayerStack: polygon fill is the base layer; tile instances override individual cells; items are overlaid on top.
- **FR-004**: Consumers MUST preserve Portal nodes parsed from tile layers and make them available in the loaded map data structure, even if not yet visualised.
- **FR-005**: Consumers MUST parse movement rules from the Rules walk and make them available in the loaded map data structure.
- **FR-006**: The `tmj-to-gram` tool MUST emit output in the layered format (Layer walks + LayerStack + Rules) rather than the flat-cell format.
- **FR-007**: All existing `.map.gram` files in the repository that use the old flat-cell format MUST be converted to the layered format as part of this migration.
- **FR-008**: The world-api server MUST validate that a `.map.gram` file contains a root record with `kind: "matrix-map"` and a LayerStack.
- **FR-009**: Parse errors MUST identify the problematic construct (polygon id, layer id, or cell H3 index) in the error message.
- **FR-010**: The Colyseus `CellRecord` and intermedium `WorldTile` interfaces MUST remain unchanged so that no upstream caller requires modification.
- **FR-011**: A new shared workspace package MUST be created to implement the canonical `.map.gram` parse algorithm; both Colyseus and the intermedium client MUST depend on it rather than maintain their own parsing logic.
- **FR-012**: Old flat-cell format `.map.gram` files in the repository MUST be regenerated by re-running the updated `tmj-to-gram` tool against their `.tmj` source files.

### Key Entities

- **Layer**: A named walk in a `.map.gram` file with a `kind` property (`"polygon"`, `"tile"`, or `"items"`). Contains anonymous element nodes that define map features.
- **PolygonElement**: An anonymous node `(:Polygon:TileTypeName { geometry: [h3\`...\`, ...] })` inside a polygon layer. Vertex H3 cells define the boundary; fill is computed at parse time.
- **TileElement**: An anonymous node `(:Tile:TileTypeName { geometry: [h3\`...\`] })` inside a tile layer. Overrides the tile type at a single cell.
- **PortalElement**: An anonymous node `(:Portal { geometry: [h3\`...\`, h3\`...\`], mode: "..." })` inside a tile layer. Declares a non-adjacent traversal link between two cells.
- **ItemElement**: An anonymous node `(:Item:ItemTypeName { geometry: [h3\`...\`] })` inside an items layer. Places an item instance at a cell.
- **LayerStack**: A walk `[layers:LayerStack | layerId1, layerId2, ...]` that declares the ordered set of layers in this map.
- **Rules**: A walk `[rules:Rules | (typeId)-[:GO]->(typeId), ...]` that declares permitted tile-type transitions.

### Interface Contracts

- **IC-001**: The Colyseus `CellRecord` (fields: `h3Index`, `tileClass`, `col`, `row`, `capacity`, `initialItemRefs`, `neighbors`) and the intermedium `WorldTile` (fields: `h3Index`, `tileType`, `items`, `neighbors`) remain structurally unchanged. The new parsers produce output that adapts to these shapes.
- **IC-002**: Portal data is exposed as an additional optional field or parallel collection in the loaded map result so that future visualisation and routing work can consume it without re-parsing.
- **IC-003**: The `tmj-to-gram` output format is the same layered format that the map editor produces, making the two authoring paths interchangeable from any consumer's perspective.
- **IC-004**: A new shared workspace package (e.g., `@aie-matrix/map-gram`) MUST export the canonical parse function used by both Colyseus and the intermedium client. Neither consumer may implement its own gram parsing logic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All `.map.gram` files in `maps/` load successfully in both the Colyseus server and the intermedium client with zero parse errors.
- **SC-002**: A map created in the native map editor is playable in a Colyseus game room within one minute of being placed in the `maps/` directory — with no manual conversion or restart required beyond a server reload.
- **SC-003**: The tile topology produced by the new Colyseus gram loader is identical to the topology the current `.tmj` loader produces for the same map content (verified by the existing test fixtures).
- **SC-004**: The intermedium client renders a correctly filled polygon region — at least the area defined in `canonical.map.gram` — with the right tile types and item glyph placement.
- **SC-005**: The `tmj-to-gram` tool's output passes `gram-lint` validation and loads without error in both consumers.

## Assumptions

- File extension stays `.map.gram`. The term `.world.gram` in the request is understood as a semantic description of the evolved format, not a file-extension rename.
- H3 resolution stays at 15 for all map cells. No resolution changes are in scope.
- The Colyseus hot-reload mechanism (watch mode) is not in scope; server restart is acceptable for picking up new map files.
- The intermedium client fetches map content at startup via `GET /maps/:mapId?format=gram`; no streaming or incremental updates are required.
- `h3.polygonToCellsExperimental` with `containmentOverlapping` mode is the correct H3 API call for polygon fill expansion.
- Movement rules and portal data need only be parsed and stored — acting on them (pathfinding, portal traversal visualisation) is out of scope for this feature.
- Old-format map files (`freeplay.map.gram`, `map-with-polygons.map.gram`, and others) will be converted by re-running the updated `tmj-to-gram` tool against their original `.tmj` source files, which must still be present in the repository.

## Documentation Impact *(mandatory)*

- `specs/010-tmj-to-gram/spec.md` — update to note that tmj-to-gram now emits the layered format; mark flat-cell format contracts as superseded.
- `specs/011-intermedium-client/spec.md` — update FR-006 and any references to the old regex-based parser contract to reflect the new layer-aware parser.
- `proposals/rfc/0009-map-format-pipeline.md` — update the conversion algorithm section to describe the new layered output format.
- `docs/architecture.md` — update any reference to `.tmj` as a runtime dependency of Colyseus to reflect `.map.gram` as the sole runtime format.
