# Contract IC-001: `.character.gram` Catalog Format

Authoritative shape for catalog files. Parsed with `@relateby/pattern` ^0.4.2 (`parseWithHeader`). The shipped reference copy lives at `ghosts/npc-agent/schema/character.gram.md`.

## Header (bare record, required)

```gram
{ kind: "matrix-character", id: "<slug>", name: "<display name>",
  background: "<one-line background>", enabled: true, defaultAction: "idle" }
```

| Key | Type | Required | Constraint |
|---|---|---|---|
| `kind` | string | yes | MUST equal `"matrix-character"` |
| `id` | string | yes | unique across catalog |
| `name` | string | yes | non-empty |
| `background` | string | yes | non-empty |
| `enabled` | bool | yes | — |
| `defaultAction` | string | yes | `idle` \| `random-move` \| `stay` |

## Behaviors block (ordered)

```gram
[behaviors:Behaviors |
  (b1:Rule { when: "inventory_empty", do: "seek-item", priority: 1 }),
  (b2:Rule { when: "crowded",        do: "avoid-crowd", priority: 2 })
]
```

- Element order = priority order (explicit `priority` optional, sorts when present).
- `when` ∈ closed condition set: `inventory_empty | crowded | item_nearby | alone | always`.
- `do` ∈ closed action set: `seek-item | avoid-crowd | wander | idle`.

## Dialog nodes + tree

```gram
(greet:DialogNode { trigger: ["hello","hi"], responses: ["Welcome!","Hi there!"] })
(directions:DialogNode { trigger: ["where","map"], responses: ["Hall A is north."] })
(bye:DialogNode { trigger: ["bye"], responses: ["Safe travels!"] })
(default:DialogNode { responses: ["Hmm?"], fallback: true })

[dialog:DialogTree |
  (greet)-[:ON]->(directions),
  (directions)-[:ON]->(bye)
]
```

- `trigger`: string array; **case-insensitive substring** match (node fires if any appears in lowercased inbound text).
- `responses`: ≥1 string; one chosen at random per reply.
- `[:ON]->` edge sets the post-response transition for that node.
- Exactly one node MUST have `fallback: true` (catch-all; needs no `trigger`).

## Validation (loader behavior — FR-014)

Per file, in order: header `kind` check → required fields present → `defaultAction` enum → unique `id` (dedupe across catalog) → dialog tree well-formed (exactly one fallback; all `[:ON]` targets resolve to a declared node). **Any failure → log a warning, skip the file, continue.** A malformed file MUST NOT abort catalog load.
