# RFC-0006: World Items

**Status:** under review  
**Date:** 2026-04-22  
**Authors:** @akollegger  
**Related:** [RFC-0002](0002-rule-based-movement.md) (resolves Open Question 3: ghost inventory),
[IC-005](../specs/001-minimal-poc/contracts/sample-map.md) (map contract)

## Summary

Introduce world objects: named, stateless definitions that can be placed on hex
tiles, noticed by nearby ghosts, inspected up close, and — when carriable —
picked up into a ghost's inventory. Items are defined in a per-map sidecar
file (`*.items.json`) and placed on tiles via a custom Tiled property. The
world owns all positional state; an item definition knows nothing about where
it is.

## Motivation

The world is currently populated only by ghosts. Tiles carry metadata, but
nothing sits *on* them that a ghost can discover, read, or collect. Objects
unlock the next layer of world richness:

- **Environmental storytelling** — signs, plaques, and kiosks give tiles
  readable context without requiring a dedicated NPC.
- **Obstacles** — a statue or booth fixture that consumes tile capacity,
  creating space constraints ghosts must navigate around.
- **Quest mechanics** — carriable items (keys, badges, tokens) that gates
  unlock via item-dependent rules in the RFC-0002 ruleset graph.
- **Proximity incentives** — items visible from adjacent tiles reward ghosts
  that explore rather than idle.

RFC-0002 explicitly deferred ghost inventory (Open Question 3) pending a
follow-up RFC. This is that RFC.

## Design

### Object definition

An item definition is a JSON record in a `*.items.json` sidecar file. The
definition describes what an item *is*; it carries no location.

```json
"sign-welcome": {
  "name": "Welcome Board",
  "itemClass": "Sign",
  "carriable": false,
  "capacityCost": 0,
  "description": "A large board listing the day's sessions and booth locations."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Short display name surfaced by `look`. |
| `itemClass` | string | yes | Label used by the ruleset graph for `PICK_UP`, `PUT_DOWN`, and item-constraint matching. Colon-separated multi-label follows the tile convention (e.g. `Key:Brass`). |
| `carriable` | boolean | yes | Whether a ghost may take this object into inventory. |
| `capacityCost` | integer | yes | How much of the host tile's `capacity` this object consumes. `0` for signs and small items that do not block movement. |
| `description` | string | no | Text returned by `inspect`. Omitting it means `inspect` returns only the `name`. |

### Sidecar file convention

Each map file `maps/<scene>/foo.tmj` MAY be accompanied by
`maps/<scene>/foo.items.json`. The sidecar is a plain JSON object keyed by
object ID. The ID is the key; it does not appear redundantly inside the record.

```json
{
  "sign-welcome": {
    "name": "Welcome Board",
    "itemClass": "Sign",
    "carriable": false,
    "capacityCost": 0,
    "description": "A large board listing the day's sessions and booth locations."
  },
  "key-brass": {
    "name": "Brass Key",
    "itemClass": "Key:Brass",
    "carriable": true,
    "capacityCost": 0,
    "description": "A small brass key stamped with the letter N."
  },
  "statue": {
    "name": "Marble Statue",
    "itemClass": "Obstacle",
    "carriable": false,
    "capacityCost": 1,
    "description": "A marble sculpture of a classical figure. It is not going anywhere."
  }
}
```

A missing sidecar is not a startup error — it means the map has no items.

The current PoC also supports `AIE_MATRIX_ITEMS` as an explicit sidecar override. When set, the value may be absolute or repo-relative; when unset, the server falls back to the co-located `*.items.json` file beside the active map.

### Tile placement via Tiled custom property

Object placement at world-start is authored in Tiled by adding a custom
property to any tile definition in the `.tsx` tileset file:

| Property name | Tiled type | Value |
|---|---|---|
| `items` | string | Comma-separated list of item refs (e.g. `"sign-welcome"` or `"key-brass,key-brass"`) |

This mirrors the existing `capacity` property convention on tile definitions.
The `items` property declares which item refs appear on a tile of that class
when the map is first loaded. It is an initial condition, not a permanent
binding — once the world is running, the tile may gain or lose objects as
ghosts act.

Example `.tsx` entry:

```xml
<tile id="7" type="Hallway">
  <properties>
    <property name="capacity" value="4"/>
    <property name="items" value="sign-welcome"/>
  </properties>
</tile>
```

If the same tile class appears multiple times on a map (as it typically does),
each instance of that class starts with the declared objects. This is well
suited for furniture, obstacles, and ambient signs that belong everywhere a
given tile class appears.

For tile-specific placement — one particular tile gets the key, not every tile
of that class — a second Tiled tile layer named `item-placement` is used
alongside the navigable tile layer. The author creates a tileset whose tile
`type` values are `itemRef` strings (e.g. `key-brass`, `sign-welcome`) and
paints those tiles onto the `item-placement` layer at exactly the cells that
should start with those objects. The map loader reads this layer using the same
grid-to-H3 logic as the navigable layer, treating each non-empty cell's
`type` as an `itemRef` placement. Multiple tile layers are valid in the `.tmj`
format and are already iterated by `mapLoader.ts`.

The two placement mechanisms compose: a cell may receive items from both its
tile class property and from the `item-placement` layer.

### World state

The server loads both the `.tmj` and the sidecar on startup. For each tile
that declares objects, and for each item ID listed, it creates a world-state
relationship:

```
(tile:H3Cell)-[:HAS_OBJECT {itemRef: "key-brass"}]->(:ObjectInstance)
```

When a ghost picks up an item:

```
(ghost:Ghost)-[:CARRIES {itemRef: "key-brass"}]->(:ObjectInstance)
```

The tile's `HAS_OBJECT` relationship is removed. The item definition remains
unchanged in the sidecar; only the world-state relationships mutate.

For the current PoC implementation, these relationships are modeled in-memory by `ItemService` and mirrored to Colyseus. Neo4j persistence is intentionally deferred until a follow-on RFC covers durable object state.

**Multiplicity** is handled naturally by this model. An `itemRef` is a
reference to a stateless definition, not a unique instance identifier. If three
tiles each have a `HAS_OBJECT` relationship with `itemRef: "chair"`, the
world simply has three chair relationships. When a ghost takes one, that
specific relationship moves to `CARRIES` on the ghost; the other two remain on
their tiles. Ghosts interact with the ref; the world tracks the relationships.
No internal instance numbering is needed.

Capacity accounting at any tile is: `ghostCount + Σ(capacityCost of objects with HAS_OBJECT on that tile) ≤ tile.capacity`.

### Ghost interaction surface

Four interactions extend the existing MCP tool surface. `look` is extended;
four new tools are added: `inspect`, `take`, `drop`, and `inventory`.

#### `look` (extended)

`look { at: "here" }` and `look { at: "around" }` already return tile detail.
Their responses gain an `objects` field: a list of `{ id, name, at }` summaries
for each item visible from the ghost's current position — on the current tile
or on any face-adjacent tile. The `at` field uses the same local-frame tokens
as the rest of the ghost interface: `"here"` when the object is on the ghost's
current tile, or a compass face (`n`, `s`, `ne`, `nw`, `se`, `sw`) when it is
on an adjacent tile. A ghost can act on this directly — `"at": "ne"` means
`go { toward: "ne" }` is the next step to reach that object.

```json
{
  "tileId": "...",
  "tileClass": "Hallway",
  "occupants": ["ghost-42"],
  "objects": [
    { "id": "sign-welcome", "name": "Welcome Board", "at": "here" },
    { "id": "key-brass", "name": "Brass Key", "at": "ne" }
  ]
}
```

#### `inspect`

Inspect an item by ID. The ghost must be on the same tile as the object.
Returns the object's full `description` (or `name` if no description is
defined). Attempting to inspect an item on a non-current tile returns a
structured denial.

```
inspect { itemRef: "sign-welcome" }
```

```json
{ "ok": true, "name": "Welcome Board", "description": "A large board listing the day's sessions and booth locations." }
{ "ok": false, "code": "NOT_HERE", "reason": "That object is not on your current tile." }
```

Failure codes: `NOT_HERE`, `NOT_FOUND`.

#### `take`

Pick up a carriable object from the current tile into the ghost's inventory.
The object must be on the same tile and be `carriable: true`. Subject to
`PICK_UP` ruleset evaluation (RFC-0002) — the ruleset may further restrict
which ghost classes may take which object classes.

```
take { itemRef: "key-brass" }
```

```json
{ "ok": true, "name": "Brass Key" }
{ "ok": false, "code": "NOT_CARRIABLE", "reason": "That object cannot be picked up." }
```

Failure codes: `NOT_CARRIABLE`, `NOT_HERE`, `NOT_FOUND`, `RULESET_DENY`.

#### `drop`

Place a carried item from the ghost's inventory onto the current tile.
Subject to `PUT_DOWN` ruleset evaluation. Fails if the tile's effective
capacity (ghosts + existing object costs + this object's cost) would be
exceeded.

```
drop { itemRef: "key-brass" }
```

```json
{ "ok": true }
{ "ok": false, "code": "TILE_FULL", "reason": "This tile has no room for that object." }
```

Failure codes: `NOT_CARRYING`, `TILE_FULL`, `RULESET_DENY`.

### Inventory

Ghost state gains an `inventory` field: an ordered list of carried item refs.
A dedicated `inventory` tool lists what the ghost is currently carrying.

```
inventory
```

```json
{ "ok": true, "objects": [ { "itemRef": "key-brass", "name": "Brass Key" } ] }
```

Returns an empty `objects` array when the ghost carries nothing. The ghost
client SDK (`@aie-matrix/ghost-ts-client`) gains corresponding result types in
`shared/types/`.

### Relationship to RFC-0002 rules

This RFC establishes the `itemClass` vocabulary that RFC-0002's ruleset graph
references in `PICK_UP`, `PUT_DOWN`, and inventory-conditional `GO` rules. The
Gram syntax for item-gated rules — for example, requiring a ghost to carry a
`Key:Brass` object to enter a locked tile — is deferred to RFC-0002, which
already names these as unresolved (Open Question 3 in that RFC). RFC-0006
delivers the items and refs that those rules will operate on; RFC-0002
delivers the syntax for expressing the conditions.

### Package ownership

- `shared/types/` — new result types: `InspectResult`, `TakeResult`,
  `DropResult`; extension of `TileInspectResult` with `objects` field.
- `server/world-api/` — new MCP tool handlers for `inspect`, `take`, `drop`, `inventory`;
  object loader; capacity accounting update; `PICK_UP`/`PUT_DOWN` ruleset
  evaluation.
- `server/colyseus/` — object world state broadcast to Phaser spectators
  (items visible on tiles).
- `maps/<scene>/` — new `*.items.json` sidecar files per map.
- `client/phaser/` — rendering of object presence on tiles is deferred to a
  follow-up client RFC.

### Demo scenario

With the sandbox map running and a ghost adopted:

1. Author `maps/sandbox/freeplay.items.json` with at least one `Sign` and one
   carriable `Key`.
2. Add `items` custom properties to two tile types in `color-set.tsx` placing
   the sign on one tile class and the key on another.
3. Start the server. Confirm startup succeeds with no errors.
4. Move a ghost to a tile adjacent to the sign tile. Call `look` and confirm
   the sign appears in the `objects` list of the neighboring tile summary.
5. Move the ghost onto the sign tile. Call `inspect { itemRef: "..." }` and
   confirm the description is returned.
6. Move the ghost to the key tile. Call `take { itemRef: "..." }` and confirm
   success. Call `look here` and confirm the key no longer appears on the tile.
7. Move to a different tile. Call `drop { itemRef: "..." }` and confirm
   success. Call `look here` and confirm the key now appears on that tile.
8. Attempt `inspect` from an adjacent tile (not the object's tile). Confirm
   structured denial.

## Open Questions

- Neo4j persistence for object placement is deferred to a follow-on RFC; the current PoC uses in-memory `ItemService` state plus Colyseus broadcast.

## Alternatives

**Tiled Object Layer for placement.** Tiled's object layer supports pixel-placed
objects with custom properties. Rejected because object layer snapping does not
work reliably on hex maps — objects snap to cell corners or cell intersections
rather than cell centers, making pixel-to-H3 resolution ambiguous and the
authoring experience fragile. A dedicated `item-placement` tile layer avoids
this entirely by using the same grid-native coordinate system as the navigable
layer.

**Object properties directly on tile definitions, no sidecar.** Each tile
carries all object metadata as Tiled custom properties. Rejected because it
conflates the tile's physical nature with its transient contents: tile
properties are static map data while object placement is initial world state
that changes as ghosts act. It also makes object reuse across tile classes
awkward and bloats the `.tsx` file with content that belongs in the world layer.

**Objects as a special ghost class.** Model objects as non-autonomous ghosts
with no movement capability. Rejected because it misuses the ghost identity and
adoption system, adds noise to occupancy queries, and breaks the clean
separation between agents (ghosts) and world fixtures (objects).
