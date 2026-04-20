# Quickstart: H3 Coordinate System

**Feature**: 005-h3-coordinate-system  
**Date**: 2026-04-18

This guide covers how to anchor a map, run the server, verify H3 indices are assigned, and open the overlay client.

---

## Prerequisites

- Node.js 24, pnpm 10
- Running Neo4j instance (see `docs/architecture.md`)
- `h3-js` installed (added as part of this feature — `pnpm install` covers it)

---

## Step 1: Anchor a Map

Open `maps/sandbox/freeplay.tmj` in Tiled.

In **Map → Map Properties → Custom Properties**, add:

| Property | Type | Value |
|---|---|---|
| `h3_anchor` | string | `8f28308280f2d25` *(example — use a real venue lat/lng)* |

To generate an anchor from a lat/lng:
```bash
node -e "const {latLngToCell} = require('h3-js'); console.log(latLngToCell(37.7749, -122.4194, 15));"
```

Save the `.tmj` file.

---

## Step 2: Start the Server

```bash
pnpm dev
```

The server loads `freeplay.tmj` on startup. Look for log output:
```
[mapLoader] Loaded freeplay.tmj: 117 navigable cells, anchor 8f28308280f2d25
[mapLoader] Pentagon cells in map: 0
```

If the anchor is missing or invalid, the server fails with:
```
MapLoadError: freeplay.tmj missing required h3_anchor property
```

---

## Step 3: Verify H3 Indices via Ghost Tools

Start a ghost CLI session:
```bash
pnpm --filter @aie-matrix/ghost-cli start
```

Run `whereami` — the response now includes `h3Index`:
```
You are ghost <uuid>.
Location: 8f28308280f2d25 (col=0, row=0, class=Blue)
```

Run `exits` — neighbor values are H3 index strings:
```
Available exits from 8f28308280f2d25:
  ne → 8f28308280f2d29 (Green)
  se → 8f28308280f2d21 (Blue)
```

Navigate with `go`:
```
go { toward: "ne" }
→ Moved to 8f28308280f2d29 (Green)
```

---

## Step 4: Run Contract Tests

```bash
pnpm test:tck
```

All TCK scenarios must pass. Pay attention to:
- `exits` response format (H3 index strings in neighbor values)
- `go` tool accepting and returning valid H3 positions
- `traverse` tool (new — requires a map with a non-adjacent exit defined)

---

## Step 5: Open the Spectator Overlay (once `client/map-overlay` is built)

```bash
pnpm --filter @aie-matrix/client-map-overlay dev
```

Open `http://localhost:5175` in a browser (MapLibre overlay dev server; Phaser spectator uses `5174`). Ghost positions appear as markers on the map. As ghosts move, markers update in real time.

To verify correct lat/lng placement, cross-reference a ghost's `whereami` H3 index with:
```javascript
const { cellToLatLng } = require("h3-js");
cellToLatLng("8f28308280f2d29"); // → [37.7749..., -122.4194...]
```

---

## Troubleshooting

| Symptom | Likely Cause |
|---|---|
| `MapLoadError: missing h3_anchor` | Map file was not updated with anchor property |
| `MapLoadError: invalid H3 index` | Anchor string is not a valid H3 res-15 index |
| `exits` shows no neighbors | Map has no navigable neighbors at the anchor cell — check tileClass assignments |
| Overlay markers in wrong location | Anchor lat/lng was set for the wrong corner of the map |
| `localIjToCell` error at far map corner | Map is larger than H3's local IJ frame supports at res-15; reduce map size or report as bug |
