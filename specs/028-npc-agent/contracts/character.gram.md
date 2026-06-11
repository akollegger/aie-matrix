# Contract IC-001: `.character.gram` Catalog Format

Authoritative shape for catalog files. Parsed with `@relateby/pattern` ^0.4.2 (`parseWithHeader`). The shipped reference copy lives at `ghosts/npc-agent/schema/character.gram.md`.

## Header (bare record, required)

```gram
{ kind: "matrix-character" }
```

The header contains only `kind`. All character fields live on a named `Character` node so that multiple files can be concatenated into a single world gram without ambiguity.

## Character node (required)

```gram
(charId:Character { id: "<slug>", name: "<display name>",
  background: "<one-line background>", enabled: true, defaultAction: "idle" })
```

| Key | Type | Required | Constraint |
|---|---|---|---|
| `kind` | string | yes (header) | MUST equal `"matrix-character"` |
| `id` | string | yes | unique across catalog |
| `name` | string | yes | non-empty |
| `background` | string | yes | non-empty |
| `enabled` | bool | yes | `false` → excluded from roster spawn |
| `defaultAction` | string | yes | `idle` \| `go-random` (legacy aliases: `stay`, `random-move`) |

## Behaviors block (optional)

Rules are evaluated in **declaration order** — first match wins, no `priority` field.

```gram
[behavior_1:Behaviors |
  (b1:Rule { when: "item_here",     do: "take"                        }),
  (b2:Rule { when: "item_adjacent", do: "go",   toward: "nearest_item" }),
  (b3:Rule { when: "crowded",       do: "go",   toward: "random"       }),
  (b4:Rule { when: "always",        do: "idle"                         })
]
```

**Conditions** (`when`) — closed set: `inventory_empty | item_here | item_adjacent | item_nearby | crowded | alone | always`

**Actions** (`do` is the type discriminant):

| `do` | Additional params | Effect |
|---|---|---|
| `go` | `toward: "random" \| "nearest_item" \| n\|s\|ne\|nw\|se\|sw` | Move toward exit |
| `take` | _(none; picks first item on current tile)_ | Take nearest item here |
| `traverse` | `via: "<portal-id>"` | Use a named portal |
| `idle` | _(none)_ | No-op |

Missing or invalid rules are silently skipped at parse time.

## Dialog nodes + tree (required)

```gram
(idle:DialogNode       { responses: ["How can I help?", "Ask me anything."] })
(directions:DialogNode { responses: ["Hall A is north."] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["where","hall","map"] }]->(directions),
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (directions)-[:DialogTrigger { triggers: [] }]->(idle)
]
```

- `responses`: ≥1 string; one chosen at random when the NPC transitions INTO this node.
- `triggers`: string array on `[:DialogTrigger]` edges; case-insensitive substring match. Empty array = wildcard edge (matches any input not matched by a specific edge from the same node).
- Every node MUST have exactly one outgoing wildcard edge.
- The idle/root node is identified by its explicit **wildcard self-loop** (`(idle)-[:DialogTrigger { triggers: [] }]->(idle)`). Omitting it is a validation error.

## Wiring relationships (required)

```gram
(charId)-[:HAS_DIALOG]->(dialog_1)
(charId)-[:EXHIBITS_BEHAVIOR]->(behavior_1)   # optional
```

`HAS_DIALOG` is required. `EXHIBITS_BEHAVIOR` is optional; omitting it gives the character no behavior rules (uses `defaultAction` every tick).

## Validation (loader behavior — FR-014)

Per file, in order:
1. Header `kind` check
2. `Character` node present with all required fields
3. `defaultAction` value recognized
4. `HAS_DIALOG` resolves to a declared `DialogTree` block
5. All `DialogNode` ids referenced in the tree are declared
6. Tree has exactly one wildcard self-loop (the idle/root node)
7. If `EXHIBITS_BEHAVIOR` present: target block exists
8. Unique `id` across the catalog (checked by the loader, not the parser)

**Any failure → log a warning, skip the file, continue.** A malformed file MUST NOT abort catalog load.
