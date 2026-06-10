# IC-001: `.character.gram` Catalog Format

Authoritative reference for NPC character catalog files. Parsed by `src/catalog/parse-character-gram.ts` using `@relateby/pattern` ^0.4.2 `Gram.parseWithHeader`.

## Header (required, bare record)

```gram
{ kind: "matrix-character", id: "<slug>", name: "<display name>",
  background: "<one-line background>", enabled: true, defaultAction: "idle" }
```

| Key | Type | Required | Constraint |
|---|---|---|---|
| `kind` | string | yes | MUST equal `"matrix-character"` |
| `id` | string | yes | Unique slug across the catalog; duplicates skipped with a warning |
| `name` | string | yes | Non-empty; used as ghost `displayName` at spawn |
| `background` | string | yes | Non-empty; set as IC-008 per-ghost background |
| `enabled` | bool | yes | `false` → excluded from roster spawn |
| `defaultAction` | string | yes | `idle` \| `random-move` \| `stay` |

## Behaviors block (optional, ordered)

```gram
[behaviors:Behaviors |
  (b1:Rule { when: "inventory_empty", do: "seek-item",   priority: 1 }),
  (b2:Rule { when: "crowded",         do: "avoid-crowd", priority: 2 }),
  (b3:Rule { when: "always",          do: "idle",        priority: 3 })
]
```

- Element order = priority order unless explicit `priority` values are given.
- `when` ∈ `inventory_empty | crowded | item_nearby | alone | always`.
- `do` ∈ `seek-item | avoid-crowd | wander | idle`.
- Missing or invalid rules are silently skipped at parse time.

## Dialog nodes

```gram
(greet:DialogNode { trigger: ["hello","hi"], responses: ["Welcome!", "Hi there!"] })
(directions:DialogNode { trigger: ["where","map"], responses: ["Hall A is north."] })
(fallback:DialogNode { responses: ["Hmm?"], fallback: true })
```

- `trigger`: string array; case-insensitive substring match (node fires if any appears in lowercased inbound text). Required on non-fallback nodes.
- `responses`: ≥1 string; one chosen at random per reply.
- `fallback: true`: exactly one node per tree is the catch-all (required).

## Dialog tree (transitions)

```gram
[dialog:DialogTree |
  (greet)-[:ON]->(directions),
  (directions)-[:ON]->(greet)
]
```

- `[:ON]->` edges define post-response transitions; optional per node.
- Exactly one node MUST have `fallback: true`.
- All transition targets MUST resolve to a declared `DialogNode`.

## Validation (loader behavior)

Per file, in order:
1. Header `kind` check
2. Required fields present and non-empty
3. `defaultAction` enum membership
4. Unique `id` across the catalog
5. Dialog tree well-formed (exactly one fallback; all `[:ON]` targets resolve)

**Any failure → log a warning, skip the file, continue loading.** A malformed file MUST NOT abort catalog load.

## Example: complete character file

```gram
{ kind: "matrix-character", id: "info-attendant", name: "Info Attendant",
  background: "A friendly conference guide.", enabled: true, defaultAction: "idle" }

(greet:DialogNode { trigger: ["hello","hi"], responses: ["Welcome! How can I help?"] })
(directions:DialogNode { trigger: ["where","map"], responses: ["Hall A is north."] })
(fallback:DialogNode { responses: ["Try asking about directions!"], fallback: true })

[dialog:DialogTree |
  (greet)-[:ON]->(directions)
]

[behaviors:Behaviors |
  (b1:Rule { when: "crowded", do: "avoid-crowd", priority: 1 }),
  (b2:Rule { when: "always",  do: "idle",        priority: 2 })
]
```
