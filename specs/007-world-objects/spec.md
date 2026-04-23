# Feature Specification: World Items

**Feature Branch**: `007-world-objects`  
**Created**: 2026-04-22  
**Status**: Draft  
**Input**: World objects as described in RFC-0006

## Proposal Context *(mandatory)*

- **Related Proposal**: [`proposals/rfc/0006-world-objects.md`](../../proposals/rfc/0006-world-objects.md) (authoritative design)
- **Scope Boundary**: Object definition sidecar files (`*.items.json`), tile placement via one or more Tiled tile layers with class `item-placement` (tile `type` = `itemRef`), in-memory world-state tracking of object positions in `ItemService` (seeded at startup, mirrored to Colyseus), and the MCP tools ghosts use to interact with objects: extended `look`, `inspect`, `take`, `drop`, and `inventory`. Capacity accounting update to include object costs. Effect `Layer` wiring for the new `ItemService` in `server/world-api/`.
- **Out of Scope**: Neo4j persistence or graph writes for live item positions (PoC uses in-memory state only), Phaser spectator rendering of items on tiles (deferred to a follow-up client RFC), item-gated movement rules (the Gram syntax for `PICK_UP`/`PUT_DOWN`/inventory-conditional `GO` rules is RFC-0002's concern), persistence of object positions across server restarts (object positions are re-initialised from sidecars on every startup), and object multiplicity distinguishing specific instances of identical objects beyond their tile associations.

> **Tight coupling notice**: This specification is intentionally synchronized with RFC-0006. Any deviation between this document and that proposal is a defect and must be discussed before implementation proceeds. The RFC is the authoritative source of truth; this document translates it into testable requirements. Implementation approaches may differ from RFC details, but those differences must be surfaced and approved — not silently resolved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghost Discovers Objects Nearby (Priority: P1)

A ghost agent issues `look` and sees a summary of items on its current tile and all adjacent tiles, including which direction each item is in. The ghost can immediately derive a movement goal from the `at` field — `"at": "ne"` means one `go { toward: "ne" }` brings it within reach.

**Why this priority**: Discovery is the entry point for every other object interaction. Until `look` returns objects, no other tool can be driven by an agent acting solely on world feedback.

**Independent Test**: A map has a sign on the ghost's current tile and a key on a northeast-adjacent tile. The ghost calls `look`. The response contains both objects, with `"at": "here"` for the sign and `"at": "ne"` for the key.

**Acceptance Scenarios**:

1. **Given** a ghost at tile T with a sign object present and a key object on the tile to the northeast, **When** the ghost calls `look { at: "here" }`, **Then** the response includes an `objects` array containing `{ id: "sign-welcome", name: "Welcome Board", at: "here" }` and `{ id: "key-brass", name: "Brass Key", at: "ne" }`.
2. **Given** a ghost at tile T with no items on T or any adjacent tile, **When** the ghost calls `look`, **Then** the `objects` array is present but empty.
3. **Given** a ghost at tile T with items on three different adjacent tiles, **When** the ghost calls `look { at: "around" }`, **Then** all three objects appear with their correct compass `at` values.
4. **Given** two distinct `item-placement` layers each painting a `chair` itemRef on different cells, **When** the server loads the map, **Then** each of those cells begins with its own `chair` ref in `ItemService` state (independent placements).

---

### User Story 2 — Ghost Inspects an Object Up Close (Priority: P2)

A ghost moves onto a tile containing an item and calls `inspect`. It receives the object's full description. Attempting to inspect an item on an adjacent tile returns a structured denial — the ghost must move to the tile first.

**Why this priority**: Inspection is the primary way ghosts read environmental information (signs, plaques, kiosks). It gates all storytelling and information-surfacing use cases.

**Independent Test**: A ghost is on the same tile as a sign. Calling `inspect { itemRef: "sign-welcome" }` returns the full description. The ghost then moves off the tile and calls `inspect` again — the response is `{ "ok": false, "code": "NOT_HERE" }`.

**Acceptance Scenarios**:

1. **Given** a ghost on the same tile as `sign-welcome`, **When** the ghost calls `inspect { itemRef: "sign-welcome" }`, **Then** the response is `{ "ok": true, "name": "Welcome Board", "description": "A large board listing the day's sessions and booth locations." }`.
2. **Given** an item with no `description` field in the sidecar, **When** the ghost calls `inspect`, **Then** the response contains only the `name` field.
3. **Given** a ghost on a different tile than the object, **When** the ghost calls `inspect { itemRef: "sign-welcome" }`, **Then** the response is `{ "ok": false, "code": "NOT_HERE", "reason": "That object is not on your current tile." }`.
4. **Given** an item ID that does not exist in the sidecar, **When** the ghost calls `inspect`, **Then** the response is `{ "ok": false, "code": "NOT_FOUND" }`.

---

### User Story 3 — Ghost Picks Up and Drops a Carriable Object (Priority: P3)

A ghost moves onto the tile with a carriable object, calls `take`, and the object moves from the tile into the ghost's inventory. The ghost can then move to another tile and call `drop` to place the object there. `look` reflects the new state after each action.

**Why this priority**: The carry/drop loop is the fundamental interaction enabling quest mechanics (key pickup, badge collection, gate-unlock). It resolves RFC-0002's deferred Open Question 3 (ghost inventory).

**Independent Test**: A ghost takes a brass key from tile A. `look` on tile A shows no key. The ghost moves to tile B and drops the key. `look` on tile B shows the key. `inventory` reflects the change at each step.

**Acceptance Scenarios**:

1. **Given** a ghost on the same tile as `key-brass` (carriable), **When** the ghost calls `take { itemRef: "key-brass" }`, **Then** the response is `{ "ok": true, "name": "Brass Key" }`, the object is no longer visible on the tile via `look`, and `inventory` lists `key-brass`.
2. **Given** a ghost on the same tile as a non-carriable object (`carriable: false`), **When** the ghost calls `take`, **Then** the response is `{ "ok": false, "code": "NOT_CARRIABLE" }` and the object remains on the tile.
3. **Given** a ghost carrying `key-brass`, **When** the ghost calls `drop { itemRef: "key-brass" }` on a tile that has room, **Then** the response is `{ "ok": true }`, `inventory` no longer lists the key, and `look` on that tile shows the key.
4. **Given** a ghost on a tile where `ghostCount + Σ(capacityCost of existing objects) = tile.capacity`, **When** the ghost tries to `drop` an item with `capacityCost > 0`, **Then** the response is `{ "ok": false, "code": "TILE_FULL" }` and the ghost's inventory is unchanged.
5. **Given** a ghost not currently carrying `key-brass`, **When** the ghost calls `drop { itemRef: "key-brass" }`, **Then** the response is `{ "ok": false, "code": "NOT_CARRYING" }`.

---

### User Story 4 — Ghost Checks Its Own Inventory (Priority: P4)

A ghost agent calls `inventory` to see what it is currently carrying. The tool returns an ordered list of carried item refs and names. An empty list is returned when the ghost carries nothing.

**Why this priority**: Without a dedicated inventory tool, a ghost agent cannot know what it is carrying without relying on implicit state tracking — which is fragile for LLM agents operating without persistent context.

**Independent Test**: A ghost picks up two objects. Calling `inventory` returns both. The ghost drops one. Calling `inventory` returns the remaining one. A ghost that has never picked anything up returns an empty list.

**Acceptance Scenarios**:

1. **Given** a ghost carrying `key-brass` and `badge-sponsor`, **When** the ghost calls `inventory`, **Then** the response is `{ "ok": true, "objects": [{ "itemRef": "key-brass", "name": "Brass Key" }, { "itemRef": "badge-sponsor", "name": "Sponsor Badge" }] }`.
2. **Given** a ghost carrying nothing, **When** the ghost calls `inventory`, **Then** the response is `{ "ok": true, "objects": [] }`.
3. **Given** a ghost that has taken and dropped objects across multiple tiles, **When** the ghost calls `inventory`, **Then** only currently-held objects appear.

---

### User Story 5 — Objects Block Tile Capacity (Priority: P5)

A world author places a statue (`capacityCost: 1`) on a tile with `capacity: 2`. Only one ghost at a time can share the tile with the statue. A ghost cannot drop another high-cost object onto a tile that has no remaining capacity.

**Why this priority**: Capacity-consuming items are what make obstacles meaningful and create spatial constraints that drive ghost navigation decisions.

**Independent Test**: A tile has `capacity: 2` and contains a statue (`capacityCost: 1`). One ghost can enter (total cost: 2). A second ghost is blocked. A ghost cannot drop a `capacityCost: 1` object onto a full tile.

**Acceptance Scenarios**:

1. **Given** a tile with `capacity: 2` and a statue with `capacityCost: 1`, **When** one ghost occupies the tile, **Then** the tile is at full capacity and a second ghost cannot enter.
2. **Given** a tile with `capacity: 2` and a statue (`capacityCost: 1`) and one ghost, **When** the ghost calls `drop { itemRef: "statue" }` (capacityCost 1) on that tile, **Then** the response is `{ "ok": false, "code": "TILE_FULL" }`.
3. **Given** an item with `capacityCost: 0` (e.g. a sign), **When** multiple copies are placed on a tile, **Then** they do not affect the tile's capacity for ghosts or other objects.

---

### User Story 6 — World Author Places Objects via Tiled (Priority: P6)

A world author edits a Tiled tileset (`.tsx`) to add an `objects` custom property to a tile class, and edits a map (`.tmj`) to optionally add an `item-placement` layer for tile-specific placements. On server startup the map loader reads both sources and populates the world graph with the correct items on the correct tiles.

**Why this priority**: The authoring workflow determines how the world is populated. Without it no items exist at startup.

**Independent Test**: A tileset has `objects: "sign-welcome"` on the `Hallway` tile class. The map has three Hallway tiles. On startup, each of those three tiles has a sign. A separate `item-placement` layer places `key-brass` on one specific tile. That tile has both the sign and the key; the other two have only the sign.

**Acceptance Scenarios**:

1. **Given** a tileset with `objects: "sign-welcome"` on the `Hallway` tile class and three Hallway tiles, **When** the server starts, **Then** each of the three tiles has a `HAS_OBJECT` relationship to a sign instance.
2. **Given** an `item-placement` layer with `key-brass` painted on one Hallway tile, **When** the server starts, **Then** that tile has both a sign and a key; the other two Hallway tiles have only the sign.
3. **Given** a map with no `*.items.json` sidecar file, **When** the server starts, **Then** startup succeeds with no errors and the map loads normally with no items.
4. **Given** an `objects` property referencing an ID not present in the sidecar, **When** the server starts, **Then** the server logs a warning and continues loading; the missing object is skipped.

---

### Edge Cases

- What happens when a ghost tries to `take` an item on an adjacent tile (not its current tile)? The response is `{ "ok": false, "code": "NOT_HERE" }`.
- What happens when the same object ID appears in both the tile-class property and the `item-placement` layer on the same tile? Both placements are applied — the tile starts with two relationships for that `itemRef`. This is intentional: they compose.
- What happens when a ghost takes one `chair` from a tile that has three chairs? One `HAS_OBJECT { itemRef: "chair" }` relationship moves to `CARRIES` on the ghost; the other two remain on the tile. The ghost's `take` targets any available instance; no instance selection is exposed.
- What happens when the sidecar JSON is malformed? The server logs an error and refuses to start (startup error, not a warning — a malformed sidecar indicates an authoring mistake).
- What happens when an item's `capacityCost` would cause a tile to exceed capacity at load time? The world is initialised with the declared objects regardless; overcapacity at startup is not an error. Runtime capacity checks apply only to `go` and `drop`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load `*.items.json` sidecar files alongside `.tmj` map files at startup. A missing sidecar MUST NOT be a startup error.
- **FR-002**: System MUST parse `objects` custom properties from `.tsx` tileset files and create one `HAS_OBJECT` world-state relationship per declared object ID per tile instance of the declaring tile class.
- **FR-003**: System MUST parse an `item-placement` tile layer from `.tmj` maps and create one `HAS_OBJECT` relationship per non-empty cell, using that cell's tile `type` as the `itemRef`.
- **FR-004**: Class-level placement (FR-002) and instance-level placement (FR-003) MUST compose: a tile may receive objects from both sources.
- **FR-005**: System MUST extend `look { at: "here" }` and `look { at: "around" }` responses with an `objects` array listing `{ id, name, at }` for all items on the current tile and all face-adjacent tiles. The `at` field MUST use `"here"` or a compass face token (`n`, `s`, `ne`, `nw`, `se`, `sw`).
- **FR-006**: System MUST expose an `inspect { itemRef }` MCP tool. The ghost MUST be on the same tile as the object. The tool MUST return `{ "ok": true, "name", "description" }` (or name-only if no description) on success, and a structured denial with `NOT_HERE` or `NOT_FOUND` on failure.
- **FR-007**: System MUST expose a `take { itemRef }` MCP tool. The object MUST be on the ghost's current tile and MUST have `carriable: true`. On success the `HAS_OBJECT` relationship MUST move to `CARRIES` on the ghost. Failure codes: `NOT_CARRIABLE`, `NOT_HERE`, `NOT_FOUND`, `RULESET_DENY`.
- **FR-008**: System MUST expose a `drop { itemRef }` MCP tool. The ghost MUST be currently carrying the object. On success the `CARRIES` relationship MUST move to `HAS_OBJECT` on the current tile. The drop MUST fail if it would cause the tile's effective capacity to be exceeded. Failure codes: `NOT_CARRYING`, `TILE_FULL`, `RULESET_DENY`.
- **FR-009**: System MUST expose an `inventory` MCP tool returning `{ "ok": true, "objects": [{ itemRef, name }] }`. An empty array MUST be returned when the ghost carries nothing.
- **FR-010**: Tile capacity accounting MUST be updated to: `ghostCount + Σ(capacityCost of objects with HAS_OBJECT on that tile) ≤ tile.capacity`. This formula MUST be evaluated for both ghost `go` attempts and `drop` attempts.
- **FR-011**: `take` and `drop` MUST be evaluated against the RFC-0002 ruleset graph when a ruleset is loaded (`PICK_UP` and `PUT_DOWN` edges respectively). When no ruleset is loaded, all `take` and `drop` operations on carriable objects MUST be permitted by default.
- **FR-012**: All new MCP tool handlers in `server/world-api/` MUST follow the Effect `Context.Tag` / `Layer` service pattern documented in `docs/guides/effect-ts.md`.
- **FR-013**: New error codes (`NOT_CARRIABLE`, `NOT_HERE`, `NOT_FOUND`, `RULESET_DENY`, `NOT_CARRYING`, `TILE_FULL`) MUST be covered in `server/src/errors.ts:errorToResponse()` using `Match.exhaustive`.
- **FR-014**: Object world state (`HAS_OBJECT` and `CARRIES` relationships) MUST be broadcast to Colyseus so Phaser spectators can observe object positions on tiles, even if no visual rendering is implemented in this feature.

### Key Entities

- **Item Definition**: A stateless JSON record in the sidecar file. Fields: `name`, `itemClass`, `carriable`, `capacityCost`, optional `description`. The definition never holds location.
- **Object Ref** (`itemRef`): The string key that identifies an item definition in the sidecar (e.g. `"key-brass"`). Used by ghosts to identify items in MCP tool calls, and by the world graph as the `itemRef` property on `HAS_OBJECT` and `CARRIES` relationships.
- **Item Instance** (world-state): An `(:ObjectInstance)` Neo4j node connected to either a tile (via `HAS_OBJECT`) or a ghost (via `CARRIES`). Multiple instances of the same `itemRef` are represented as multiple relationships, each pointing to a distinct node. Ghosts interact by `itemRef`; the world tracks by relationship.
- **Ghost Inventory**: The ordered list of `itemRef` values currently connected to a ghost via `CARRIES` relationships. Exposed to the ghost via the `inventory` tool.

### Interface Contracts *(mandatory)*

- **IC-010**: Object definition schema — `{ name: string, itemClass: string, carriable: boolean, capacityCost: integer, description?: string }` — defined in `shared/types/`. Consumed by the object loader, `inspect`, and the Colyseus broadcast.
- **IC-011**: Extended `look` response schema — `TileInspectResult` gains `objects: Array<{ id: string, name: string, at: "here" | CompassFace }>` — defined in `shared/types/`.
- **IC-012**: `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult` — new MCP tool result types — defined in `shared/types/`.
- **IC-013**: Sidecar file convention — `maps/<scene>/<mapname>.items.json` — a plain JSON object keyed by `itemRef`. Consumed by the map loader at startup.
- **IC-014**: `item-placement` tile layer convention — a named Tiled tile layer whose tile `type` values are `itemRef` strings; read by `mapLoader.ts` using the same grid-to-H3 logic as the navigable layer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A ghost agent issuing `look` on a tile adjacent to an item receives the object in the `objects` array with a correct compass `at` value — discoverable without any additional queries.
- **SC-002**: A ghost agent can complete the full pick-up-and-drop loop (`look` → `take` → move → `drop` → `look`) in five MCP tool calls, with each call returning a structured, unambiguous result.
- **SC-003**: Tile capacity accounting correctly blocks movement or drop when objects consume available capacity — no ghost can exceed a tile's limit regardless of object placement.
- **SC-004**: A world author can place items on all tiles of a given class in one Tiled property edit, and on a specific tile in one `item-placement` layer cell — no per-instance scripting required.
- **SC-005**: Server startup with a map that has objects completes without errors and all declared objects appear in the world graph at the correct tiles.
- **SC-006**: All five object-interaction tools (`look` extension, `inspect`, `take`, `drop`, `inventory`) return structured results for both success and failure paths — no unstructured errors reach the ghost agent.
- **SC-007**: Adding the object system requires no changes to `server/colyseus/` internals — the Colyseus bridge boundary is respected.

## Assumptions

- RFC-0002's ruleset graph (`PICK_UP`/`PUT_DOWN` edges) is not yet implemented. `take` and `drop` must function correctly with an absent ruleset (permissive default). The `RULESET_DENY` code is defined now so the interface is stable when RFC-0002 is implemented.
- Object world state (`HAS_OBJECT`, `CARRIES`) is re-initialised from sidecars on every server restart. Persisting object positions across restarts is a deployment decision deferred by RFC-0006 as an open question.
- The `mapLoader.ts` extension to read a second named tile layer (`item-placement`) is new work in this feature. The loader currently reads only `layers[0]` by index; it must be extended to find a layer by name.
- The sidecar file is decoupled from the map path via `AIE_MATRIX_ITEMS`. When unset, the loader falls back to co-locating the sidecar alongside the `.tmj` file. This follows the same pattern as `AIE_MATRIX_MAP` and `AIE_MATRIX_RULES` — each resource has its own env var. Different combinations of map, rules, and object sets are independently composable.
- Ghost agents use `itemRef` (the sidecar key) when calling `take`, `drop`, and `inspect`. When multiple instances of the same `itemRef` exist on a tile, `take` targets any available one — the world chooses which relationship to move; the ghost cannot specify a particular instance.
- The `whoami` tool is not extended in this feature. Inventory is only exposed via the new `inventory` tool.
- Phaser rendering of objects is deferred. The Colyseus broadcast of object state (FR-014) is included so the data pipeline is in place when the client RFC lands.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0006-world-objects.md` — must be kept in sync with implementation choices. Any divergence discovered during implementation must be discussed and approved; the RFC is updated to reflect accepted decisions before the spec is.
- `shared/types/` — new type exports (`ItemDefinition`, `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult`, extended `TileInspectResult`) must be documented in the package README.
- `server/world-api/README.md` — update tool inventory to include `inspect`, `take`, `drop`, `inventory`, and the `look` extension.
- `maps/<scene>/README.md` (or equivalent map authoring guide) — document the `*.items.json` sidecar format and the `item-placement` layer convention.
- `docs/architecture.md` — note that object state is tracked in Neo4j via `HAS_OBJECT` and `CARRIES` relationships and that `capacityCost` participates in tile capacity accounting.
