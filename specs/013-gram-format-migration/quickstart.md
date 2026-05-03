# Quickstart: .map.gram Format Migration

**Branch**: `013-gram-format-migration`

## Prerequisites

- Node.js 24
- pnpm 10
- Working directory: repo root

```bash
pnpm install
```

---

## 1. Run the shared parser unit tests

```bash
pnpm --filter @aie-matrix/map-gram test
```

Expected: all assertions pass against `canonical.map.gram`, `rectangle.map.gram`, and the item-bearing fixture.

---

## 2. Verify Colyseus loads a gram-only map

Start Colyseus in isolation (no Tiled files needed):

```bash
pnpm --filter @aie-matrix/colyseus test
```

Or start the full dev server and check that the `canonical-example` room initialises:

```bash
pnpm dev
# In a separate terminal:
curl http://localhost:2567/rooms
# Expect a room entry for the canonical-example map
```

---

## 3. Verify intermedium renders the new format

```bash
pnpm --filter @aie-matrix/intermedium-client test
```

Or start the client dev server:

```bash
cd clients/intermedium && pnpm dev
# Open http://localhost:5173 — the map should render with filled polygon regions
```

---

## 4. Regenerate old-format map files

After updating `tmj-to-gram`, regenerate the old maps from their `.tmj` sources:

```bash
pnpm --filter @aie-matrix/tmj-to-gram convert maps/sandbox/freeplay.tmj -o maps/sandbox/freeplay.map.gram
pnpm --filter @aie-matrix/tmj-to-gram convert maps/sandbox/map-with-polygons.tmj -o maps/sandbox/map-with-polygons.map.gram
```

Verify output:

```bash
pnpm gram-lint maps/sandbox/freeplay.map.gram
pnpm gram-lint maps/sandbox/map-with-polygons.map.gram
```

---

## 5. Run all tests

```bash
pnpm test
pnpm typecheck
pnpm run lint
```

All must pass before opening a pull request.

---

## Smoke test: end-to-end map round-trip

1. Open the map editor: `cd tools/map-editor && pnpm dev`
2. Create a small map with one polygon layer and one item
3. Export to `maps/sandbox/smoke-test.map.gram`
4. Run `pnpm gram-lint maps/sandbox/smoke-test.map.gram`
5. Start Colyseus (`pnpm dev`) and confirm the room appears in `curl http://localhost:2567/rooms`
6. Open the intermedium client and confirm the map renders

---

## Key files changed by this feature

| File | Change |
|---|---|
| `shared/map-gram/` | **New package** — canonical gram parser |
| `server/colyseus/src/mapLoader.gram.ts` | **New** — gram adapter |
| `server/colyseus/src/mapLoader.ts` | **Modified** — delegates to gram adapter |
| `clients/intermedium/src/services/gramParser.ts` | **Modified** — delegates to shared package |
| `tools/tmj-to-gram/src/serialize-gram.ts` | **Modified** — layered format output |
| `server/world-api/src/map/MapService.ts` | **Modified** — validation requires LayerStack |
| `maps/sandbox/*.map.gram` | **Regenerated** — old-format files replaced |
