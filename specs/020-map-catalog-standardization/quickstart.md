# Quickstart: Map Catalog Standardization & Moscone West Map

**Branch**: `020-map-catalog-standardization`

## Prerequisites

- Node.js 24 + pnpm 10 installed
- Repository checked out on branch `020-map-catalog-standardization`

## Verify Current State (before changes)

```bash
# Confirm all .tmj files have gram counterparts
ls maps/sandbox/*.tmj
ls maps/sandbox/*.map.gram

# Confirm TMJ routes exist (will be removed)
grep "format=tmj" server/world-api/src/map/MapRoutes.ts
```

## Implementing TMJ Removal

### 1. Update `server/world-api/src/map/MapService.ts`

- Remove `tmjPath?: string` from `MapIndexEntry`
- Remove `.tmj` glob in `scanMapPairs()` (lines ~160–196)
- Remove `format: "gram" | "tmj"` parameter from `raw()` — method always returns gram bytes
- Remove `stemFromTmjFilename()` helper

### 2. Update `server/world-api/src/map/MapRoutes.ts`

- Remove `tmj` field from `mapHyperlinks()` return type (line ~57–63)
- Remove `normalizeFormat()` function and its `"tmj"` branch
- Remove `parseMapFormatParam()` or simplify to always return `"gram"`
- Update `handleMapAssetGet()` to call `raw(mapId)` (no format arg)
- Add `400` handler for `?format=tmj` requests

### 3. Update `server/world-api/src/map/map-errors.ts`

- Review `UnsupportedFormatError` — remove if its only trigger was the TMJ format branch

### 4. Update tests in `server/world-api/test/`

- `map-routes.test.ts`: Remove `assertTmjJsonShape`, remove TMJ format test cases, add test asserting `?format=tmj` returns `400`
- `MapService.test.ts`: Remove `tmjPath` assertions from index entry tests
- `MapService-startup.test.ts`: Review and remove any TMJ startup expectations

### 5. Update `server/colyseus/src/mapLoader.ts`

- Delete `loadTmjMap()` function (lines 234–411)
- Delete TMJ-specific interfaces: `TmjMap`, `TmjLayer`, `TmjProperty`, `TmjTilesetRef` (lines ~10–78)
- Delete TMJ helper functions: `isDataTileLayer`, `collectLayoutLayer`, etc. (lines ~39–208)
- Remove the `@internal` comment from whatever was next to `loadTmjMap` declaration

### 6. Update `server/colyseus/src/mapLoader.test.ts`

- Replace any `import { loadTmjMap as loadHexMap }` with direct `loadHexMap` import
- Replace `.tmj` test fixtures with `.map.gram` equivalents from `maps/sandbox/`

### 7. Delete map source files

```bash
rm maps/sandbox/freeplay.tmj
rm maps/sandbox/map-with-polygons.tmj
rm maps/sandbox/read-and-collect.tmj
rm maps/sandbox/redbluegreen.tmj
rm maps/sandbox/common.items.json
rm maps/sandbox/freeplay.items.json
rm maps/sandbox/read-and-collect.items.json
rm maps/moscone/moscone-west.tmx
```

### 8. Tombstone `tools/tmj-to-gram`

Add to `tools/tmj-to-gram/package.json`:
```json
"deprecated": "true"
```

Add a deprecation notice to the top of `tools/tmj-to-gram/README.md`.

## Authoring the Moscone West Map

Rename the existing file and rewrite with venue structure:

```bash
mv maps/moscone/moscone-west-ground-floor.map.gram maps/moscone/moscone-west.map.gram
```

Then edit `maps/moscone/moscone-west.map.gram` to add the full set of TileType definitions, polygon layers, and rules as described in `data-model.md`.

H3 cell vertices for interior zones can be found using:
```javascript
import { latLngToCell } from "h3-js"
// Moscone West north lobby entrance: approx 37.7845, -122.3996
latLngToCell(37.7845, -122.3996, 15)
```

## Verify After Changes

```bash
# TypeScript compilation
pnpm typecheck

# Unit tests
pnpm --filter @aie-matrix/world-api test
pnpm --filter @aie-matrix/colyseus test

# Start server and smoke-test
pnpm dev &
curl http://localhost:2567/maps | jq '.[].mapId'
# Should list all maps including moscone-west, with no tmj fields

curl http://localhost:2567/maps/moscone-west
# Should return { mapId: "moscone-west", name: "Moscone West", ... }

curl "http://localhost:2567/maps/freeplay?format=tmj"
# Should return 400

# Parse Moscone West map and count cells
node -e "
import('@aie-matrix/map-gram').then(({parseMapGram}) =>
  import('fs').then(({readFileSync}) => {
    const gram = readFileSync('maps/moscone/moscone-west.map.gram', 'utf8')
    parseMapGram(gram).then(m => console.log('cells:', m.cells.size))
  })
)"
# Should print 200+ cells
```

## Create ADR

```bash
# Create proposals/adr/0009-tmj-deprecation.md
# See spec for required content — formal record of dropping ?format=tmj
```
