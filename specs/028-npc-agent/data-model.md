# Phase 1 Data Model: NPC Agent

Entities are derived from spec Key Entities + research decisions. Runtime types live in `ghosts/npc-agent/src/`; the on-disk shape is gram (see `contracts/character.gram.md`).

## CharacterDefinition

A validated catalog entry, parsed from one `.character.gram` file.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (slug) | yes | Unique across the catalog; duplicates rejected (FR-014) |
| `name` | string | yes | Display name set as the ghost's `displayName` at spawn |
| `background` | string | yes | Set as the ghost's per-ghost `background` (IC-008); also flavor for logs |
| `enabled` | boolean | yes | `false` → excluded from spawning (FR-003) |
| `defaultAction` | `"idle" \| "random-move" \| "stay"` | yes | Fallback when no rule matches (FR-007); enum-validated |
| `behaviorRules` | `BehaviorRule[]` | yes (may be empty) | Evaluated in array order = priority order |
| `dialogTree` | `DialogTree` | yes | Root node + node map + transitions |

**Validation**: non-empty `id`/`name`/`background`; `defaultAction` ∈ enum; unique `id`; well-formed dialog tree (exactly one `fallback` node; all transition targets resolve). On any failure → log warning, skip entry, continue (FR-014).

## BehaviorRule

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable id for logging |
| `condition` | enum (closed set) | yes | e.g. `inventory_empty`, `crowded`, `item_nearby`, `alone`, `always` — fixed vocabulary (RFC-0026 §2) |
| `action` | enum + params | yes | Maps to an MCP tool call: `seek-item`→`go`/`take`, `avoid-crowd`→`go`, `wander`→`go`, `idle`→noop |
| `priority` | integer | derived | Array index is authoritative; explicit `priority` optional and used only to sort if present |

**State transition (per tick)**: evaluate rules in priority order → first whose `condition` holds executes its `action` → else `defaultAction`.

## DialogTree

| Field | Type | Notes |
|---|---|---|
| `nodes` | `Map<nodeId, DialogNode>` | Built from `(:DialogNode {…})` declarations |
| `rootId` | nodeId | Entry node for a fresh conversation |
| `fallbackId` | nodeId | The single node with `fallback: true` |

## DialogNode

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Defined once with label, referenced by bare id in `[:ON]` edges |
| `triggerConditions` | string[] | yes (unless fallback) | Case-insensitive keyword/substring triggers (FR-010); node fires if any appears in lowercased text |
| `responses` | string[] | yes | ≥1 alternative; one chosen at random (FR-011) |
| `transition` | nodeId? | no | `[:ON]->(next)` edge target; updates per-partner state after responding |
| `fallback` | boolean | no | Exactly one node per tree is the catch-all |

## DialogState (runtime, not persisted)

Per-character, per-partner conversation position.

| Field | Type | Notes |
|---|---|---|
| `currentNodeId` | nodeId | Where the next inbound message from this partner is evaluated (FR-012) |
| `lastUpdated` | timestamp | For optional idle expiry / observability |

**Keying**: `Map<characterGhostId, Map<partnerGhostId, DialogState>>`. Up to `n·k` states for `n` characters × `k` partners (spec Conversation cardinality). Partners are humans or non-NPC agents only — sibling-NPC senders are ignored before any state is created (FR-009).

## NpcAgentCatalog (runtime)

| Member | Type | Notes |
|---|---|---|
| `byId` | `Map<id, CharacterDefinition>` | Lookup |
| `enabled()` | `CharacterDefinition[]` | Filtered list used for roster spawn |

Loaded once at startup from `NPC_CATALOG_DIR`; invalid files skipped with warnings.

## Spawn / identity (additive changes to existing entities)

- **Registry ghost record** (`server/world-api/src/registry-store-model.ts`): + optional `background: string` (IC-008).
- **Adoption payload** (`server/registry/src/routes/adoption.ts`): accept + persist `background`.
- **`SpawnContext.ghostCard`** (`spawn-types.ts` / `server/agent-host/src/types.ts`): + optional `background`; + `characterId` so the executor knows which catalog character a spawned ghost embodies.
- **Roster request** (new): `{ sessionContext, characters: [{ characterId, displayName, background }] }` → host loops `AgentSupervisor.spawn`.

## World event (additive)

- **`world.session.start`** (`aie-matrix.world-event.v1`): payload carries `sessionId` (+ existing event envelope fields `ghostId`, `eventId`, `sentAt`). Emitted by the world server on session begin (IC-007); consumed by the npc-agent coordinator as its roster-spawn trigger.
