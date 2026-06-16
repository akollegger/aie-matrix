# Feature Specification: Map Catalog Standardization & Moscone West Map

**Feature Branch**: `020-map-catalog-standardization`  
**Created**: 2026-05-25  
**Status**: Draft  
**Input**: User description: "standardize the map catalog, removing support for the old tmj format, and drafting a moscone west with rooms and vendors for AIEWF"

## Proposal Context *(mandatory)*

- **Related Proposal**: `specs/010-tmj-to-gram/` (TMJ→Gram migration origin), `specs/013-gram-format-migration/` (gram format stabilization), `specs/014-map-management/` (map management API)
- **Scope Boundary**:
  - Remove all TMJ format support from `MapService`, `MapRoutes`, and `mapLoader` (colyseus)
  - Remove legacy `.items.json` sidecar files from `maps/sandbox/`
  - Delete or archive `.tmj` / `.tmx` source files from `maps/`
  - Retire the `tools/tmj-to-gram` converter (or tombstone it as read-only history)
  - Extend the existing `maps/moscone/moscone-west-ground-floor.map.gram` — or replace it — with a complete ground-floor layout including named rooms, a vendor hall, and a stage area representative of AIEWF
- **Out of Scope**:
  - Upper floors of Moscone West
  - Moscone North or East buildings
  - Real-time vendor-catalog integration (vendor metadata stays in the map file for now)
  - Ghost NPC placement or pathfinding rules beyond basic traversal

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Gram-only map loading (Priority: P1)

A world-server operator starts the server pointing at the `maps/` directory. The server builds its map catalog by scanning for `.map.gram` files only. No `.tmj` or `.tmx` files are read, and no `?format=tmj` download option is offered.

**Why this priority**: This is the core cleanup. Every downstream story depends on a clean, gram-only catalog contract.

**Independent Test**: Start `world-api` with the current `maps/` directory and verify that `GET /maps` returns only gram-format metadata, that `GET /maps/:mapId?format=tmj` returns `400`, and that server startup logs show no TMJ scanning activity.

**Acceptance Scenarios**:

1. **Given** the server starts with `maps/` containing only `.map.gram` files, **When** `GET /maps` is called, **Then** every entry in the response has a single download link pointing to `?format=gram`; no `tmj` key is present.
2. **Given** a client requests `GET /maps/freeplay?format=tmj`, **When** the server processes the request, **Then** it responds `400 Bad Request` with a message indicating only `gram` is supported.
3. **Given** the server restarts, **When** startup completes, **Then** no TMJ-related log lines appear and all previously TMJ-paired maps continue to load correctly from their `.map.gram` counterparts.

---

### User Story 2 — Moscone West ground-floor map browsable in the world (Priority: P2)

An AIEWF attendee (ghost agent) navigating the virtual world can enter Moscone West and move through labeled areas: Lobby, Expo Hall with vendor booths, Session Rooms (numbered), and the Main Stage.

**Why this priority**: The venue map is the primary content deliverable alongside the catalog cleanup and must be functional before the fair.

**Independent Test**: Publish `moscone-west.map.gram` to a running server, verify it appears in `GET /maps`, load it into a live session, and confirm that ghost agents can traverse between the lobby, vendor booths, session rooms, and stage without navigating through walls.

**Acceptance Scenarios**:

1. **Given** `moscone-west.map.gram` is published, **When** a ghost agent enters from an exterior cell, **Then** it can reach the Lobby area within the map.
2. **Given** a ghost in the Lobby, **When** it navigates toward the Expo Hall, **Then** it passes through traversable floor cells and reaches at least one named vendor booth tile.
3. **Given** a ghost in the Expo Hall, **When** it navigates toward a session room, **Then** it reaches a cell whose tile type carries the room's name (e.g., `Room 2001`).
4. **Given** a ghost in any indoor area, **When** it attempts to cross a wall cell, **Then** the movement is blocked (capacity 0 or no outgoing `GO` rule).

---

### User Story 3 — Map catalog lists Moscone West by name (Priority: P3)

An administrator reviewing the map catalog via the HTTP API sees `moscone-west` as a named, published entry alongside other venue maps.

**Why this priority**: Discoverability — operators and frontends need to reference the map by a stable ID.

**Independent Test**: Call `GET /maps` after publishing and verify a `moscone-west` entry with `name: "Moscone West"` and status `published`.

**Acceptance Scenarios**:

1. **Given** `moscone-west.map.gram` is present in `maps/moscone/`, **When** the server builds its catalog, **Then** `GET /maps` includes an entry with `mapId: "moscone-west"`.
2. **Given** the catalog entry exists, **When** a client fetches `GET /maps/moscone-west`, **Then** the response includes `name: "Moscone West"` and a download link for the gram file.

---

### Edge Cases

- What happens when a `.map.gram` file exists but its gram header `kind` is not `"matrix-map"`? → Server skips the file with a warning log; it does not appear in the catalog.
- What if a legacy `.tmj` file remains in `maps/` after the migration? → Server ignores it; no error is raised (silent skip).
- What if the Moscone West gram file references H3 indices that overlap with Moscone South cells? → Each map is an independent namespace; overlap is allowed and does not cause an error.
- What if `GET /maps/moscone-west?format=tmj` is requested after TMJ support is removed? → Returns `400` with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The map catalog MUST be built exclusively from `.map.gram` files; `.tmj` and `.tmx` files MUST NOT be indexed or read at server startup.
- **FR-002**: The `GET /maps/:mapId` download endpoint MUST support only `format=gram`; requests for `format=tmj` MUST return `400`.
- **FR-003**: The `GET /maps` listing response MUST NOT include a `tmj` URL field in any map entry.
- **FR-004**: The `colyseus` map loader (`mapLoader.ts`) MUST read map geometry from `.map.gram` files, not from `.tmj` files.
- **FR-005**: All `.tmj` and `.tmx` files in `maps/sandbox/` and `maps/moscone/` MUST be deleted or moved to an explicitly archived location outside the `maps/` tree.
- **FR-006**: All legacy `.items.json` sidecar files in `maps/sandbox/` MUST be deleted.
- **FR-007**: The `tools/tmj-to-gram` package MUST be tombstoned (marked deprecated in its `package.json` and `README`) or removed from the workspace.
- **FR-008**: `maps/moscone/moscone-west-ground-floor.map.gram` (or a replacement `moscone-west.map.gram`) MUST define at minimum the following named areas as distinct `TileType` definitions:
  - Lobby / Entry
  - Expo Hall (vendor floor)
  - At least three Vendor Booth tiles (distinguishable by name)
  - At least two named Session Rooms (e.g., `Room 2001`, `Room 2002`)
  - Main Stage
  - Corridor / Hallway connecting the above
  - Wall (capacity 0, impassable)
- **FR-009**: The Moscone West map MUST include a `LayerStack` with polygon-fill layers for each named area, plus explicit tile overrides for individual booths or rooms where polygon fill is insufficient.
- **FR-010**: The Moscone West map `rules` section MUST express `GO` transitions between traversable tile types (e.g., floor↔corridor↔lobby↔expo hall) and MUST NOT define `GO` rules from or to Wall tiles.

### Key Entities

- **MapCatalogEntry**: Identifier (`mapId`), display name, gram download URL, status (`published` | `archived`). No `tmj` field.
- **TileType** (in `.map.gram`): Identity node with `name`, `capacity` (0 = impassable wall), optional `style`.
- **VendorBooth**: A `TileType` subtype in Moscone West carrying a vendor name (e.g., `name: "Neo4j"`) and non-zero capacity.
- **SessionRoom**: A `TileType` subtype carrying a room number and non-zero capacity.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-001**: `GET /maps` response schema — the `_links` object per entry MUST contain only a `gram` key; the `tmj` key MUST be absent. Downstream consumers (admin UI, intermedium client) rely on this shape.
- **IC-002**: `MapIndexEntry` TypeScript interface — `tmjPath` field MUST be removed; interface becomes `{ mapId: string; gramPath: string }`.
- **IC-003**: `.map.gram` header for Moscone West MUST be `{ kind: "matrix-map", name: "Moscone West", elevation: 0 }` so the `mapId` derived from the filename and the `name` in the header are consistent with the rest of the venue map naming convention.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero TMJ-related code paths reachable in `world-api` and `colyseus` server packages after the change (verified by removing all `tmj` branches and confirming TypeScript compilation still passes with no dead-code suppressions).
- **SC-002**: The `GET /maps` endpoint continues to return all previously-catalogued maps with no functional regression; existing integration tests pass without modification to test fixtures.
- **SC-003**: The Moscone West gram file is parseable without errors by the existing `@aie-matrix/map-gram` parser and produces at least 200 traversable cells (sufficient to represent a meaningful floor area).
- **SC-004**: A ghost agent can navigate from the Lobby to a Vendor Booth in at most 15 movement steps (verifiable by path-length check in a unit test using the `rules` graph).
- **SC-005**: `pnpm typecheck` passes with no new errors after TMJ removal.

## Assumptions

- All `.tmj` files in `maps/sandbox/` already have a corresponding `.map.gram` counterpart — confirmed by the current `MapService` logic that skips un-migrated TMJ files.
- `maps/moscone/moscone-west.tmx` is a Tiled source file not loaded by the server; it is safe to delete or archive.
- The H3 anchor and resolution for Moscone West have already been established in the existing `moscone-west-ground-floor.map.gram`; new polygon geometry will reuse the same anchor region.
- Vendor booth names for the AIEWF Expo Hall are illustrative (e.g., `Neo4j`, `Anthropic`, `LangChain`) and can be updated without a spec revision.
- The `tools/tmj-to-gram` converter need not be fully deleted; tombstoning (deprecation notice + workspace exclusion from `pnpm dev`) is acceptable.

## Documentation Impact *(mandatory)*

- `specs/010-tmj-to-gram/` and `specs/013-gram-format-migration/` — add a closing note or `STATUS: superseded by 020` header so the migration history remains traceable.
- `docs/architecture.md` — update any open question about TMJ support to `resolved: gram-only as of spec-020`.
- `maps/moscone/README.md` (create if absent) — document the venue map naming convention, H3 anchor, and the AIEWF area taxonomy used in the gram files.
- `server/world-api/src/map/` source files — remove or update inline comments that reference IC-002 from spec-010 (the old maps HTTP API contract).
