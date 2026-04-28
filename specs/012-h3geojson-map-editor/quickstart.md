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

Open `http://localhost:5173` in Chrome or Firefox.

## Smoke test (Story 1 — view only)

1. The editor opens showing a MapLibre GL map.
2. Navigate to San Francisco (Moscone Center area: 37.784°N, 122.400°W).
3. Zoom to street level — H3 resolution-15 hex cells should overlay the map.
4. Pan and zoom; cells should remain aligned and gap-free.

## Smoke test (Story 2 — paint + export)

1. Click several hex cells — they highlight as tile instances.
2. Click an already-painted cell — it deselects (toggle erase).
3. Click **Export** — a `.map.gram` file downloads.
4. Open the file in a text editor; confirm it has a `{ kind: "matrix-map" ... }` header and one `(cell-...:DefaultFloor { location: h3\`...\` })` line per painted cell.

## Smoke test (Story 3 — polygon + export)

1. Select the polygon draw tool.
2. Click 4 vertices in a rough square over a block of the map.
3. Click **Confirm polygon** — interior cells fill in.
4. Export; confirm the `.map.gram` contains a `[polygon-...:Polygon:DefaultFloor | ...]` block.

## Run unit tests

```bash
cd clients/map-editor
pnpm test
```

Tests cover `io/export-gram.ts` (serialisation) and `io/import-gram.ts` (round-trip) using Vitest.

## Load exported map in the game engine

Place the exported `.map.gram` file in `maps/moscone/` (or `maps/sandbox/` for testing) and restart the server. The game engine reads maps at startup from the `maps/` directory.

## Build for production

```bash
pnpm build        # outputs to clients/map-editor/dist/
pnpm preview      # serve the built app locally
```
