# IC-001: `.character.gram` Catalog Format

Authoritative reference for NPC character catalog files. Parsed by `src/catalog/parse-character-gram.ts` using `@relateby/pattern` ^0.4.2 `Gram.parseWithHeader`.

## File header (required)

```gram
{ kind: "matrix-character" }
```

The header record contains only `kind`. All character identity fields live on a named `Character` node so that multiple character files can be concatenated into a single world gram without ambiguity.

## Character node (required)

```gram
(charId:Character { id: "<slug>", name: "<display name>",
  background: "<one-line background>", enabled: true, defaultAction: "idle" })
```

| Key | Type | Required | Constraint |
|---|---|---|---|
| `id` | string | yes | Unique slug across the catalog; duplicate is skipped with a warning |
| `name` | string | yes | Non-empty; used as ghost `displayName` at spawn |
| `background` | string | yes | Non-empty; set as IC-008 per-ghost background |
| `enabled` | bool | yes | `false` → excluded from roster spawn |
| `defaultAction` | string | yes | `idle` \| `random-move` \| `stay` |

The node label (e.g. `charId`) is the gram identity used in wiring relationships below.

## Dialog tree (required)

### DialogNode

```gram
(idle:DialogNode    { responses: ["How can I help?", "Ask me anything."] })
(directions:DialogNode { responses: ["Hall A is north."] })
```

- `responses`: ≥1 string; one chosen at random when the NPC **transitions INTO** this node.
- No `trigger` or `fallback` fields — all triggers live on edges.

### DialogTree block

```gram
[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["where","hall","map"] }]->(directions),
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (directions)-[:DialogTrigger { triggers: [] }]->(idle)
]
```

- Each `[:DialogTrigger]` edge carries a `triggers` string array.
- **Specific triggers** (`triggers` non-empty): case-insensitive substring match; first match per outgoing edge wins.
- **Wildcard edge** (`triggers: []`): matches any input not matched by a specific edge from the same node. Every node **must** have exactly one outgoing wildcard edge.
- **Evaluation order**: specific edges first (in declaration order), wildcard last.
- The response spoken is the **target node's** `responses`, not the source node's.

### The idle state and its self-loop

The idle state is the root of every dialog tree. It must have an explicit **wildcard self-loop**:

```gram
(idle)-[:DialogTrigger { triggers: [] }]->(idle)
```

This is how the parser identifies the root node — it is the node whose wildcard edge points to itself. **Authors must include this self-loop explicitly.** Omitting it is a validation error.

All other nodes should return to idle via a wildcard edge when the player's message doesn't match any specific trigger from that state.

### Wiring the character to its dialog tree

```gram
(charId)-[:HAS_DIALOG]->(dialog_1)
```

One `HAS_DIALOG` relationship per character is required. The target must be a declared `DialogTree` block in the same file.

## Behaviors block (optional)

```gram
[behavior_1:Behaviors |
  (b1:Rule { when: "inventory_empty", do: "seek-item",   priority: 1 }),
  (b2:Rule { when: "crowded",         do: "avoid-crowd", priority: 2 }),
  (b3:Rule { when: "always",          do: "idle",        priority: 3 })
]
```

- Element order = priority order unless explicit `priority` values are given.
- `when` ∈ `inventory_empty | crowded | item_nearby | alone | always`.
- `do` ∈ `seek-item | avoid-crowd | wander | idle`.
- Missing or invalid rules are silently skipped at parse time.

### Wiring the character to its behaviors

```gram
(charId)-[:EXHIBITS_BEHAVIOR]->(behavior_1)
```

Optional. If omitted, the character has no behavior rules and uses `defaultAction` on every tick.

## Validation (loader behavior)

Per file, in order:

1. Header `kind` check
2. `Character` node present with all required fields
3. `defaultAction` enum membership
4. `HAS_DIALOG` relationship resolves to a declared `DialogTree` block
5. All `DialogNode` ids referenced in the tree are declared
6. Tree has exactly one wildcard self-loop (the idle/root node)
7. If `EXHIBITS_BEHAVIOR` present: target block exists
8. Unique `id` across the catalog (checked by `catalog-loader`, not the parser)

**Any failure → log a warning, skip the file, continue loading.**

## Complete example

```gram
{ kind: "matrix-character" }

(charAttendant:Character { id: "info-attendant", name: "Info Attendant",
  background: "A friendly conference guide.", enabled: true, defaultAction: "idle" })

(idle:DialogNode       { responses: ["How can I help? Ask about directions or sessions."] })
(directions:DialogNode { responses: ["Hall A is north, Hall B is south."] })
(schedule:DialogNode   { responses: ["Keynote starts at 9am on the main stage."] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["where","hall","map"] }]->(directions),
  (idle)-[:DialogTrigger { triggers: ["schedule","when","session"] }]->(schedule),
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (directions)-[:DialogTrigger { triggers: [] }]->(idle),
  (schedule)-[:DialogTrigger { triggers: [] }]->(idle)
]

[behavior_1:Behaviors |
  (b1:Rule { when: "crowded", do: "avoid-crowd", priority: 1 }),
  (b2:Rule { when: "always",  do: "idle",        priority: 2 })
]

(charAttendant)-[:HAS_DIALOG]->(dialog_1)
(charAttendant)-[:EXHIBITS_BEHAVIOR]->(behavior_1)
```
