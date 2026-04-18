# RFC-0003: H3 Geospatial Coordinate System

**Status:** draft  
**Date:** 2026-04-18  
**Authors:** @aie-matrix  
**Related:** [RFC-0001](0001-minimal-poc.md), [RFC-0002](0002-rule-based-movement.md), [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md)

## Summary

Replace the current Tiled odd-q offset coordinate system with Uber's H3 hierarchical hexagonal geospatial index as the canonical cell identity for the ghost world. Every map cell is identified by its H3 index at resolution 15 (~0.9m² per cell). Existing Tiled `.tmj` maps gain an `h3_anchor` property so the server can derive H3 indices at load time without abandoning the Tiled authoring workflow. A new spectator client (separate from the existing Phaser view) can render ghost positions as an overlay on a real-world map, enabling a Pokémon Go–style experience for conference attendees. Ghost movement mechanics and the MCP compass interface are preserved. Twelve permanent global portals — one at each of H3's geometrically required pentagonal cells — are established as a long-range feature of the ghost world's cosmology.

## Motivation

The current coordinate system is self-contained and has no relationship to physical space. This limits two things that matter for the conference experience:

**Real-world overlay.** A spectator carrying a phone cannot orient themselves relative to ghosts unless ghost positions can be projected onto a real map. H3 indices are natively convertible to lat/lng centroids, making a geospatial spectator view straightforward to build without changing anything in the ghost world model itself.

**Richer ghost navigation.** At H3 resolution 15, a typical conference floor contains 1,500–2,000 navigable cells. A coffee station is 2–3 cells; a vendor booth is ~9 cells; crossing the floor end-to-end is 40–50 moves. This makes ghost navigation a genuine challenge that differentiates ghost strategies: random walkers get lost, pathfinders can route efficiently, social ghosts follow density gradients. The resolution does real mechanical work, not just cosmetic work.

**Global cosmology.** H3's icosahedral projection requires exactly 12 pentagonal cells worldwide. These cells have 5 neighbors instead of 6 and represent a geometric inevitability of the coordinate system. Treating them as permanent world portals gives the ghost world deep structure that rewards exploration, is discoverable through research rather than authorial fiat, and has no real-world analogue — ghosts and spectators inhabit genuinely different ontologies sharing only a coordinate substrate.

## Design

### Coordinate identity

Each map cell is identified by its H3 index at **resolution 15** (hex diameter ~1.1m, area ~0.9m²). The H3 index is a 64-bit integer, typically represented as a 15-character hex string (e.g. `8f2830828052d25`). This replaces the current `CellId` string of the form `"col,row"`.

`CellRecord` gains an `h3Index` field. The `col` and `row` fields are retained during the Tiled transition period so existing map loading code continues to work.

```
CellRecord {
  col: number        // Tiled column (retained for authoring)
  row: number        // Tiled row (retained for authoring)
  h3Index: string    // Canonical cell identity (H3 res-15 index)
  tileClass: string
  neighbors: Partial<Record<Compass, string>>  // values are h3Index
}
```

The Neo4j world graph uses `h3Index` as the node identity property. `col`/`row` are stored as metadata but not used for graph traversal.

### Map authoring — H3 anchor

Existing `.tmj` maps gain two custom map-level properties:

| Property | Type | Example |
|---|---|---|
| `h3_anchor` | string | `"8f2830828052d25"` |
| `h3_resolution` | integer | `15` |

`h3_anchor` is the H3 index of the cell that corresponds to Tiled column 0, row 0. At map load time, the server walks the Tiled grid and derives each cell's H3 index by projecting from the anchor using `h3.gridPathCells` or equivalent neighbor traversal. The Tiled authoring workflow — painting tiles, assigning `tileClass` via the tile `type` field — is otherwise unchanged.

The anchor is set once per map by the map author, who picks a real-world lat/lng for the top-left corner of the map and converts it: `h3.latLngToCell(lat, lng, 15)`.

### Compass directions

The ghost MCP interface (`n`, `s`, `ne`, `nw`, `se`, `sw`) is preserved. Within a conference venue (~200m × 200m), H3's icosahedral distortion is negligible — compass directions are assigned at load time by computing the bearing from each cell's centroid to each neighbor's centroid and quantizing to the nearest of the six compass labels. This approximation is perceptually accurate at venue scale and requires no changes to the ghost-facing MCP contract.

### Spectator overlay client

A new client package (`client/map-overlay/` or equivalent) consumes ghost positions from Colyseus as H3 indices and renders them on a real-world map (MapLibre GL or Leaflet). Ghost positions are converted to lat/lng using `h3.cellToLatLng`. This client is entirely separate from `client/phaser/`; it does not replace the Phaser spectator but supplements it for the phone-based conference experience.

Ghost world and real world share only the coordinate substrate. Ghost obstacles have no real-world counterpart; real-world walls have no ghost-world counterpart. A ghost may appear to walk through a physical wall. This is intentional.

### Non-adjacent movement (portals and elevators)

Some movement in the ghost world jumps further than one hex step. Portals, elevators, and other traversals are represented as graph edges in Neo4j with a relationship type distinct from `ADJACENT` (e.g. `PORTAL`, `ELEVATOR`). The ghost MCP interface gains a `traverse` tool alongside `go`:

| Tool | Purpose |
|---|---|
| `exits` | Lists adjacent compass directions plus any named non-adjacent exits from `here` |
| `traverse` | Steps through a named non-adjacent exit (e.g. `{ via: "elevator-b" }`) |

The local-frame principle is preserved: ghosts never address arbitrary H3 indices directly. They ask what exits are available and choose among named options.

### Pentagon portals (cosmological constant)

H3's icosahedral projection requires exactly 12 pentagonal cells worldwide. These cells have 5 neighbors instead of 6. Their locations are fixed by the H3 specification and are publicly computable.

These 12 cells are permanent global portals in the ghost world. A ghost that reaches a pentagon can traverse to any other pentagon. The portal network topology (fully connected vs. icosahedron-adjacency graph) is an open question deferred to a follow-up RFC. Pentagon cells are surfaced by `exits` as named non-adjacent exits when a ghost occupies one; no special case is needed in movement validation beyond the existing non-adjacent traversal mechanism.

Pentagon portals are a long-range feature. They require no special handling at res-15 venue scale; no conference venue is likely to contain a pentagon cell.

## Open Questions

1. **Anchor projection fidelity.** Projecting a Tiled rectangular grid onto H3 via neighbor traversal accumulates small geometric errors because H3 hexes are not perfectly rectangular. For a 50×40 cell map, how large is the drift between the Tiled (col, row) and the true H3 position of that cell? Is it acceptable for venue-scale maps, or does the anchor approach need a correction step?

2. **Pentagon portal topology.** When pentagon portals are activated, should each pentagon connect to all 11 others (diameter 1 from any pentagon), or only to geometrically adjacent icosahedron vertices (diameter 2–3, more interesting routing)? Deferred to a follow-up RFC.

3. **Sub-cell positioning.** H3 res-15 is ~1m² per cell. For ghosts, cell-level granularity is sufficient. For a future spectator experience where a phone user wants to know "which cell am I in right now," GPS accuracy (~3–5m) may span multiple res-15 cells. No decision required now; flagged for the spectator client design.

4. **Map authoring at scale.** A full conference floor at res-15 is 1,500–2,000 cells. Hand-authoring in Tiled is feasible but tedious. Programmatic generation from a venue floor plan (SVG or CAD import → auto-assign tileClass by region → manual fine-tuning) is a likely follow-up. This RFC does not require it.

5. **Resolution of the `client/map-overlay/` package name and technology choice** (MapLibre GL vs. Leaflet vs. other). Deferred to the implementation spec for that package.

6. **Neighbor count assumption.** Current code in `hexCompass.ts` and `mapLoader.ts` implicitly assumes up to 6 neighbors. The pentagon case (5 neighbors) should not cause failures, but the assumption should be made explicit and tested. Flagged for the implementation task list.

## Alternatives

**Keep odd-q offset coordinates, add a lat/lng lookup table.** The simplest path to a geospatial overlay: store a `(lat, lng)` pair per cell in the map file, skip H3 entirely. Rejected because it decouples cell identity from geospatial position, making the spectator overlay fragile (positions must be kept in sync manually), and forfeits the neighbor traversal and hierarchical containment that H3 provides natively. It also makes the pentagon cosmology impossible.

**Use GeoJSON + H3 as the authoring format, abandon Tiled.** The most geospatially native approach: author maps as GeoJSON polygons, derive H3 cells by compacting the region, assign tileClass via rules. Rejected for now because it requires a new authoring workflow and tool before any other work can proceed. The H3 anchor approach preserves the existing Tiled investment while unlocking geospatial overlay. A custom editor remains the right long-term direction once the conference is behind us.

**Use a coarser H3 resolution (res 12–13).** At res 12, a conference floor is 10–20 cells; at res 13 it is ~100 cells. Rejected because these resolutions make ghost navigation trivial — a random walker crosses the floor in a handful of steps, and there is no meaningful difference in ghost strategy. Res 15 makes navigation a genuine challenge and gives features like coffee stations and vendor booths their own cell identity.

**Pointy-top H3 orientation.** H3 uses a fixed orientation internally; cell geometry is an output of the projection, not a user choice. This alternative does not apply. The compass approximation handles orientation at render time.
