# Tasks: H3GeoJSON Map Editor

**Input**: Design documents from `specs/012-h3geojson-map-editor/`  
**Branch**: `012-h3geojson-map-editor`  
**Package**: `tools/map-editor/` (`@aie-matrix/map-editor`)

**Tests**: Vitest unit tests for `io/export-gram.ts` and `io/import-gram.ts`. Browser smoke tests documented in `quickstart.md`.

**Organization**: Tasks grouped by user story; each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1–US8)

---

## Phase 1: Setup

**Purpose**: Create the `tools/map-editor` package and wire it into the workspace.

- [ ] T001 Add `tools/map-editor` entry to `pnpm-workspace.yaml`
- [ ] T002 Create `tools/map-editor/package.json` for `@aie-matrix/map-editor` with deps: `maplibre-gl ^5`, `h3-js ^4`, `@relateby/pattern ^0.4`, `react ^18`, `react-dom ^18`; devDeps: `vite ^6`, `@vitejs/plugin-react`, `typescript ~5.7`, `vitest`, `@types/react`, `@types/react-dom`
- [ ] T003 [P] Create `tools/map-editor/tsconfig.json` targeting browser ESM (extend workspace `tsconfig.base.json`)
- [ ] T004 [P] Create `tools/map-editor/vite.config.ts` with `@vitejs/plugin-react` and `wasm`/`top-level-await` plugins
- [ ] T005 [P] Create `tools/map-editor/index.html` entry point and `tools/map-editor/src/main.tsx` React root mount

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, state model, and app shell that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 Create domain types in `tools/map-editor/src/types/map-gram.ts`: `H3Index` branded string, `MapMeta`, `TileType`, `ItemType`, `TileInstance` (explicit only — not virtual), `PolygonShape` (vertices + typeName; no derived cells), `Portal`, `ItemInstance`
- [ ] T007 [P] Create editor runtime state types in `tools/map-editor/src/state/editor-state.ts`: `TileLayer`, `PolygonLayer` (committed shapes + inProgress vertices), `PortalLayer`, `ItemLayer`, `UIState`, `MapEditorState` root
- [ ] T008 Create `tools/map-editor/src/state/editor-reducer.ts`: action type union and `editorReducer` skeleton with initial state (empty layers, built-in Floor TileType, activeTool `"paint"`)
- [ ] T059 Add `SELECT_ELEMENT` and `DESELECT` actions to `tools/map-editor/src/state/editor-reducer.ts`; extend `UIState` with `selectedElement: { type: "tile" | "polygon" | "portal" | "item"; id: string } | null` (default `null`)
- [ ] T009 [P] Create `tools/map-editor/src/App.tsx` with split-pane layout: map canvas fills left; right sidebar holds LayerPanel, palette panels, and PropertyEditor
- [ ] T010 Create `tools/map-editor/src/MapEditor.tsx`: React Context provider wrapping `useReducer(editorReducer, initialState)`; renders `App.tsx` layout
- [ ] T011 [P] Create `tools/map-editor/src/panels/LayerPanel.tsx`: toggle visibility and lock/unlock for tile, polygon, portal, and item layers; reads from editor state
- [ ] T012 [P] Create `tools/map-editor/src/panels/PropertyEditor.tsx` shell: when nothing is selected renders map property fields (name, description, elevation inputs; bounding-box read-only display); when element selected renders placeholder

**Checkpoint**: Foundation ready — all user story phases can now begin.

---

## Phase 3: User Story 1 — View H3 R15 Grid (Priority: P1) 🎯 MVP

**Goal**: Open the editor in a browser, navigate to a real-world location, and see H3 resolution-15 cells rendered as a hex grid on a MapLibre GL base map.

**Independent Test**: `pnpm dev` in `tools/map-editor/`; navigate to Moscone West (37.784°N, 122.400°W); confirm hex grid renders and stays aligned while panning and zooming.

- [ ] T013 [US1] Implement `tools/map-editor/src/map/MapView.tsx`: initialize a MapLibre GL map with an OpenStreetMap tile source; mount into the editor canvas pane
- [ ] T014 [US1] Implement `tools/map-editor/src/map/H3HexLayer.ts`: on each `moveend`/`zoomend` event enumerate viewport H3 R15 cells via `h3.polygonToCells(viewportBounds, 15)`, convert each to a GeoJSON polygon via `h3.cellToBoundary`, push as a MapLibre GeoJSON source + `fill` + `line` layer
- [ ] T015 [US1] Wire viewport change events in `MapView.tsx` → trigger H3HexLayer re-enumeration; debounce to avoid thrashing on rapid pan
- [ ] T016 [US1] Wire `PropertyEditor.tsx` map-properties view: bind name/description/elevation inputs to `UPDATE_META` reducer action; compute and display bounding box from all polygon vertices + explicit tile cells
- [ ] T060 [US1] Wire element selection in `MapView.tsx`: when `activeTool === "paint"`, a secondary click on an already-painted cell dispatches `SELECT_ELEMENT({ type: "tile", id: h3Index })`; clicking empty space dispatches `DESELECT`
- [ ] T061 [US1] Wire layer visibility in `H3HexLayer.ts` / `MapView.tsx`: on each state change call `map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none")` for tile, polygon, portal, and item layers driven by `ui.layerVisibility`

**Checkpoint**: Story 1 complete — working H3 viewer with map metadata panel, element selection, and layer visibility toggles.

---

## Phase 4: User Story 2 — Paint Tiles and Export (Priority: P1)

**Goal**: Click H3 cells to mark them as explicit tile instances, then export a valid `.map.gram` file.

**Independent Test**: Paint 5 cells, click Export, open the downloaded file — confirm `{ kind: "matrix-map" }` header, one `Floor` TileType definition, and one `(cell-...:Floor { location: h3\`...\` })` line per painted cell.

- [ ] T017 [US2] Add `PAINT_CELL`, `ERASE_CELL`, and `SET_ACTIVE_TYPE` actions to `editor-reducer.ts`; `PAINT_CELL` adds/updates an explicit `TileInstance`; `ERASE_CELL` removes it (no-op if cell is only a virtual tile)
- [ ] T018 [US2] Implement cell click handler in `MapView.tsx`: determine which H3 cell was clicked via `h3.latLngToCell`; dispatch `PAINT_CELL` (paint mode) or `ERASE_CELL` (erase mode); toggle erase if clicking an already-painted cell in paint mode
- [ ] T019 [US2] Add a MapLibre layer in `H3HexLayer.ts` for explicit tile instances: render painted cells with a distinct fill colour driven by their TileType style; update on each state change
- [ ] T020 [US2] Seed the initial editor state in `editor-reducer.ts` with one built-in `TileType` (`id: "floor"`, `typeName: "Floor"`, `name: "Floor"`); guard `DELETE_TILE_TYPE` to reject deletion of the built-in type
- [ ] T021 [US2] Implement `tools/map-editor/src/io/export-gram.ts`: walk `MapEditorState` and build a `Pattern[]` (MapMeta header node, TileType nodes, TileInstance nodes, PolygonShape nodes, Portal edges, ItemInstance nodes); call `Gram.stringify(patterns)` and return the string
- [ ] T022 [US2] Add Export button to `MapEditor.tsx`: call `export-gram.ts`, create a `Blob`, trigger browser file download as `<map-name>.map.gram`
- [ ] T062 [US2] Complete `PropertyEditor.tsx` for TileInstance: when `selectedElement.type === "tile"`, display h3Index (read-only) and a type dropdown populated from `tileTypes`; change dispatches `UPDATE_TILE_INSTANCE_TYPE`

**Checkpoint**: Story 2 complete — minimal authoring loop working end-to-end.

---

## Phase 5: User Story 3 — Draw a Polygon Region and Export (Priority: P1)

**Goal**: Place vertices in polygon-draw mode, confirm, see virtual tiles fill the interior, and export a `.map.gram` containing the polygon block.

**Independent Test**: Draw a 4-vertex polygon over a city block, confirm, export — file contains one `[polygon-...:Polygon:Floor | h3\`...\`, ...]` block; individual interior cells are NOT listed separately.

- [ ] T023 [US3] Add polygon draw actions to `editor-reducer.ts`: `ADD_POLYGON_VERTEX`, `CONFIRM_POLYGON` (guards: `inProgress.length >= 3`; commits `PolygonShape` to `polygonLayer.committed`, clears `inProgress`), `CANCEL_POLYGON`, `DELETE_POLYGON` (removes shape + all its virtual tiles from display)
- [ ] T024 [US3] Implement polygon vertex placement in `MapView.tsx`: in polygon-draw mode, click → `ADD_POLYGON_VERTEX(h3.latLngToCell(lngLat, 15))` snapping to the cell centroid
- [ ] T025 [US3] Render in-progress polygon in `H3HexLayer.ts`: vertex dots at clicked cells + connecting lines forming the open polygon preview
- [ ] T026 [US3] Render committed polygon virtual tiles in `H3HexLayer.ts`: for each `PolygonShape` in `polygonLayer.committed`, call `h3.polygonToCells(vertices, 15)` and render the resulting cells as a fill layer; detect pentagon cells and surface a console warning + UI badge
- [ ] T027 [US3] Enforce the 3-vertex minimum in `editor-reducer.ts` on `CONFIRM_POLYGON`: ignore or dispatch a `UI_ERROR` action that surfaces a message in the editor toolbar
- [ ] T028 [US3] Update `export-gram.ts` to emit `[polygon-<id>:Polygon:<typeName> | h3\`v1\`, ...]` blocks for committed polygons; virtual cells within the polygon are NOT individually listed
- [ ] T063 [US3] Complete `PropertyEditor.tsx` for PolygonShape: when `selectedElement.type === "polygon"`, display type dropdown + vertex count (read-only) + **Delete** button that dispatches `DELETE_POLYGON(id)`; clicking a polygon's virtual tile region in `MapView.tsx` dispatches `SELECT_ELEMENT({ type: "polygon", id })`

**Checkpoint**: Story 3 complete — polygon draw, fill, delete, and compact gram export confirmed.

---

## Phase 6: User Story 4 — Combine Polygons and Hand-Painted Tiles (Priority: P2)

**Goal**: Draw a polygon for a large region, paint additional explicit cells outside it, override virtual tiles inside it with a different type, and export the combined map.

**Independent Test**: Draw a polygon, paint 3 cells outside it, paint 1 cell inside the polygon with a different type — export should contain the polygon block, 3 standalone tile nodes (outside), and 1 override tile node (inside).

- [ ] T029 [US4] Implement composite rendering in `H3HexLayer.ts`: explicit `TileInstance` layer renders on top of virtual tile layer; explicit type's style overrides the polygon fill colour at shared cells
- [ ] T030 [US4] Implement virtual-tile override in `editor-reducer.ts`: `PAINT_CELL` on a cell that is a virtual tile creates an explicit `TileInstance` with `isOverride: true` at that cell
- [ ] T031 [US4] Implement erase no-op on virtual tiles in `editor-reducer.ts` + `MapView.tsx`: `ERASE_CELL` on a cell that is only a virtual tile dispatches a `UI_HINT` action surfaced as a brief tooltip ("Use paint to override polygon tiles")
- [ ] T032 [US4] Update `export-gram.ts`: explicit override `TileInstance` nodes are emitted as Point instances after their parent polygon block; non-override explicit tiles are emitted in the general tile instances section

**Checkpoint**: Story 4 complete — polygon + explicit tile composition verified.

---

## Phase 7: User Story 5 — Named Tile Types and Palette (Priority: P2)

**Goal**: Create named tile types with CSS styles in the palette, paint cells with each type, and verify types appear correctly in the export.

**Independent Test**: Create "Carpet" (blue) and "Concrete" (grey) types, paint 3 cells of each, export — file contains both TileType definitions and each cell references its correct type.

- [ ] T033 [US5] Implement `tools/map-editor/src/panels/TileTypePalette.tsx`: list of TileType entries with create/edit/delete; inline edit for name, description, capacity, style; built-in Floor entry rendered as read-only (no delete button)
- [ ] T034 [US5] Add `CREATE_TILE_TYPE`, `UPDATE_TILE_TYPE`, `DELETE_TILE_TYPE` actions to `editor-reducer.ts`; `DELETE_TILE_TYPE` guard rejects the built-in Floor id
- [ ] T035 [US5] Wire palette selection: clicking a TileType in the palette dispatches `SET_ACTIVE_TYPE`; selected type is highlighted and shown in the toolbar
- [ ] T036 [US5] Update `H3HexLayer.ts` explicit tile layer: apply each cell's TileType `style` CSS value as the MapLibre fill paint colour (parse `background: <colour>` convention)
- [ ] T037 [US5] Update `export-gram.ts` to include TileType definitions before tile instances; verify in Vitest unit test: `exportGram(stateWithTwoTypes)` output contains two `(id:TileType:TypeName {...})` blocks in `tools/map-editor/src/io/export-gram.test.ts`

**Checkpoint**: Story 5 complete — semantically typed maps authoring works end-to-end.

---

## Phase 8: User Story 6 — Import `.map.gram` for Continued Editing (Priority: P2)

**Goal**: Load a previously exported `.map.gram` file, restore all editor state, continue editing, and re-export.

**Independent Test**: Export a map with 2 tile types, 1 polygon, and 3 explicit tiles; reload it; add 1 cell; re-export — new file contains all original content plus the new cell.

- [ ] T038 [US6] Implement `tools/map-editor/src/io/import-gram.ts`: call `Gram.parse(text)` then walk the Pattern AST to reconstruct `MapEditorState`; collect unrecognised property names into a warnings array; handle IC-002 `color:` → `style:` normalisation
- [ ] T039 [US6] Add `IMPORT_MAP` action to `editor-reducer.ts`: replaces the full editor state; used after successful parse
- [ ] T040 [US6] Add Import button to `MapEditor.tsx` with `<input type="file" accept=".gram">` picker; read file as text; dispatch `IMPORT_MAP` on success; show warning toast if `importGram` returns warnings
- [ ] T041 [US6] Write Vitest round-trip test in `tools/map-editor/src/io/import-gram.test.ts`: export a known state → import the result → assert state equality (tile types, tile instances, polygon shapes, portals, items)
- [ ] T042 [US6] Verify IC-002: write Vitest test with a `tmj-to-gram`-style input (all Point instances, `color:` on types, no polygon blocks); assert clean import with normalisation

**Checkpoint**: Story 6 complete — full authoring round-trip verified.

---

## Phase 9: User Story 7 — Item Types and Placement (Priority: P3)

**Goal**: Define item types with glyphs, place item instances on tile cells, and verify they round-trip through export/import.

**Independent Test**: Define "Key" (🔑, takeable), place it on one tile, export — file contains `ItemType` definition and instance node with correct H3 location.

- [ ] T043 [US7] Implement `tools/map-editor/src/panels/ItemTypePalette.tsx`: create/edit/delete item type definitions (name, glyph, takeable, capacityCost, style)
- [ ] T044 [US7] Add `CREATE_ITEM_TYPE`, `UPDATE_ITEM_TYPE`, `DELETE_ITEM_TYPE`, `PLACE_ITEM`, `REMOVE_ITEM` actions to `editor-reducer.ts`; `PLACE_ITEM` guard: target cell must be an explicit TileInstance or covered by a committed PolygonShape
- [ ] T045 [US7] Render item instances as glyph HTML overlays (MapLibre `Marker` or symbol layer) on their H3 cells in `MapView.tsx`
- [ ] T046 [US7] Add `CREATE_ITEM_LAYER` and `SET_ACTIVE_ITEM_LAYER` actions; `LayerPanel.tsx` shows named item layers each with visibility + lock toggles
- [ ] T047 [US7] Update `export-gram.ts` to emit ItemType definitions and `(<id>:<TypeName> { location: h3\`...\` })` instance nodes; update `import-gram.ts` to restore item types, item layers, and instances

**Checkpoint**: Story 7 complete — items layer functional.

---

## Phase 10: User Story 8 — Portal Authoring (Priority: P3)

**Goal**: Select two tile cells and create a typed directed Portal edge between them; portals visible as directed edges; round-trip through export/import.

**Independent Test**: Create one "Elevator" portal between two cells, export — file contains `(cell-A)-[:Portal { mode: "Elevator" }]->(cell-B)`.

- [ ] T048 [US8] Add `SELECT_PORTAL_FROM`, `CREATE_PORTAL`, `DELETE_PORTAL`, `UPDATE_PORTAL_MODE` actions to `editor-reducer.ts`; `SELECT_PORTAL_FROM` guard: cell must be in tile layer (explicit or virtual); `CREATE_PORTAL` guard: both cells in tile layer, no duplicate edge
- [ ] T049 [US8] Implement portal tool click handler in `MapView.tsx`: first click → `SELECT_PORTAL_FROM` (highlight pending cell); second click → `CREATE_PORTAL`; Escape → cancel pending selection
- [ ] T050 [US8] Render portal directed edges in `MapView.tsx` as a MapLibre line layer: line from source cell centroid to target cell centroid with an arrowhead symbol and mode label
- [ ] T051 [US8] Wire portal properties to `PropertyEditor.tsx`: selecting a portal edge shows a mode text input; change dispatches `UPDATE_PORTAL_MODE`
- [ ] T052 [US8] Update `export-gram.ts` to emit `(<fromRef>)-[:Portal { mode: "..." }]->(<toRef>)` relationship blocks; update `import-gram.ts` to restore portals

**Checkpoint**: Story 8 complete — all eight user stories functional.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T053 [P] Fix any remaining stale `clients/map-editor` path references across spec artifacts (data-model.md already fixed; verify plan.md, research.md, quickstart.md)
- [ ] T054 [P] Update `docs/architecture.md`: add `tools/map-editor` as the native map authoring tool; note `tools/tmj-to-gram` as the legacy migration path
- [ ] T055 [P] Update `proposals/rfc/0010-h3geojson-map-editor.md` status field from `draft` to `accepted`
- [ ] T056 Create `docs/guides/map-editor.md`: launch instructions, story-1 through story-3 walkthrough, export workflow, and how to place output in `maps/`
- [ ] T057 Run all three `quickstart.md` smoke tests (view, paint+export, polygon+export); document pass/fail results in quickstart.md
- [ ] T058 [P] Performance check: load `maps/sandbox/freeplay.map.gram` (existing map), add cells to reach ~5,000 total; verify polygon fill and tile paint remain responsive (SC-004)
- [ ] T064 Add "Load in game engine" verification step to `specs/012-h3geojson-map-editor/quickstart.md`: copy an exported `.map.gram` to `maps/sandbox/`, run `pnpm dev` at repo root, confirm the map loads without errors and tiles render in the game client (verifies SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks all user story phases**
- **US1–US3 (Phases 3–5)**: All three depend only on Foundational; can proceed in parallel
- **US4 (Phase 6)**: Depends on US2 (tile painting) + US3 (polygon rendering)
- **US5 (Phase 7)**: Depends on US2 (tile painting)
- **US6 (Phase 8)**: Depends on US2 (export) + any stories whose output should round-trip
- **US7 (Phase 9)**: Depends on US2 (tile layer exists for placement guard)
- **US8 (Phase 10)**: Depends on US2 (tile layer exists for portal guard)
- **Polish (Phase 11)**: Depends on all desired stories complete

### User Story Dependencies Summary

| Story | Depends on | Can start after |
|---|---|---|
| US1 | Foundational | Phase 2 |
| US2 | Foundational | Phase 2 |
| US3 | Foundational | Phase 2 |
| US4 | US2 + US3 | Phases 4 + 5 |
| US5 | US2 | Phase 4 |
| US6 | US2 | Phase 4 |
| US7 | US2 | Phase 4 |
| US8 | US2 | Phase 4 |

### Parallel Opportunities Per Story

```
# After Phase 2 completes, these can start simultaneously:
US1: T013–T016 (viewer)
US2: T017–T022 (tile paint + export)
US3: T023–T028 (polygon draw)

# Within US2, these can run in parallel:
T017 (reducer actions)   ← then T018, T019
T020 (Floor type seed)   ← independent of T017–T019
T021 (export-gram.ts)    ← then T022

# Within US3, these can run in parallel:
T023 (reducer actions)
T025 (in-progress render)
T026 (virtual tile render)
```

---

## Implementation Strategy

### MVP (User Stories 1–3 only)

1. Phase 1: Setup (T001–T005)
2. Phase 2: Foundational (T006–T012)
3. Phase 3: US1 — View (T013–T016)
4. **STOP + VALIDATE**: hex grid renders over Moscone
5. Phase 4: US2 — Paint + Export (T017–T022)
6. **STOP + VALIDATE**: `.map.gram` downloads correctly
7. Phase 5: US3 — Polygon (T023–T028)
8. **STOP + VALIDATE**: polygon block in export, no individual cells listed

### Incremental Delivery (full feature)

After MVP, add in order: US4 → US5 → US6 → US7 → US8 → Polish.  
Each story is independently testable at its checkpoint before proceeding.

---

## Notes

- `[P]` = different files, no dependency on in-progress tasks — safe to parallelize
- Virtual tiles (polygon-derived) are **never** stored as `TileInstance` records — derived on render only
- `ERASE_CELL` on a virtual tile is a no-op; show a UI hint instead
- Built-in Floor `TileType` cannot be deleted; guard is in `editor-reducer.ts`
- `Gram.stringify()` from `@relateby/pattern` handles serialisation — verify tagged-literal output (`h3\`...\``) in T037 unit test
- DCO sign-off required on all commits: `git commit -s`
