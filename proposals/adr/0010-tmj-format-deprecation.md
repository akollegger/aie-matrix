# ADR-0010: TMJ Format Fully Deprecated — Gram-Only Map Catalog

**Status:** accepted — implemented by `specs/020-map-catalog-standardization`  
**Date:** 2026-05-25  
**Authors:** @akollegger  
**Relates to:** [ADR-0005](./0005-h3-native-map-format.md) (H3-native `.map.gram` format),
[RFC-0009](../rfc/0009-map-format-pipeline.md) (map format pipeline — deferred Colyseus switch)

## Context

ADR-0005 established `.map.gram` as the canonical runtime format and positioned Tiled's `.tmj` format as a temporary authoring bridge. RFC-0009 implemented the conversion pipeline (`.tmj` → `.map.gram`) and the HTTP serving layer but explicitly deferred dropping `?format=tmj` from the world-api endpoints and left the legacy `loadTmjMap()` path in the Colyseus server.

As of spec-020, every map in the `maps/` directory has a complete `.map.gram` counterpart. The conversion bridge has served its purpose. Three remaining artefacts still carry TMJ support:

1. `server/world-api/src/map/MapService.ts` — scans `.tmj` files alongside `.map.gram` and exposes a `tmjPath` field on `MapIndexEntry`
2. `server/world-api/src/map/MapRoutes.ts` — serves `?format=tmj` responses and includes a `_links.tmj` field in the map listing
3. `server/colyseus/src/mapLoader.ts` — retains `loadTmjMap()` (marked `@internal`) alongside the production `loadHexMap()` (gram-only)

Retaining these paths:
- Misleads contributors into thinking TMJ is still a viable input format
- Prevents simplifying the `MapService.raw()` interface (currently overloaded for two formats)
- Keeps ~400 lines of dead Colyseus code that is never called at runtime
- Blocks a clean public API contract for the HTTP maps endpoint

## Decision

**Fully remove TMJ support from the running server.** Specifically:

1. `MapIndexEntry` drops `tmjPath`; `MapService.raw()` becomes gram-only (no `format` parameter)
2. `MapRoutes` removes `_links.tmj` from the response and returns `400` for `?format=tmj`
3. `loadTmjMap()` and all supporting TMJ types/helpers are deleted from `mapLoader.ts`
4. All `.tmj`/`.tmx` source files and legacy `.items.json` sidecars are removed from `maps/`
5. `tools/tmj-to-gram` is tombstoned (deprecated but preserved for historical reference)

The HTTP API change (`?format=tmj` → 400) is a **breaking change** for the Phaser-based debugger noted in IC-002. That tool was an AIEWF-era experiment that is no longer maintained; the breakage is accepted.

## Consequences

**Positive:**
- `MapService.raw()` has a single, unambiguous contract
- Map catalog startup only scans gram files — simpler and faster
- ~400 lines of dead Colyseus code removed
- `MapListItem.links` no longer exposes a dead URL
- New contributors see one map format, not two

**Negative / Accepted:**
- `GET /maps/:mapId?format=tmj` now returns `400` — breaks the unmaintained Phaser debugger
- `.tmj` files can no longer be served directly by the API (existing gram counterparts cover all maps)

## Alternatives Considered

**Keep `?format=tmj` returning 410 Gone** — cleaner HTTP semantics, but adds code solely to serve an explicit error. `400` via the existing `UnsupportedFormatError` path with a clear message is sufficient.

**Keep `loadTmjMap()` under a feature flag** — rejected; the function has no callers at runtime and introduces ongoing maintenance surface.
