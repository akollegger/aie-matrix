# Quickstart: Map Format Pipeline (010-tmj-to-gram)

**Branch**: `010-tmj-to-gram` | **Date**: 2026-04-25

## Prerequisites

- Node.js 24+, pnpm 10+
- Workspace installed: `pnpm install` from repo root
- `maps/sandbox/freeplay.tmj` with `h3_anchor` and `h3_resolution: 15` properties (already in repo)

---

## 1. Convert a map (CLI — User Story 1)

Run from the repo root:

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj
```

Expected output:
- `maps/sandbox/freeplay.map.gram` is written next to the source.
- CLI exits 0 with a log line like `[info] Wrote maps/sandbox/freeplay.map.gram (N nodes)`.

To write to a custom path:

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj --out /tmp/test.map.gram
```

---

## 2. Verify the gram artifact (Layer 1 structural invariants)

```bash
pnpm --filter @aie-matrix/tmj-to-gram test
```

Tests assert:
- Every `location` is a valid H3 cell at resolution 15.
- Every tile node references a defined `TileType`.
- Polygon vertex cells are valid H3 indices.
- No polygon interiors overlap.
- Compression rule: interior cells matching the area type have no individual nodes.
- Item definitions match sidecar entries; item placements reference known types.

---

## 3. Byte-equality CI check

```bash
# From repo root — regenerate, then diff
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj --out /tmp/freeplay-ci.map.gram
diff maps/sandbox/freeplay.map.gram /tmp/freeplay-ci.map.gram
# Exit 0 = no drift
```

If the diff is non-empty, regenerate and commit the new golden:

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj
git add maps/sandbox/freeplay.map.gram
git commit -s -m "chore: regenerate freeplay.map.gram after conversion change"
```

---

## 4. Start the world-api and fetch maps (User Stories 2 & 3)

```bash
pnpm dev
```

Once the server is running:

```bash
# Gram format (default — for RFC-0008 intermedium)
curl http://localhost:<port>/maps/freeplay

# Gram format (explicit)
curl http://localhost:<port>/maps/freeplay?format=gram

# TMJ format (for Phaser debugger)
curl http://localhost:<port>/maps/freeplay?format=tmj

# 404 case
curl -i http://localhost:<port>/maps/does-not-exist

# 400 case
curl -i http://localhost:<port>/maps/freeplay?format=xml
```

Expected responses:
- `GET /maps/freeplay` → 200, `Content-Type: text/plain; charset=utf-8`, gram body
- `GET /maps/freeplay?format=tmj` → 200, `Content-Type: application/json`, TMJ body
- `GET /maps/does-not-exist` → 404, JSON error body
- `GET /maps/freeplay?format=xml` → 400, JSON error body

---

## 5. Test startup validation (User Story 6)

Place a malformed gram in the maps directory and start the server:

```bash
echo "not valid gram !!!" > /tmp/bad.map.gram
# The server startup check is driven by MapService.validate()
# To test: copy bad.map.gram into maps/sandbox/ with a valid name
cp /tmp/bad.map.gram maps/sandbox/freeplay.map.gram
pnpm dev
# Expected: server exits non-zero before binding port, with GramParseError in logs
# Restore:
git checkout maps/sandbox/freeplay.map.gram
```

---

## 6. Run the Layer 3 visual parity test

```bash
pnpm --filter @aie-matrix/tmj-to-gram test:visual
```

This builds the same logical terrain from TMJ and from the committed gram, rasterizes both views to PNG (`pngjs`), and asserts `pixelmatch` is zero. Any non-zero diff fails the test.

To regenerate the golden PNGs after an intentional visual change:

```bash
pnpm --filter @aie-matrix/tmj-to-gram golden:regen
git add tools/tmj-to-gram/test/render/golden/
git commit -s -m "test: regenerate visual golden for freeplay"
```

---

## Package locations

| Package | Path | Purpose |
|---|---|---|
| `@aie-matrix/tmj-to-gram` | `tools/tmj-to-gram/` | Build-time CLI converter |
| `@aie-matrix/server-world-api` (map/) | `server/world-api/src/map/` | MapService + MapRoutes |

---

## Adding a new sandbox fixture

1. Author the map in Tiled and save as `maps/sandbox/<name>.tmj`.
2. Set `h3_anchor`, `h3_resolution: 15` (and optionally `map_name`, `elevation`) in Map Properties.
3. Run `pnpm tmj-to-gram convert maps/sandbox/<name>.tmj` to produce `<name>.map.gram`.
4. Add any new tile type labels to the fallback table in `tools/tmj-to-gram/test/render/fallbacks.ts`.
5. Run `pnpm --filter @aie-matrix/tmj-to-gram golden:regen` to generate a visual golden.
6. Commit `.tmj`, `.map.gram`, and the new golden PNG together.
