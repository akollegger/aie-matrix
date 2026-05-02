# Quickstart: H3GeoJSON Map Editor

**Feature**: `012-h3geojson-map-editor`  
**Package**: `tools/map-editor`

## Prerequisites

- Node.js 24
- pnpm 10 (`npm i -g pnpm`)

## Run the editor

```bash
cd tools/map-editor
pnpm install
pnpm dev
```

Open `http://localhost:5181` in Chrome or Firefox.

## Smoke test: view (Story 1)

1. The editor opens showing a MapLibre GL map with H3 resolution-15 hex cells overlaid.
2. Navigate to San Francisco (Moscone Center area: 37.784°N, 122.400°W).
3. Zoom to street level — hex cells should be visible and correctly aligned.
4. Pan and zoom; cells remain sharp and gap-free at all levels.

## Smoke test: paint tiles and export (Story 2)

1. The **✏ paint** tool is active by default. Click several hex cells — they highlight.
2. Click a painted cell again — it selects it; the property panel shows its type. Use the **⌫ erase** tool to remove painted cells.
3. Click **Export** — a `untitled-map.map.gram` file downloads.
4. Open it in a text editor and confirm:
   - First line: `{ kind: "matrix-map", name: "untitled-map", elevation: 0 }`
   - A `(floor:TileType:Floor { ... })` type definition
   - One `(:Tile:Floor { geometry: [h3`...`] })` element per painted cell inside a `[...:Layer {kind: "tile"} | ...]` walk
   - A `[rules:Rules | (floor)-[:GO]->(floor)]` walk

## Smoke test: draw a polygon and export (Story 3)

1. In the sidebar, click **Add layer → Polygon** to create a polygon layer (or use the layer panel).
2. Select the **⬡ polygon** tool. Choose a shape (Triangle / Rect / Hexagon) from the shape panel.
3. Click on the map — a polygon fills in immediately with its interior H3 cells highlighted.
4. Click **Export** and confirm the `.map.gram` contains a polygon walk like:
   ```
   [ground:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3`...`, h3`...`, h3`...`, h3`...`] })]
   ```
   Note: `geometry` holds only the N defining vertex cells (4 for a rectangle). The full fill is derived by the consumer — it is not enumerated in the file.

## Smoke test: polygon vertex editing

1. Switch to the **✋ hand** tool and click a polygon to select it.
2. Double-click the selected polygon — cyan vertex handles appear at each corner.
3. Drag a vertex to a new position — the polygon deforms in real time.
4. Press **Escape** to exit vertex-edit mode. Export and confirm `geometry` reflects the new vertex positions.

## Smoke test: movement rules

1. Click the **📄** icon in the toolbar (left of the map name) to open map properties.
2. The **Movement Rules** section lists `Floor → Floor` by default.
3. Open the tile type palette, create a new type (e.g. "Carpet"). The rules list gains `Carpet → Carpet` automatically.

## Smoke test: import round-trip (Story 6)

1. Export any map.
2. Click **Import** and reload the same `.map.gram` file.
3. The editor state should be visually identical to the pre-export state.
4. Add one new painted cell, re-export, and confirm it appears alongside the original content.

## Smoke test: portals (Story 8)

1. Ensure a tile layer is active (paint a few cells if needed).
2. Select the **↔ portal** tool. Click one cell — it turns orange (pending).
3. Click a second cell — a directed edge appears between them labeled "Door".
4. Export and confirm:
   ```
   (:Portal { geometry: [h3`...`, h3`...`], mode: "Door" })
   ```
   inside the tile layer walk.

## Import the canonical example

```bash
# From the editor: click Import and navigate to:
maps/sandbox/canonical.map.gram
```

This file demonstrates every construct: polygon layer, tile overrides, portal, items layer, and movement rules. Use it as a reference when consuming `.map.gram` files from the editor.

## Run unit tests

```bash
cd tools/map-editor
pnpm test        # export-gram, import-gram, gram-api round-trips
pnpm typecheck   # TypeScript
```

## Build for production

```bash
pnpm build       # outputs to tools/map-editor/dist/
pnpm preview     # serve the built app locally
```
