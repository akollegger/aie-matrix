# Feature Specification: H3 Geospatial Coordinate System

**Feature Branch**: `005-h3-coordinate-system`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "adopt h3 coordinate system as described in the RFC @proposals/rfc/0004-h3-geospatial-coordinate-system.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0004](../../proposals/rfc/0004-h3-geospatial-coordinate-system.md)
- **Scope Boundary**: Replace `CellId` ("col,row") with H3 res-15 indices as canonical cell identity; add `h3_anchor` property to Tiled maps for server-side H3 derivation; add a geospatial spectator overlay client; add non-adjacent traversal (`exits`/`traverse`) tools to the ghost MCP interface; establish 12 pentagon cells as permanent global portals.
- **Out of Scope**: Custom map authoring tooling (SVG/CAD import), pentagon portal topology design (deferred to follow-up RFC), sub-cell GPS positioning for phone spectators, migration of the Phaser spectator client.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ghost Navigates via H3 Coordinates (Priority: P1)

A ghost agent connects to the ghost world and navigates using the MCP compass interface (`n`, `s`, `ne`, `nw`, `se`, `sw`). Internally each cell is now identified by its H3 res-15 index rather than a col/row pair. From the ghost's perspective nothing changes — it still asks for available exits and chooses a compass direction.

**Why this priority**: This is the core identity change. Everything else depends on cells having valid H3 indices. A ghost that can move through an H3-indexed world proves the coordinate system is functional.

**Independent Test**: Load a map with a valid `h3_anchor`, issue a sequence of `go` commands, and confirm the ghost's reported position is a valid H3 res-15 index string after each step.

**Acceptance Scenarios**:

1. **Given** a map with a valid `h3_anchor` property, **When** the server loads the map, **Then** every navigable cell has a non-null, valid H3 res-15 index assigned.
2. **Given** a ghost at a cell with a known H3 index, **When** the ghost issues a `go { direction: "n" }` command, **Then** the ghost's new position is the H3 neighbor in the north bearing from the previous cell.
3. **Given** a ghost at any cell, **When** it calls `exits`, **Then** the response lists only compass directions that correspond to navigable neighboring cells (up to 6, or 5 at a pentagon).

---

### User Story 2 - Map Author Anchors a Tiled Map to Real-World Coordinates (Priority: P2)

A map author opens a `.tmj` file in Tiled, adds two custom map-level properties — `h3_anchor` (H3 res-15 index string) and `h3_resolution` (integer, always 15) — and saves. When the server loads the map it derives every cell's H3 index automatically from the anchor without requiring the author to manually assign indices.

**Why this priority**: Without anchor-based derivation, H3 indices cannot be assigned to existing maps, blocking the entire feature.

**Independent Test**: Load an existing `.tmj` map with a synthetic `h3_anchor`, verify that the derived H3 index for the cell at (col=0, row=0) matches the anchor, and that adjacent cells have H3 indices that are valid neighbors of the anchor.

**Acceptance Scenarios**:

1. **Given** a `.tmj` map with `h3_anchor = "8f2830828052d25"` and `h3_resolution = 15`, **When** the server loads the map, **Then** the cell at (col=0, row=0) receives H3 index `"8f2830828052d25"`.
2. **Given** a map loaded with an anchor, **When** the cell at (col=1, row=0) is inspected, **Then** its H3 index is a valid grid neighbor of the anchor cell.
3. **Given** a `.tmj` map without an `h3_anchor` property, **When** the server loads the map, **Then** it rejects the map with a clear error message indicating the missing anchor.

---

### User Story 3 - Spectator Sees Ghost Positions on a Real-World Map (Priority: P3)

A conference attendee opens a browser-based spectator view and sees ghost positions overlaid on a map of the venue. As ghosts move, their positions update in real time. The attendee can orient themselves by comparing ghost positions to physical landmarks.

**Why this priority**: This is the primary user-facing payoff of adopting H3. It requires the coordinate system to be working (P1) and anchored to real-world coordinates (P2).

**Independent Test**: With ghosts moving in the server, open the overlay client and confirm that ghost markers appear at geographically plausible positions on the map and update within 2 seconds of a ghost move.

**Acceptance Scenarios**:

1. **Given** a ghost at a known H3 index, **When** the spectator overlay client receives that position, **Then** the ghost marker is rendered at the correct lat/lng centroid of that H3 cell on the map.
2. **Given** a ghost that moves from one cell to an adjacent cell, **When** the move is broadcast by the server, **Then** the spectator overlay updates the ghost marker within 2 seconds.
3. **Given** a spectator on a mobile device, **When** they open the overlay client, **Then** the map renders and ghost positions are visible without requiring any installation.

---

### User Story 4 - Ghost Uses Non-Adjacent Traversal (Priority: P4)

A ghost arrives at a cell that has a named non-adjacent exit (elevator, portal). The `exits` tool lists this exit alongside compass directions. The ghost calls `traverse { via: "elevator-b" }` and is instantly relocated to the target cell, which may be on a different floor or in a different part of the venue.

**Why this priority**: Enables elevators and portals as first-class navigation primitives. Depends on P1 (H3 indexing working).

**Independent Test**: Create a map with two cells connected by a named `ELEVATOR` relationship, position a ghost at the source cell, call `exits`, confirm the elevator exit appears, call `traverse`, and confirm the ghost is at the destination cell.

**Acceptance Scenarios**:

1. **Given** a ghost at a cell with a named non-adjacent exit `"elevator-b"`, **When** it calls `exits`, **Then** the response includes `"elevator-b"` alongside any compass directions.
2. **Given** a ghost that calls `traverse { via: "elevator-b" }`, **When** the traversal succeeds, **Then** the ghost's position is set to the target cell of that exit.
3. **Given** a ghost that calls `traverse { via: "nonexistent-exit" }`, **When** the traversal is attempted, **Then** the ghost receives an error and its position is unchanged.

---

### Edge Cases

- What happens when a Tiled column/row projection drifts from the true H3 neighbor position at the far corner of a large map (e.g., 50×40 cells)?
- How does the system handle a cell with only 5 neighbors (pentagon cell) when compass directions are assigned?
- What happens when the `h3_anchor` value is not a valid H3 res-15 index string?
- How does the spectator overlay behave if a ghost's H3 index cannot be converted to lat/lng (corrupt state)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The server MUST load `h3_anchor` and `h3_resolution` from `.tmj` map-level custom properties and fail with a descriptive error if `h3_anchor` is absent or invalid.
- **FR-002**: The server MUST derive each cell's H3 res-15 index from the anchor by neighbor traversal at map load time, storing it in `CellRecord.h3Index`.
- **FR-003**: The server MUST assign compass labels to H3 neighbors by computing bearing from each cell's centroid to each neighbor's centroid and quantizing to the nearest of the six labels (`n`, `s`, `ne`, `nw`, `se`, `sw`).
- **FR-004**: The Neo4j world graph MUST use `h3Index` as the node identity property; `col` and `row` are retained as metadata properties but MUST NOT be used for graph traversal.
- **FR-005**: The ghost MCP `exits` tool MUST return both compass-direction neighbors and any named non-adjacent exits (relationship type `PORTAL`, `ELEVATOR`, etc.) available from the current cell.
- **FR-006**: The ghost MCP MUST expose a `traverse` tool that moves a ghost through a named non-adjacent exit and returns an error if the named exit does not exist at the current cell.
- **FR-007**: The spectator overlay client MUST convert ghost H3 indices to lat/lng using `h3.cellToLatLng` and render ghost markers on a real-world map.
- **FR-008**: The spectator overlay client MUST update ghost marker positions within 2 seconds of receiving a position broadcast from the server.
- **FR-009**: The system MUST treat the 12 H3 pentagonal cells as permanent global portals, exposing them as named non-adjacent exits when a ghost occupies one of them.
- **FR-010**: The `exits` and movement validation MUST handle pentagon cells (5 neighbors) without error or undefined behavior.

### Key Entities

- **CellRecord**: Represents a navigable map cell. Gains `h3Index: string` (canonical identity, H3 res-15 hex string). Retains `col: number` and `row: number` for authoring. `neighbors` values are H3 index strings.
- **MapAnchor**: A map-level authoring concept — the H3 index of the cell at (col=0, row=0), plus the resolution. Stored in `.tmj` map-level custom properties.
- **NonAdjacentExit**: A named graph relationship (`PORTAL`, `ELEVATOR`) between two cells that are not H3 grid neighbors. Carries a display name surfaced by `exits`.
- **PentagonPortal**: One of the 12 H3 pentagonal cells worldwide. Has 5 neighbors instead of 6 and is a permanent global portal in the ghost world cosmology.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-005**: `CellRecord` schema — `h3Index` field added as a required string; `neighbors` values changed from col/row strings to H3 index strings.
- **IC-006**: Ghost MCP `exits` response schema — must include both compass exits (keyed by direction label) and named non-adjacent exits (keyed by exit name).
- **IC-007**: Ghost MCP `traverse` tool schema — input `{ via: string }`, response mirrors `go` response on success, typed error on invalid exit name.
- **IC-008**: Colyseus state broadcast for ghost position — `position` field changed from `"col,row"` string to H3 index string; spectator overlay client depends on this contract.
- **IC-009**: `.tmj` map file schema extension — custom map-level properties `h3_anchor: string` and `h3_resolution: integer` defined and documented.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every cell in a loaded map has a valid, unique H3 res-15 index; zero cells have a null or duplicate `h3Index` after map load.
- **SC-002**: A ghost can complete a 40-step navigation sequence across a venue-scale map (1,500–2,000 cells) using only compass commands, with no navigation errors caused by the coordinate system change.
- **SC-003**: The spectator overlay renders ghost positions within 200m of the correct physical location for a venue-scale map (acceptable drift for anchor projection at res-15).
- **SC-004**: Ghost marker positions in the spectator overlay update within 2 seconds of a ghost move event 95% of the time under normal venue network conditions.
- **SC-005**: A ghost at a pentagon cell sees exactly 5 compass exits (not 6) and at least 1 named portal exit, with no runtime errors.
- **SC-006**: All existing ghost contract tests (TCK) continue to pass after the coordinate system change.

## Assumptions

- The Tiled authoring workflow (painting tiles, assigning `tileClass`) is retained unchanged; only map-level `h3_anchor`/`h3_resolution` properties are added.
- H3 neighbor traversal from the anchor produces acceptable drift for venue-scale maps (~200m × 200m at res-15); acceptable drift is defined as ≤200m between projected and true H3 position at the far corner of a 50×40 cell map (open question in RFC flagged for measurement during implementation).
- The compass approximation (bearing-to-label quantization) is perceptually accurate at venue scale and requires no correction mechanism.
- No conference venue used with this system contains a pentagon cell; pentagon portal behavior is tested with synthetic test data.
- The spectator overlay client is a separate package from the Phaser client and does not replace it.
- Technology choice for the overlay map renderer (MapLibre GL vs. Leaflet) is deferred to the implementation spec for that package.
- `col` and `row` fields are retained in `CellRecord` throughout this feature to avoid breaking the Tiled map loading pipeline; they are not used for graph traversal.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update coordinate system description; document `h3Index` as canonical cell identity.
- `proposals/rfc/0004-h3-geospatial-coordinate-system.md` — mark status as `accepted` after this spec is approved.
- Map authoring guide (to be created) — document `h3_anchor` and `h3_resolution` properties, how to choose an anchor, and how to convert a lat/lng to an H3 res-15 index.
- Ghost MCP interface documentation — document `exits` response schema changes and the new `traverse` tool.
