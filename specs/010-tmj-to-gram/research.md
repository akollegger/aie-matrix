# Research: Map Format Pipeline (010-tmj-to-gram)

**Branch**: `010-tmj-to-gram` | **Date**: 2026-04-25

## Open Questions Resolved

### OQ-1: Committed artifact vs. derived-on-build

**Decision**: Commit `.map.gram` artifacts; add CI byte-equality check.

**Rationale**: The repo includes a committed illustrative gram (`maps/sandbox/canonical.map.gram`, unpaired with TMJ so it is not indexed by `MapService`). Committing makes PR diffs reviewable (the world author's Tiled change and its gram output appear together). The CI equality check (`tmj-to-gram` re-run + `diff`) catches any drift and forces silent output changes to surface as a PR diff. This is the same pattern used by golden-file tests throughout the industry.

**Alternatives considered**: Generate-on-build (CI artifact, not committed) — rejected because diffs aren't reviewable and the gram cannot be inspected without running a CI job.

---

### OQ-2: Content-type for gram responses

**Decision**: `text/plain; charset=utf-8`

**Rationale**: No IANA type exists for gram. `text/plain` is correct, safe, and readable in a browser/curl without configuration. `application/vnd.aie-matrix.gram` adds discoverability but is a premature one-way commitment. Revisit when the intermedium (RFC-0008) or a browser-side parser has a concrete need for MIME-type detection.

---

### OQ-4: mapId namespacing and collision handling

**Decision**: `mapId` collision at startup is a typed error (`MapIdCollisionError`); no `<scene>/` prefix for now.

**Rationale**: There are currently only sandbox maps; the namespace problem is hypothetical. Startup-error on collision is loud and immediate — no silent shadowing. Deferred namespacing (`<scene>/<name>`) is a follow-up RFC when multi-scene production maps land.

---

### OQ-5: Where the gram parser lives

**Decision**: `MapService.validate()` consumes `@relateby/pattern` directly, independent from `server/world-api/src/rules/gram-rules.ts`. No shared `gram/` module yet.

**Rationale**: Only two consumers exist. Abstracting now would add indirection with no benefit. A third consumer is the natural trigger for a shared module per RFC-0009's guidance.

---

### OQ-6: Visual hint authoring (color, glyph)

**Decision**: Leave `color` and `glyph` blank in the gram for tile types (`.tsx` tilesets don't carry them). Emit `glyph` and `color` from `*.items.json` when present (they already appear in `freeplay.items.json`).

**Rationale**: Current `.tsx` tilesets carry only `capacity` as a tile property — no `color` field. Adding authoring conventions for `color` in Tiled is a follow-up. Item sidecars already have `glyph` and `color` fields; these are emitted directly.

---

### OQ-8: Reference renderer fallback table

**Decision**: A checked-in table `tools/tmj-to-gram/test/render/fallbacks.ts` indexed by tile type label, covering the sandbox fixtures (`Blue`, `Cyan`, `Green`, `Yellow`, `Red`, `Purple`). Contributors add a row when adding a new sandbox fixture.

**Rationale**: A hash-based palette is non-deterministic across tool versions. A `*.style.json` sidacar doesn't exist yet and is overkill. A small static table is reviewable, explicit, and makes the Layer 3 pixel-diff test reproducible on any machine.

**Fallback table (tile types in sandbox)**: `Blue → #2196F3`, `Cyan → #00BCD4`, `Green → #4CAF50`, `Yellow → #FFEB3B`, `Red → #F44336`, `Purple → #9C27B0`.

---

### OQ-9: Polygon-to-cells provider

**Decision**: Use `h3.polygonToCells(latLngVertices, 15)` — option (a), geographic projection.

**Rationale**: Confirmed working in the sandbox. For each `tile-area` object, convert the Tiled pixel vertex list to H3 cell lat/lng via `h3.cellToLatLng(h3.localIjToCell(anchor, {i, j}))`, then pass the `[lat, lng]` array to `h3.polygonToCells`. The res-15 cells are small enough (~0.9 m²) that projection precision is not a problem at venue scale. Flood-fill (option b) was considered but requires maintaining a custom adjacency BFS that `h3.polygonToCells` already provides.

**h3-js API confirmed**: `polygonToCells(vertices: [lat, lng][], resolution: number): string[]` — array-of-array form, no GeoJSON wrapper needed.

---

## Dependency Inventory

| Dependency | Already in repo? | Location |
|---|---|---|
| `h3-js` | Yes | `server/world-api`, `server/colyseus` (v005) |
| `@relateby/pattern` | Yes | `server/world-api/src/rules/gram-rules.ts` |
| `fast-xml-parser` | Yes | `server/world-api` (tileset parsing, v007) |
| `effect` v3+ | Yes | All server packages |
| `@effect/cli` | Yes | `ghosts/ghost-cli` (v004) |
| `pixelmatch` | Not yet | Need as devDependency in `tools/tmj-to-gram` |
| `pngjs` (or `sharp`) | Not yet | Need for rasterizing SVG in Layer 3 test |
| `ulid` | Not yet | Need in `tools/tmj-to-gram` for stable node IDs |

**Note on `@effect/cli`**: The CLI binary uses `@effect/cli` + `@effect/platform-node` per the ghost-cli precedent (v004). No new external CLI framework needed.

---

## Existing Code Patterns

### Effect Layer pattern (from `ItemService.ts`)

```typescript
export class ItemService extends Context.Tag("aie-matrix/ItemService")<
  ItemService,
  ItemServiceOps
>() {}

export const makeItemLayer = (loadedMap: LoadedMap): Layer.Layer<ItemService> =>
  Layer.succeed(ItemService, new ItemServiceImpl(loadedMap));
```

`MapService` follows the same pattern:
- `Context.Tag("aie-matrix/MapService")` with a `MapServiceOps` interface
- `Layer.scoped` for the startup scan + validation (async file I/O + cleanup-safe)

### Typed error pattern (from `world-api-errors.ts`)

```typescript
export class MapNotFoundError extends Data.TaggedError("MapError.NotFound")<{
  readonly mapId: string;
}> {}
```

Tags follow `"Domain.Variant"` convention. `MapNotFoundError` and `UnsupportedFormatError` must both have `Match.tag` branches in `server/src/errors.ts:errorToResponse()`.

### `@relateby/pattern` gram parsing

`Gram.parse(text)` returns an `Effect.Effect<..., GramParseError>`. Used via `Effect.flatMap` on the file read result. Already demonstrated in `gram-rules.ts`.

---

## Tiled TMJ Structure (verified against `maps/sandbox/freeplay.tmj`)

- Grid: `tilewidth: 32`, `tileheight: 28`, `hexsidelength: 16`, `staggeraxis: "x"`, `staggerindex: "odd"`
- Layer types encountered: `tilelayer` (class `layout`, `item-placement`), `objectgroup` (class `tile-area`)
- Properties: `h3_anchor` (string), `h3_resolution` (int, must be 15)
- Tileset references: relative `.tsx` paths from the map file directory
- `map-with-polygons.tmj` has `tile-area` objects with rectangle shapes (no polygons yet in sandbox); the spec requires polygon support as well.

---

## CI Integration Plan

- New CI step: `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj --out /tmp/freeplay-ci.map.gram && diff maps/sandbox/freeplay.map.gram /tmp/freeplay-ci.map.gram`
- Runs on every push; fails if conversion output changes without a matching committed file update.
- Golden regeneration command: `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` (overwrites in-place; commit the result).
