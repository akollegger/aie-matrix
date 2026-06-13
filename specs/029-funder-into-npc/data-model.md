# Data Model: Migrate funder-agent into npc-agent

**Feature**: 029-funder-into-npc  
**Date**: 2026-06-13

## Modified Entities

### CharacterDefinition (extended)

Defined in `ghosts/npc-agent/src/types.ts`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | Yes | Unique character id, e.g. `"funder"` |
| `name` | `string` | Yes | Display name |
| `background` | `string` | Yes | Character description used in ghost registration |
| `enabled` | `boolean` | Yes | Whether to include in roster spawn |
| `defaultAction` | `WorldAction` | Yes | Fallback when no behavior rule fires |
| `behaviorRules` | `BehaviorRule[]` | Yes | Rule-engine rules (empty array for funder) |
| `dialogTree` | `DialogTree` | Yes | Dialog FSM (stub tree for funder) |
| `behaviorKind` | `"rule-engine" \| "funder"` | **NEW** | Dispatch discriminator; defaults to `"rule-engine"` when absent in gram file |

**Backward compatibility**: `behaviorKind` is optional in the gram format and inferred as `"rule-engine"` for all existing characters. No changes needed to `collector.character.gram`, `hermit.character.gram`, or `info-attendant.character.gram`.

---

## New Entities (runtime, in-memory only)

### FunderState

Per-ghost state machine. Lives in `ghosts/npc-agent/src/behavior/funder-behavior.ts` as a module-level `Map<ghostId, FunderState>`.

```
FunderState =
  | { phase: "idle" }
  | { phase: "awaiting_submission"
      contractId: string
      contractorId: string
      question: string }
```

**Lifecycle**: Initialized to `{ phase: "idle" }` on first tick. Cleared via `clearFunderState(ghostId)` when a ghost is re-spawned.

---

### Supporting maps (module-level in `funder-behavior.ts`)

| Map | Key | Value | Purpose |
|---|---|---|---|
| `ghostState` | `ghostId` | `FunderState` | Per-ghost state machine |
| `contractToFunder` | `contractId` | `ghostId` | Reverse-lookup for `world.contract.submitted` routing |
| `openContractCount` | `ghostId` | `number` | Enforces `MAX_OPEN = 5` cap |

---

## Gram Catalog Entry

### funder.character.gram

Minimal stub dialog tree satisfies the parser's `HAS_DIALOG` invariant. Behavior block is empty (no rule-engine rules needed).

```
{ kind: "matrix-character" }

(charFunder:Character {
  id: "funder",
  name: "The Funder",
  background: "...",
  enabled: true,
  defaultAction: "go-random",
  behaviorKind: "funder"
})

(idle:DialogNode { responses: ["Hello."] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: [] }]->(idle)
]

(charFunder)-[:HAS_DIALOG]->(dialog_1)
```

No `EXHIBITS_BEHAVIOR` block needed (behavior rules are empty for funder; all behavior is driven by `funderTick`).
