# ADR-0005: H3-Native Map Format (.map.gram)

**Status:** proposed  
**Date:** 2026-04-25  
**Authors:** @akollegger  
**Relates to:** [RFC-0004](../rfc/0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0006](../rfc/0006-world-objects.md) (world objects / items sidecar),
[RFC-0008](../rfc/0008-human-spectator-client.md) (intermedium / human spectator client)

## Context

Maps are currently authored in Tiled's `.tmj` format and loaded statically at
server startup. RFC-0004 introduced H3 as the canonical cell identity and added
an `h3_anchor` property to `.tmj` files so that cell positions can be geocoded
at load time. This was an intentional migration bridge, not a final format.

Four pressures now force a format decision:

**The Tiled format is the wrong long-term abstraction.** Tiled's odd-q offset
grid exists to solve a 2D tile-map authoring problem. The ghost world's spatial
substrate is H3 — a geocoded hexagonal index. Tiled cannot express H3 adjacency,
pentagon cells, or non-adjacent portal edges natively. The `h3_anchor` bridge
works but forces the server to reverse-engineer H3 topology from a grid
representation that was never designed to carry it.

**The world is moving to Neo4j.** The target architecture stores the navigable
world as a graph in Neo4j (see `docs/architecture.md` "Decided Stack" and the
seed scripts in `server/world-api/src/neo4j-graph-init.ts`). The current
load-time pipeline converts `.tmj` → CellRecord → Neo4j. A format that is
already graph-shaped eliminates a translation layer and makes the authoring
intent directly legible in the stored graph.

**Multi-floor venues require a clean floor model.** AIEWF 2026 takes place at
Moscone Center, which has multiple conference floors. Tiled has no floor concept.
The new format should express floor as map-level metadata.

**The intermedium client needs a map API.** RFC-0008 requires the world-api to
serve map topology at startup — tile types, H3 cell graph, item placements. A
well-specified map format and serving endpoint are prerequisites for that API
contract.

The project already uses `.gram` files for movement rules (`*.rules.gram`). The
gram format supports top-level metadata records, typed nodes, typed relationships,
and inline property bags — exactly the structure a map requires.

A native world editor is a future effort. For AIEWF 2026, **Tiled remains the
authoring tool**. Maps are authored in Tiled following the conventions defined
below, then converted to `.map.gram` for production use. The server serves both
formats from a single source of truth.

## Decision

The canonical map format is `*.map.gram`, derived from Tiled `*.tmj` (plus
the per-map `*.items.json` sidecar) via the conventions specified below.
The world-api serves both formats from the same source so existing (`.tmj`)
and new (`.map.gram`) clients each consume the format they expect. The
remainder of this section specifies the Tiled authoring conventions (Part 1),
the gram payload (Part 2), and the serving endpoint (Part 3).

### Part 1: Tiled Authoring Conventions

Maps for the ghost world are authored as Tiled `.tmj` files with the following
required conventions:

**Top-level custom properties:**
- `h3_anchor` (string) — H3 index of the tile at grid position (0, 0). Required.
  Used to geocode all other tiles at load time.
- `h3_resolution` (integer) — must be `15`. Required.
- `elevation` (integer) — floor level, 0 = ground floor. Required for
  multi-floor venues. Defaults to 0 if absent.
- `map_name` (string) — human-readable identifier for this map. Conventionally
  matches the file's stem and is propagated to the gram payload's `name` field
  (which serves as `mapId` at the serving endpoint).

**Layer class conventions** (Tiled ≥1.9 layer `class` field; layer `name` is
free-form and not interpreted):
- `layout` — the navigable tile layer. Tile type is determined by the tile's
  GID resolved to a named tile in the `.tsx` tileset (tile `type` field).
- `tile-area` — an object layer declaring tile-type regions. See
  *Tile area objects* below.
- `item-placement` — tile layer(s) for startup item instances (see RFC-0006);
  the per-map `*.items.json` sidecar provides the canonical input that the
  conversion utility folds into the gram output.

Non-adjacent traversal (portals, elevators, cross-map links) is intentionally
out of scope for this ADR. See *Forward references* in *Consequences*.

**Tile area objects (`tile-area` layer):**

Each object on a `tile-area` layer declares a region of cells sharing a single
tile type. The object's Tiled `type` field names the target tile type (e.g.
`"Red"`, `"CarpetedFloor"`) and conventionally matches a tile type defined in
a `.tsx` tileset.

*Supported shapes:* **rectangle** and **polygon**. Ellipses are not supported;
the conversion fails-closed if it encounters one.

*Vertex-in-hex authoring rule.* Each polygon vertex (and each implicit
rectangle corner) must fall inside the pixel area of its target hex tile, not
on a hex border or in the gutter between hexes. Authoring this way makes
vertex → H3 cell translation unambiguous: each vertex resolves to exactly one
H3 cell.

*Non-overlap rule.* Tile-area objects on a single map must not overlap. The
conversion fails-closed when two areas' covered cell sets (computed via
`h3.polygonToCells` over their vertex lists) intersect.

*Compression rule (matching tiles are implied).* A tile painted on the
`layout` layer whose tile type matches the enclosing area's `type` is
**omitted** from the gram as an individual tile node — the area node alone
covers it. This is what makes large uniform regions cheap to encode.

*Override rule (non-matching tiles are emitted).* A tile painted on the
`layout` layer whose tile type does not match the enclosing area's `type` is
**emitted** as an individual tile node, overriding the area at its location.

*Areas may introduce a tile type without painted tiles.* An area with
`type: "Lobby"` over a region with no `Lobby` tiles painted on `layout` still
fills the region with `Lobby` cells. The compression rule degenerates to "no
tiles omitted"; the override rule degenerates to "all painted tiles emitted
as overrides".

*Type-mismatch warnings.* If an area's `type` does not match any tile type in
the loaded tilesets, the conversion logs a warning (typo or intentional
introduction). It does not fail.

### Part 2: .map.gram Format

The canonical production format is `*.map.gram`. It is derived from `.tmj`
during conversion and is the format imported into Neo4j and served by world-api.

A `.map.gram` file contains:

1. **Top-level metadata record** — `kind` (required, conventionally
   `"matrix-map"`), `name` (required; serves as `mapId` at the serving endpoint
   and conventionally matches the gram filename stem, e.g.
   `moscone-north-l1.map.gram` → `name: "moscone-north-l1"`), `elevation`
   (defaults to `0` if absent).
2. **TileType definitions** — nodes with `TileType` and a domain label, carrying
   `name` and `color`. Visual attributes are rendering hints; clients interpret
   them as they choose.
3. **Polygon area nodes** — nodes with `Polygon` and a `TileType` domain label.
   Vertex list is an ordered sequence of H3 cell ID strings forming a closed
   boundary. All H3 cells inside the polygon are implicitly instantiated as
   tiles of that type. Tiled rectangle and polygon shapes both lower to gram
   `Polygon` nodes (the gram has no rectangle primitive). Tiled-authored maps
   never produce overlapping polygons (Part 1 *Non-overlap rule*); the gram
   format itself permits overlap and resolves it by last-declaration wins as
   a defensive default.
4. **Individual tile nodes** — nodes with a `TileType` domain label and a
   `location` (H3 index string). Override polygon fill at their location.
5. **ItemType definitions** — nodes with `ItemType` and a domain label, carrying
   `name`, `color`, `glyph`.
6. **Item instance nodes** — nodes with a domain label matching an ItemType and
   a `location` (H3 index string).

H3-adjacent tiles within the map boundary are implicitly navigable; explicit
adjacency edges are not stated.

The map boundary is the axis-aligned bounding box of all H3 cells declared in
the gram file (polygon-derived plus individually declared). Bounding-box
positions with no declared cell are empty — they have no tile and are not
navigable. The boundary is derived at import time and is not stored in the
gram file.

**Item sidecar input.** Item definitions and instances in the gram file are
folded in by the conversion utility from the per-map `*.items.json` sidecar
(RFC-0006). The sidecar remains the authored input; the gram payload is the
integrated artifact consumers read. RFC-0006's runtime JSON load path is
superseded by the gram-derived input — the items sidecar continues to exist
as a build-time source, not a runtime one.

**Canonical example:**
```gram
{
    kind: "matrix-map",
    name: "moscone-north-l1",
    elevation: 1
}
(carpetedFloor:TileType:CarpetedFloor {
    name: "carpeted floor",
    color: css`gray`
})
[mainHall:Polygon:CarpetedFloor |
    nw, ne, se, sw
]
(nw:CarpetedFloor { location: "8f2830828052d25" })
(pillar:TileType:Pillar { name: "pillar" })
(pillar1:Pillar { location: "8f2830828052d26" })
(brassKey:ItemType:BrassKey {
    name: "brass key",
    color: css`red`,
    glyph: "🔑"
})
(key1:BrassKey { location: "8f2830828052d25" })
```

### Part 3: Dual-Format Map Serving

The world-api serves maps at:

```
GET /:mapId?format=tmj   — returns the source .tmj file
GET /:mapId?format=gram  — returns the derived .map.gram (default)
```

The `.tmj` is the source of truth; `.gram` is derived and may be cached. The
Phaser debugger client continues to use `format=tmj` without modification. The
intermedium and any H3-native client uses `format=gram`.

A single world is assumed for now. The `:worldId` routing level is omitted and
can be introduced when multi-world support is needed.

## Rationale

**Gram aligns with the world model's destination shape.** The world graph
lives in Neo4j as `(:Cell { h3Index })` nodes with typed relationships. Gram
is already a graph-shaped serialization — typed nodes, typed edges, property
bags. Choosing gram lets the version-controlled source, the served artifact,
and the runtime store carry the same shape, removing one translation layer
the current `.tmj` → CellRecord → Neo4j pipeline must perform.

**Tiled for now, gram for production.** Tiled is a mature, contributor-familiar
tool. Requiring authors to learn a new editor for AIEWF 2026 is unnecessary
risk. The convention-plus-conversion approach preserves authoring ergonomics
while moving the canonical format toward the graph model the architecture
requires.

**Dual-format serving over format migration.** The Phaser debugger depends on
`.tmj`. Forcing a format migration on the debugger to launch a new client would
couple two independent work streams. Serving both formats from the same source
keeps each client working in its native format and makes the format transition
incremental.

**Gram is already in the project.** Movement rules are authored in `.rules.gram`.
Extending the convention to maps adds no new tooling dependency and keeps the
authoring surface consistent for contributors.

**Tiled bans overlap; gram tolerates it.** Forbidding overlap on the authoring
side eliminates a class of "which polygon wins?" surprises and lets the
conversion fail-closed on author error. Keeping last-declaration-wins at the
gram level provides a deterministic fallback for any future hand-authored or
generated gram that does produce overlap, without forcing the conversion to
encode precedence metadata.

**Vertex-in-hex over edge-tracing.** Authors could trace polygon edges along
hex borders, but borders fall in the gutter between cells where pixel→hex
translation is ambiguous. Requiring each vertex to land *inside* a target hex
makes translation a simple point-in-hex lookup, so the gram polygon's vertex
list is exactly "the corner cells of the region."

**Two-phase area handling (vertices vs. fill).** The gram stores only the
ordered vertex list, not the enumerated interior. Consumers fill the interior
with `h3.polygonToCells` (or equivalent) at parse time. This keeps the gram
compact and shifts the H3 dependency to the consumer side, where it already
lives.

## Alternatives Considered

**Continue with `.tmj` + h3_anchor as the production format.** The existing
bridge works but cannot express pentagon cosmology or multi-floor relationships
natively, and forces the server to reverse-engineer H3 topology from a grid.
Import pipeline complexity grows with each new ghost world capability. The
bridge was always intended as temporary. Rejected.

**GeoJSON for area definition.** Expresses geographic polygons natively but has
no concept of tile types, item placements, or relationship edges. Would require
sidecar files for all non-geographic concerns, reproducing the current
fragmentation. Rejected.

**Custom JSON schema.** Straightforward to parse and validate but introduces a
new schema to maintain with no connection to the gram ecosystem already in use.
Rejected.

**Neo4j as source of truth (no flat-file format).** Author maps directly into
Neo4j via Cypher seed scripts or a graph admin UI, treating the database as
the canonical store. Eliminates the derived artifact and the conversion step
entirely. Rejected: contributors author maps in Tiled today and need a flat
artifact they can put in version control, review in PRs, and regenerate
deterministically in CI. Neo4j is the destination, not the authoring surface;
`.map.gram` is the committable record that survives database resets and feeds
the seed pipeline.

**Native world editor.** A purpose-built editor targeting `.map.gram` natively
would remove the Tiled dependency. Deferred: the effort is not justified for
AIEWF 2026. Named as a forward reference in the consequences section.

## Consequences

**Immediate:**

- Tiled authoring conventions (`h3_anchor`, `h3_resolution`, `elevation`,
  `map_name`, `layout` / `tile-area` / `item-placement` layer classes,
  `tile-area` shape and overlap rules) must be documented in `CONTRIBUTING.md`
  and the world-api package README before Moscone map work begins. This is a
  prerequisite for any map author to work correctly.
- A conversion utility (`tmj-to-gram`) is required before production map serving
  is possible. It must handle: Tiled grid → H3 index projection from
  `h3_anchor`, tile-area vertex geocoding (point-in-hex per vertex →
  `h3.localIjToCell`), area compression / override against the `layout` layer,
  ellipse rejection, area-overlap detection, and item placement translation by
  folding the per-map `*.items.json` sidecar (RFC-0006) into the gram output.
  This is a migration and build tool, not a runtime component.
- The world-api gains a `/:mapId?format=` serving endpoint. The existing static
  load path is replaced by an import pipeline that reads `.tmj`, derives
  `.map.gram`, and populates Neo4j.
- The Phaser debugger is unaffected at acceptance time. It continues to
  consume `format=tmj`.
- `docs/architecture.md` § "World item state (PoC)" needs updating when this
  ADR is accepted: items now flow through the gram payload at serving time,
  not directly from the runtime JSON sidecar. The sidecar persists as a
  build-time input to the conversion utility. The architecture.md edit should
  land in the same PR that flips this ADR's status to `accepted`.

**Ongoing:**

- All Moscone floor maps are authored in Tiled following the conventions above,
  one `.tmj` file per floor, with `elevation` and `map_name` set appropriately.
- TileType and ItemType definitions will be duplicated across floor files until
  a `.types.gram` shared definition mechanism is introduced. Acceptable for
  two or three floors.
- Cross-floor traversal (elevators, stairs) is not yet expressible. Multi-floor
  authoring is supported (each floor is a standalone `.map.gram`) but ghosts
  cannot move between floors until a follow-up proposal introduces a portal /
  cross-map-link encoding. Floors are usable as independent worlds in the
  meantime.
- The Phaser debugger acquires a long-term dependency on `format=tmj` being
  served by world-api. Removing `.tmj` from the serving surface in the future
  requires either migrating the debugger to consume `.map.gram` or retiring
  the debugger in favor of the intermedium. Until then, both formats stay
  supported.
- Authors will encounter fail-closed conversion errors when they violate the
  `tile-area` rules (ellipse shape, overlapping areas, gutter-vertex). The
  intent is loud, immediate feedback at conversion time rather than silent
  semantic drift, but it is real authoring friction the contributor docs must
  prepare authors for.

**Forward references (out of scope for this ADR):**

- `.types.gram` — shared type definitions consumed by multiple map files.
- `.world.gram` — assembles multiple maps and declares cross-map relationships
  for multi-floor worlds and connected venues.
- `:worldId` routing — deferred until multi-world support is needed.
- Native world editor — a future investment targeting `.map.gram` directly and
  removing the Tiled authoring dependency.

**Reversibility:** Costly. Replacing this format requires reauthoring or
re-converting all maps, updating the import pipeline, and revising the
intermedium's map API contract. The dual-format serving decision is easier to
reverse independently, but the gram format as the canonical store is a long-lived
commitment.
