# Feature Specification: H3GeoJSON Map Editor

**Feature Branch**: `012-h3geojson-map-editor`  
**Created**: 2026-04-28  
**Status**: Implemented (MVP complete)  
**Input**: User description: "a map editor to replace the use of Tiled, inspired by GeoJSON, and based on an existing h3-viewer as described in proposals/rfc/0010-h3geojson-map-editor.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0010](../../proposals/rfc/0010-h3geojson-map-editor.md) (H3GeoJSON Map Format and Native Map Editor), [ADR-0005](../../proposals/adr/0005-h3-native-map-format.md) (H3-native map format)
- **Scope Boundary**: A browser-based map editor forked from h3-viewer that authors `.map.gram` files directly in H3GeoJSON format. Covers: polygon drawing and fill, tile instance painting, portal authoring, item placement, and export/import of `.map.gram`. Targets single-map authoring for MVP (e.g. a single Moscone floor).
- **Out of Scope**: `.world.gram` world assembly editor; GeoJSON polygon import from external sources (vertex-snap workflow deferred); shared tile-type palette across multiple map files; pentagon cell portal authoring; multi-floor cross-map portals (those belong in `.world.gram`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View a Venue Location at R15 Resolution (Priority: P1)

A map author opens the editor in a browser, searches for or navigates to a real-world venue (e.g. Moscone West in San Francisco), and sees the area rendered as a grid of H3 resolution-15 cells overlaid on a street map. The author can pan and zoom; cells remain sharp and correctly positioned at all zoom levels.

**Why this priority**: Everything else depends on this. A working H3-on-map view proves the base fork is viable and gives authors spatial orientation before any editing begins.

**Independent Test**: Can be fully tested by opening the editor and navigating to a known address; no editing tools are needed. Delivers a working H3 cell viewer.

**Acceptance Scenarios**:

1. **Given** the editor is open, **When** the author navigates to Moscone West, **Then** the map displays H3 resolution-15 cells as a hex grid overlaid on the street map at that location.
2. **Given** the editor is showing cells, **When** the author zooms in, **Then** individual cells remain visible and correctly aligned to the underlying map.
3. **Given** the editor is showing cells, **When** the author pans to a different location, **Then** cells render correctly for the new viewport without gaps or misalignment.

---

### User Story 2 — Paint Tiles onto the Map and Export (Priority: P1)

A map author clicks individual H3 cells to mark them as tiles, then clicks Export and receives a `.map.gram` file containing those tile instances typed as "Floor" — the built-in tile type that is always present in the editor.

**Why this priority**: Painting + export is the minimal authoring loop. It proves cells can be selected, stored, and serialised to the target format — all downstream stories depend on a working tile layer and export.

**Independent Test**: Can be fully tested by clicking a handful of cells and exporting; no polygon tool or type palette needed. Delivers a valid minimal `.map.gram`.

**Acceptance Scenarios**:

1. **Given** the editor is showing H3 cells, **When** the author clicks an unpainted cell, **Then** the cell is highlighted as a tile instance.
2. **Given** the author clicks an already-painted cell, **Then** the cell is removed (toggle/erase).
3. **Given** one or more painted cells, **When** the author clicks Export, **Then** a `.map.gram` file is downloaded containing a `Floor` TileType definition, each painted cell as a `Floor` tile instance, and a valid map header.
4. **Given** an empty tile layer, **When** the author clicks Export, **Then** the file is produced with a validation notice that the map contains no tiles.

---

### User Story 3 — Draw a Polygon Region and Export (Priority: P1)

A map author switches to the polygon draw tool, clicks to place vertices tracing the outline of a hall, confirms the polygon, and sees the interior H3 cells fill in automatically. The author exports the result as a `.map.gram` file.

**Why this priority**: Polygon fill is the primary authoring technique for venue-scale regions — manually painting thousands of cells is impractical. This story validates the polygon-to-cell fill workflow end-to-end.

**Independent Test**: Can be fully tested by drawing one polygon over a small area and exporting; no tile painting or type palette needed. Delivers a `.map.gram` with a polygon shape and its derived cell set.

**Acceptance Scenarios**:

1. **Given** the polygon tool is active, **When** the author places 3 or more vertices and confirms, **Then** the polygon is committed and its interior H3 cells are rendered as virtual tiles (not stored as individual tile instances).
2. **Given** the author places only 2 vertices and attempts to confirm, **Then** the editor prevents confirmation and explains that at least 3 vertices are required.
3. **Given** a confirmed polygon, **When** the author exports, **Then** the `.map.gram` contains the polygon vertex list only; virtual tile cells are not enumerated individually.
4. **Given** a confirmed polygon, **When** the author deletes it, **Then** all virtual tiles from that polygon disappear from the map.

---

### User Story 4 — Combine Polygons and Hand-Painted Tiles (Priority: P2)

A map author draws a polygon to fill a large hall region, then switches to the tile paint tool to add individual cells along a corridor that the polygon did not cover, and paints a few cells inside the polygon with a different tile type (e.g. "Pillar") to mark obstructions. The combined result is exported as a single `.map.gram`.

**Why this priority**: Real venue maps are never pure polygons or pure paint. This story proves the two tools compose correctly and that the exported file reflects the merged, edited cell set faithfully.

**Independent Test**: Can be fully tested by drawing one polygon, painting a few extra cells outside it, erasing a cell inside it, and verifying the export matches the visual state.

**Acceptance Scenarios**:

1. **Given** a polygon region and the tile paint tool active, **When** the author clicks a cell outside the polygon, **Then** the new cell is added as an explicit tile instance.
2. **Given** a map with both virtual tiles (from polygons) and explicit tile instances, **When** the author exports, **Then** the `.map.gram` contains polygon shape blocks and explicit tile instance nodes; virtual cells are not enumerated individually.

---

### User Story 5 — Define Named Tile Types and Paint with Them (Priority: P2)

A map author opens the tile type palette, creates two tile types (e.g. "Carpeted Floor" and "Concrete Walkway") with names, descriptions, and CSS styles, then paints regions of the map with each type. The exported `.map.gram` includes the type definitions and each cell's assigned type.

**Why this priority**: Unnamed default tiles have no semantic value to the game engine. Named types are what make the map meaningful — pathfinding, capacity, and rendering all depend on them.

**Independent Test**: Can be fully tested by defining two types, painting a few cells of each, and verifying both type definitions and cell assignments appear in the export.

**Acceptance Scenarios**:

1. **Given** the tile type palette is open, **When** the author creates a type with name and CSS style, **Then** it appears in the palette and can be selected for painting.
2. **Given** two tile types defined, **When** the author paints cells with each type, **Then** each cell renders with its type's style and is distinguishable from cells of the other type.
3. **Given** a map with typed cells, **When** the author exports, **Then** the `.map.gram` contains both `TileType` definitions and each tile instance references its correct type.
4. **Given** a polygon confirmed with a tile type selected, **Then** all interior cells are assigned that type in the export.

---

### User Story 6 — Import a `.map.gram` for Continued Editing (Priority: P2)

A map author reopens a previously exported `.map.gram` file in the editor and continues editing — adding tiles, adjusting a polygon, or changing type assignments — then re-exports the updated file.

**Why this priority**: Without round-trip import, every editing session starts from scratch. Import closes the authoring loop and makes the editor a practical daily tool rather than a one-shot exporter.

**Independent Test**: Can be fully tested by exporting a map, reloading it, making one change, and verifying the re-export reflects both the original content and the new change.

**Acceptance Scenarios**:

1. **Given** a `.map.gram` file, **When** the author imports it, **Then** the editor restores all tile type definitions, tile instances, polygon shapes, and their type assignments.
2. **Given** an imported map, **When** the author adds new tiles and re-exports, **Then** the new export contains both the original and new tiles.
3. **Given** a `.map.gram` file with unrecognised properties, **When** the author imports it, **Then** the import completes with a warning listing unrecognised fields; all recognised content is restored.

---

### User Story 7 — Add Named Item Types and Place Item Instances (Priority: P3)

A map author creates item type definitions (e.g. "Brass Key" with a glyph and `takeable: true`) and places item instances on specific tile cells. Items are visible as glyphs in the editor and round-trip correctly through export and import.

**Why this priority**: Items enrich the map with interactive objects. The tile layer must be complete first; items layer on top of an established floor plan.

**Independent Test**: Can be fully tested by defining one item type, placing one instance on an existing tile, exporting, and verifying the item definition and instance appear in the `.map.gram`.

**Acceptance Scenarios**:

1. **Given** an item type defined with a glyph, **When** the author places an instance on a tile cell, **Then** the glyph is rendered on that cell in the editor.
2. **Given** an item instance placed on a tile, **When** the author exports, **Then** the `.map.gram` contains the `ItemType` definition and the instance with its H3 location.
3. **Given** an attempt to place an item on a cell not in the tile layer, **Then** placement is prevented.

---

### User Story 8 — Author Portals Between Tiles (Priority: P3)

A map author switches to the portal tool, selects two existing tile cells, and creates a typed directed Portal edge between them (e.g. mode `"Elevator"`). The portal is visible as a directed edge and round-trips through export and import.

**Why this priority**: Portals are the key capability Tiled cannot represent. They come last because they require an established tile layer to connect.

**Independent Test**: Can be fully tested by creating one portal between two tiles and verifying it appears correctly in the export.

**Acceptance Scenarios**:

1. **Given** two tile cells and the portal tool active, **When** the author selects both and creates a portal with mode `"Elevator"`, **Then** a directed edge is displayed between the cells labeled with the mode.
2. **Given** a portal, **When** the author exports, **Then** the `.map.gram` contains a `[:Portal { mode: "Elevator" }]` relationship between the two tile references.
3. **Given** an attempt to create a portal involving a cell not in the tile layer, **Then** the portal is rejected with an explanatory message.
4. **Given** a portal, **When** the author opens the property editor, **Then** they can change the `mode` and the change is reflected in the next export.

---

### Edge Cases

- What happens when a polygon vertex lands on a pentagon H3 cell? (Display a warning; do not silently include pentagon cells in fills — they are special per RFC-0004.)
- What happens when a `.map.gram` import encounters an unrecognised property? (Import completes with a warning listing unrecognised fields; valid content is preserved.)
- What happens when the map has zero tile instances at export time? (Allow export but include a validation notice that the map is empty.)
- What happens when the author uses the erase tool on a virtual tile (inside a polygon)? (No effect — erase only removes explicit tile instances. To mask a virtual tile, paint it with a different type.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The editor MUST render H3 cells on a real-world map base (OpenStreetMap or equivalent) at the configured resolution.
- **FR-002**: Polygon placement uses shape buttons (Triangle / Rectangle / Hexagon). One click on the map places a pre-computed polygon at that location. Vertex positions are pre-computed as anchor cells using `polygonAnchorCells`; they are the cells stored in `geometry`.
- **FR-002a**: Polygons can alternatively be placed by clicking individual vertex cells one at a time (polygon tool, freeform mode) and confirming; this path also computes and stores vertex cells.
- **FR-003**: A committed polygon's interior H3 cells (virtual tiles) are derived on-the-fly by the editor and by consumers using `h3.polygonToCellsExperimental` with `containmentOverlapping` mode. The full cell fill is **not stored** in the `.map.gram` file — only the N vertex cells appear in `geometry`.
- **FR-004**: The editor MUST prevent polygon confirmation with fewer than 3 vertices and display an explanatory message.
- **FR-004a**: Supported polygon shapes are triangle (3 vertices), rectangle (4 vertices), and hexagon (6 vertices). Pentagon is intentionally excluded.
- **FR-005**: The tile layer MUST support individual cell painting (add explicit tile instance with selected type) and erasing (remove explicit tile instance). The erase tool has no effect on virtual tiles; to mask a cell inside a polygon, the author paints an explicit tile of a different type over it.
- **FR-006**: Painting a cell that overlaps a virtual tile region creates an explicit tile instance at that cell, overriding the polygon's tile type at that location in both the editor and the export.
- **FR-006a**: Deleting a polygon MUST remove all its virtual tiles from the rendered map; explicit tile instances that happen to overlap the polygon's region are unaffected.
- **FR-006b**: A selected polygon can be dragged to a new location (hand tool). It can be double-clicked to enter vertex-edit mode, where individual vertex handles can be dragged to deform the shape.
- **FR-007**: The editor MUST include one built-in tile type ("Floor") that is always present and cannot be deleted; it may be renamed. The tile type palette MUST allow authors to create, edit, and delete additional tile type definitions with: name (required), description (optional), capacity (optional integer), style (optional CSS expression). Creating a new tile type automatically adds a self-movement rule for it.
- **FR-008**: The item type palette MUST allow authors to create, edit, and delete item type definitions with: name, description, glyph (Unicode character), takeable (boolean), capacityCost (integer), style (CSS expression).
- **FR-009**: Items layers MUST allow authors to place item instances at any H3 cell; each instance references its item type and records its H3 location.
- **FR-010**: The portal tool MUST allow authors to select two existing tile cells and create a typed directed Portal relationship between them; portal `mode` MUST be editable in the property editor.
- **FR-011**: The layer panel MUST support per-layer toggle of visibility and lock/unlock (edit-protection). Layers can be added, removed, renamed, and reordered.
- **FR-012**: All layer types (polygon, tile, items) are instances of a unified layer model. A map has one or more layers in an ordered stack; the active layer determines which tools are available and which element types receive edits.
- **FR-013**: Multiple layers of any kind are supported; each is independently nameable, visible, and lockable.
- **FR-014**: The editor MUST export the current map state to a `.map.gram` file. The format uses gram walks `[id:Layer {kind: "..."}| ...]` for layers and `[rules:Rules | ...]` for movement rules.
- **FR-015**: The editor MUST import a `.map.gram` file and restore all tile types, item types, tile instances, portals, item instances, layers, and movement rules exactly as authored. On import, polygon cell fills are recomputed from stored vertex cells.
- **FR-016**: The exported `.map.gram` MUST include the map header (`kind`, `name`, `description`, `elevation`). The bounding box is a derived display value and is NOT written to the gram file.
- **FR-017**: A properties panel MUST be always visible in the editor sidebar. When no element is selected, it displays map properties: name (editable), description (editable), elevation (editable integer), bounding box (read-only), and movement rules (read-only list). When a tile, polygon, portal, or item is selected, the panel shows that element's properties. Clicking the 📄 icon in the toolbar always returns to map properties.
- **FR-018**: The editor MUST serialise movement rules as `[rules:Rules | (fromId)-[:GO]->(toId), ...]` and restore them on import. The built-in initial rule is `Floor → Floor`.

### Key Entities

- **TileType**: Named, styled classification for tile instances; attributes: name, description, capacity, style (CSS). `id` is the gram identifier; `typeName` is the gram label.
- **ItemType**: Named classification for item instances; attributes: name, description, glyph, takeable, capacityCost, style (CSS).
- **TileInstance**: An explicitly painted H3 cell assigned a tile type. Only explicit instances are stored in the gram tile layer. An instance inside a polygon region overrides the polygon's tile type at that cell.
- **VirtualTile**: An H3 cell rendered because it falls inside a committed PolygonShape. Not stored; derived on-the-fly from polygon vertices. Disappears if the polygon is deleted.
- **PolygonShape**: N vertex H3 cells defining a closed filled region and its tile type. Serialised as `geometry: [h3`...`]` in the gram file. The full cell fill is derived from vertices by consumers using `polygonToCellsExperimental(containmentOverlapping)`.
- **Portal**: A typed directed relationship between two H3 cells in a tile layer; attributes: mode (string).
- **ItemInstance**: A placed item of a given item type at a specific H3 cell.
- **MovementRule**: A permitted traversal between two tile types, serialised as `(fromId)-[:GO]->(toId)` in the `[rules:Rules | ...]` walk.
- **Layer**: An independently visible/lockable authoring surface. All layers share a unified model (`MapLayer` union). Kind determines valid tools and element types: `"polygon"` | `"tile"` | `"items"`.

### Interface Contracts

- **IC-001**: Exported `.map.gram` MUST conform to the H3GeoJSON schema specified in RFC-0010, consumable by the game engine without transformation.
- **IC-002**: Imported `.map.gram` files produced by `tmj-to-gram` (the existing converter) MUST be accepted; any fields not in the RFC-0010 schema are imported with a warning but do not fail the import.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A map author can create a complete single-floor venue map (polygon region + tile types + at least one portal) in under 30 minutes without referring to documentation.
- **SC-002**: A `.map.gram` file exported from the editor loads correctly in the game engine on the first attempt, with no manual post-processing required.
- **SC-003**: Round-trip fidelity: a map exported and re-imported loses no tile instances, type definitions, portals, or item instances.
- **SC-004**: The editor handles a map with at least 5,000 tile instances (representative of Moscone West) without perceptible lag during tile painting or polygon fill.
- **SC-005**: 100% of tile and item type properties defined in the palette appear correctly in the exported `.map.gram` header sections.

## Assumptions

- Authors use a modern desktop browser (Chrome or Firefox, current release); mobile is out of scope.
- The h3-viewer fork provides the base H3 cell rendering, multi-cell selection, and map tile display; the fork adds layers, palette, property editor, and export/import.
- The game engine consumes `.map.gram` directly; no intermediate conversion step is required after this editor is adopted.
- H3 resolution 15 is the fixed working resolution for all cell indices, consistent with RFC-0004.
- The editor operates client-side only; no server-side persistence is required for MVP. Files are saved/loaded via browser file download/upload.
- Existing `.map.gram` files produced by `tmj-to-gram` are valid import targets and serve as the migration artifact from the Tiled workflow.
- Undo/redo is out of scope for MVP. Importing a previously exported `.map.gram` is the recovery path for unwanted edits. Undo is deferred to a future iteration.

## Clarifications

### Session 2026-04-28

- Q: Should the editor support undo/redo for MVP? → A: No undo for MVP — import is the recovery path; deferred to a future iteration.
- Q: When a polygon is deleted, what happens to its derived cells? → A: Delete polygon and all its virtual tiles together. Polygon-derived cells are virtual (rendered but not stored as tile instances); deleting the polygon removes them from the map.
- Q: What happens when the erase tool is used on a virtual tile inside a polygon? → A: No effect. Erase only removes explicit tile instances. To mask a virtual tile, paint it with a different type to create an explicit override.
- Q: What tile type do painted cells use before any types are defined? → A: A built-in "Floor" type is always present and cannot be deleted (though it may be renamed). It is the default selection in the palette and appears in the exported `.map.gram` as a real TileType definition.
- Q: How does the author set the map name and other header properties? → A: A properties sidebar panel is always visible. When nothing is selected, it shows map properties: name (editable, pre-filled `untitled-map`), description, elevation, and a read-only derived bounding box. When an element is selected, the panel shows that element's properties instead.

### Session 2026-05-02 (implementation review)

- Q: Should polygon shapes include pentagons? → A: No. Pentagon H3 cells are special (12 per resolution, irregular geometry). Supported shapes: triangle (3), rectangle (4), hexagon (6).
- Q: What does `geometry` store for a Polygon — the vertex cells or all fill cells? → A: Vertex cells only. The full fill is always derived by consumers using `polygonToCellsExperimental` with `containmentOverlapping`. This keeps files compact and makes vertex-drag editing the canonical editing operation.
- Q: Does the gram format need a `sides` property on polygons? → A: No — `sides` is `geometry.length`. It was removed from the serialised format; the editor derives it on import.
- Q: Where do portals live in the layer model? → A: Portals live inside tile layers, not in a separate portal layer. A tile layer walk can contain both `:Tile` and `:Portal` elements.
- Q: Should the editor support movement rules? → A: Yes. Rules are serialised as `[rules:Rules | (fromId)-[:GO]->(toId), ...]`. Variable identifiers are global within the file, so tile type node ids can be reused directly in rules. The editor generates a self-rule for every tile type automatically and displays all rules read-only in the map properties panel.
- Q: What layer model does the implementation use? → A: A unified `layers: MapLayer[]` array (bottom to top) replaces the original proposal's separate `tileLayer`, `polygonLayer`, `portalLayer`, `itemLayers[]` fields. All layer kinds share `id`, `name`, `visible`, `locked`.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0010-h3geojson-map-editor.md` — this spec implements RFC-0010; the RFC should be updated to `accepted` status once the spec is approved.
- `docs/architecture.md` — update the authoring workflow section to reference the native map editor and retire the Tiled/`tmj-to-gram` pathway.
- A new `docs/guides/map-editor.md` guide covering how to launch the editor, draw a map, and export for use with the game engine.
