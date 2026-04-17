# RFC-0002: Rule-Based Movement Mechanics

**Status:** draft
**Date:** 2026-04-15
**Authors:** @akollegger
**Related:** [RFC-0001](0001-minimal-poc.md)

## Summary

Replace the permissive no-op movement ruleset shipped in RFC-0001 with a
rule-based system that evaluates a ghost's proposed action as a constraint
satisfaction problem over the properties of the current tile, the destination
tile (if any), and the ghost itself. Rules are expressed as a typed-relationship
graph — a state machine where tile class nodes are connected by action-typed
edges that carry optional ghost constraints — stored independently of the map
and evaluated by `server/world-api/` against live world state at action time.

## Motivation

The PoC ships with a permissive ruleset that allows any ghost to move to any
adjacent tile. This is sufficient to prove the stack, but it leaves the world
flat — every tile is equivalent, space has no structure, and ghost behavior
carries no meaning beyond position change.

A rule-based system makes the world legible and interactive. Rules define which
actions are permitted, under what conditions, and at what cost. From that single
mechanism, a wide range of spatial and game semantics emerge without requiring
the map to encode them directly:

- **Rooms** — tiles sharing a class that deny crossing into a different class
  form bounded spaces.
- **Walls** — tile class pairs with no matching rule become impassable
  boundaries.
- **Doorways** — tiles at a class boundary that accept entry from either side
  become passages between rooms.
- **Obstacles** — a tile that denies all incoming moves is an obstacle within
  any room.
- **Flow direction** — asymmetric rules between the same class pair create
  one-way or high-resistance corridors.
- **Portals and elevators** — explicit (non-geometric) connections between
  tiles, validated by the same rule mechanism as adjacency-based moves.
- **Keyed doors** — rules that require a ghost to carry a specific item.
- **Capacity constraints** — rules that consult dynamic tile properties such as
  current occupancy.
- **Movement cost** — rules that permit a move but attach a cost.
- **In-place actions** — picking up or putting down items, toggling switches,
  and other interactions that affect the tile a ghost currently occupies without
  changing position.
- **World state dependencies** — actions whose availability depends on dynamic
  world state, such as `look` revealing information only when a light is on.

Space and interaction emerge from rules, not from geometry or hardcoded logic.
The same map can express a different world by swapping the ruleset. Ghost
intelligence is exercised by discovering the rule structure through action
attempts and their responses.

## Design

### Two graphs, one evaluator

The system relies on two distinct but jointly-queryable graphs:

- **World state graph** — instances, positions, dynamic properties, and
  relationships that change as ghosts act. Owned by `server/world-api/` and
  `server/colyseus/`. Examples: which ghost is on which tile, current occupancy
  of a tile, whether a switch is on or off, what items are present.

- **Ruleset graph** — types, policies, and permitted transitions. Authored
  independently of the map. Does not contain instance data. Examples: Attendees
  may GO to Hallway tiles, Speakers may GO to Stage tiles, any ghost may
  PICK_UP on an Entrance tile.

When a ghost requests an action, the evaluator queries the world state graph
first to build the local context — who is acting, where, what is the state of
relevant tiles and items. It then evaluates the ruleset graph against that
context to determine whether the action is permitted.

### Action-typed relationships

Relationship types in the ruleset graph correspond directly to ghost actions.
A ghost that calls `go n` triggers evaluation of `GO` relationships. A ghost
that calls `pick_up` triggers evaluation of `PICK_UP` relationships. This makes
the ruleset graph a direct expression of the world's response to ghost behavior
rather than an abstract policy layer.

Each relationship type carries properties specific to that action. All action
relationships may also carry ghost constraint properties (`ghostClass`,
`ghostRole`, or other ghost features); a rule with no ghost constraints matches
any ghost.

- `GO` carries `toward` (n, s, ne, nw, se, sw) and optionally `cost`.
- `JUMP` carries a destination label or identifier and optionally `cost`.
- `PICK_UP` and `PUT_DOWN` carry item type constraints.
- `TOGGLE` carries the property name being mutated.
- Future action types define their own property vocabulary.

Example rule: any ghost may move north from a Red tile into a Hallway tile:

```
(from:Red)-[:GO {toward: "n"}]->(to:Hallway)
```

Example rule: only Attendee ghosts may move from a Hallway into a Stage tile:

```
(from:Hallway)-[:GO {ghostClass: "Attendee"}]->(to:Stage)
```

Example rule: any ghost may pick up an item on an Entrance tile:

```
(tile:Entrance)-[:PICK_UP]->(tile:Entrance)
```

### Rule file format

Rulesets are authored as UTF-8 text files using [Gram notation](https://www.npmjs.com/package/@relateby/pattern), with the `.rules.gram` extension. One relationship per line; blank lines and comments are ignored by the parser.

**Required syntax:** every node in every rule must carry its full label set. Aliases (the identity portion before the colon) are positional descriptors that aid readability but do not substitute for labels. Back-references — an alias appearing without labels after it was defined in another rule — are not supported by the current toolchain and will silently drop the label information.

```
# Correct: full labels on every node
(from:Red)-[:GO]->(to:Blue)
(from:Blue)-[:GO]->(to:Blue)

# Correct: self-loop repeats alias and label on both sides
(tile:Hallway)-[:PICK_UP]->(tile:Hallway)

# Incorrect: back-reference loses labels
(red:Red)-[:GO]->(blue:Blue)
(red)-[:GO]->(red)          # 'red' has no labels here; match fails
```

Common alias conventions: `from`/`to` for directional moves, `tile`/`self` for in-place actions. The alias choice does not affect evaluation — only the labels matter.

### Multi-label nodes

Tile class nodes in the ruleset graph may carry multiple labels, enabling rules
at any level of specificity:

- A tile may be labeled `Blue:Hallway`, `Red:Stage`, or `Green:Entrance:Doorway`.

Rules match by label **intersection (AND semantics)**: a rule node with labels
`Hallway:VIP` requires the tile to carry *both* labels. A rule targeting only
`:Hallway` matches any tile with that label regardless of its other labels.
This allows general rules (any ghost may enter any Hallway tile) to coexist
with specific overrides (only Attendees may enter a `VIP:Lounge` tile,
expressed as a `ghostClass` constraint on that edge) without conflict.

### In-place actions as self-loops

Actions that do not change a ghost's position are represented as self-loops in
the ruleset graph — the origin and destination node are the same tile class node.
Picking up an item, putting one down, or toggling a switch all loop on the
current tile class:

```
(tile:Hallway)-[:PICK_UP]->(tile:Hallway)
(tile:ControlRoom)-[:TOGGLE]->(tile:ControlRoom)
```

The consequence of an in-place action is a mutation to world state — an item
moves from the tile to the ghost's inventory, or a tile property changes value.
That mutation may in turn affect what other actions are available. For example,
a `TOGGLE` that sets `tile.lit = true` on a connected tile enables `LOOK` rules
that carry a condition requiring `tile.lit == true`. The ruleset defines what
is permitted; the world state graph captures what is.

### Rule evaluation model

When a ghost requests an action, the evaluator:

1. Queries the world state graph for local context: current tile, destination
   tile (if applicable), ghost labels, ghost inventory, and any relevant dynamic
   tile properties.
2. Traverses the ruleset graph for edges originating at a node matching the
   current tile's labels, targeting a node matching the destination tile's
   labels (or the same node for in-place actions), with a relationship type
   matching the action, and ghost constraint properties (if any) satisfied by
   the acting ghost.
3. Evaluates conditions on matching relationships against the context.
4. Returns **permitted** (with optional cost) or **denied** (with reason code
   and optional hint).

Rules follow **allow-list semantics**: an action is denied unless at least one
matching rule explicitly permits it. The existing permissive PoC default
(`(tile:Tile)-[:GO]->(tile:Tile)` matching any tile class pair) remains
available as a named ruleset.

### Ghost information model

Ghosts receive no information about the ruleset before attempting an action.
On denial, they receive a machine-readable reason code and a human-readable
description. Whether that description reveals the precise failing condition,
offers a riddle, or says nothing useful is a game-design decision deferred to
world authors. The mechanical contract is: **attempt, receive feedback, reason
from feedback**.

### Relationship to the map

The map supplies geometry and tile metadata (labels, static properties). The
ruleset supplies policy. A rule references tile and ghost labels; it does not
reference specific tiles, map coordinates, or ghost instances. The two graphs
are queryable together but neither owns the other. The map can change without
invalidating the ruleset; the ruleset can be replaced without modifying the map.

### Package ownership

Action evaluation remains in `server/world-api/`. The ruleset graph loader and
evaluator are new additions to the same package. Shared action type definitions
and label conventions belong in `shared/types/`. No changes to
`server/colyseus/`, `client/phaser/`, or ghost-side packages are required by
this RFC for the `GO` action. Non-movement actions (PICK_UP, PUT_DOWN, TOGGLE,
JUMP) referenced in this RFC as illustrative of the general rule mechanism will
require follow-up changes to the ghost MCP interface and shared types before
they can be fully implemented.

### Storage and co-location with world data

`.rules.gram` files are the authoring surface; Neo4j is the target for
production graph storage. Both the world state graph and one or more ruleset
graphs will live in the same database, which creates a label namespace
collision: a `Red` node in the world graph is a tile instance; a `Red` node in
a ruleset graph is a tile-class policy node. A naive `MATCH (n:Red) RETURN n`
returns both.

The persistence layer (the component responsible for loading `.rules.gram`
files into Neo4j) resolves this by adding an extra `:Rule` label to every node
in the ruleset graph at write time. Rule authors do not write `:Rule` in their
`.gram` files. At the macro level, a `RuleSet` node scopes the entire graph:

```
(rs:RuleSet)-[:APPLIES_TO]->(w:World)
(rs:RuleSet)-[:CONTAINS]->(n:Red:Rule)
```

Scoped queries become unambiguous:

```cypher
MATCH (rs:RuleSet)-[:CONTAINS]->(n:Red) RETURN n   -- rule nodes only
MATCH (w:World)-[:CONTAINS]->(n:Red) RETURN n       -- tile instances only
```

Relationship types in the ruleset graph (`GO`, `LOOK`, `PICK_UP`, etc.) are
action verbs and will not collide with world graph relationship types, which
are structural (`ADJACENT`, `OCCUPIED_BY`, `CONTAINS`).

### Demo scenario

With a sample map containing at least two tile classes (e.g. Red and Blue):

1. Author a ruleset with two rules:
   - `(from:Red)-[:GO]->(to:Blue)` — any ghost may move from a Red tile into a Blue tile.
   - `(from:Blue)-[:GO]->(to:Blue)` — any ghost may move between Blue tiles.
   No rule exists for `(from:Blue)-[:GO]->(to:Red)`.
2. Start the server with that ruleset active.
3. Spawn a ghost on a Red tile. Observe via Phaser the ghost can move to an
   adjacent Blue tile.
4. From the Blue tile, observe the ghost can move to another Blue tile.
5. Attempt to move back to the Red tile. Observe the move is denied and the
   ghost remains on the Blue tile.
6. Confirm the denial response includes a machine-readable reason code.

## Open Questions

1. **Ruleset storage format** — ~~resolved~~: `.rules.gram` Gram notation is
   the authoring format (see [Rule file format](#rule-file-format)). The open
   question is now the **Neo4j persistence pipeline**: when and how are
   `.rules.gram` files parsed and written into Neo4j, what triggers a reload,
   and how are `RuleSet` nodes versioned or replaced during a live event.

2. **Jump connections** — non-geometric tile connections (portals, elevators)
   require explicit adjacency data beyond what the map's geometry supplies.
   Where is that connection data authored and loaded? Is it part of the ruleset
   graph, part of the map, or a third artifact?

3. **Ghost inventory** — keyed rules and `PICK_UP`/`PUT_DOWN` require ghosts
   to carry items. The ghost state model does not currently include inventory.
   A follow-up RFC or ADR is needed before item-dependent rules can be
   implemented.

4. **Movement cost** — if `GO` relationships carry cost, what consumes it?
   Ghost agents need a way to receive and accumulate cost information. The
   shape of that interface is unresolved.

5. **Remediation hint specificity** — how much a denial response reveals is a
   game-design decision. This RFC proposes the mechanical hook (a hint property
   on the relationship) but defers content policy to world authors.

6. **Multi-step moves** — a ghost may wish to commit to a path of several
   moves atomically. Whether this is a `GO` variant or a higher-level planning
   tool is deferred.

7. **Ruleset hot-reload** — can the active ruleset change while the server is
   running? Relevant for live events where world physics shift mid-session.

8. **World state mutation contract** — in-place actions (TOGGLE, PICK_UP, etc.)
   mutate world state. The contract for how those mutations are expressed,
   validated, and broadcast to spectators is not yet defined.

## Alternatives

**Embed rules in the map file.** Tiled supports custom properties on tiles and
tile types. Rules could be expressed as properties on tile definitions.
Rejected because it couples world physics to map authoring, prevents ruleset
reuse across maps, and conflates the geometry graph with the policy graph.

**Rules as properties of individual tile nodes.** Each tile class node carries
its own allow/deny lists rather than expressing policy as relationships between
nodes. Rejected because it cannot naturally represent directed transitions,
self-loops for in-place actions, or action-typed relationship properties. The
relationship-centric graph model is a better fit for a state machine where
actions are transitions.

**Hardcode action logic in `world-api`.** Rules are expressed directly as
TypeScript conditionals at evaluation time. This is the current PoC state
(permissive no-op). Rejected for production use because it requires a code
change to modify world physics, cannot be authored by non-engineers, and does
not support runtime or per-event configuration.
