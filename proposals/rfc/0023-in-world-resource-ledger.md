# RFC-0023: In-World Resource Ledger

**Status:** draft  
**Date:** 2026-05-31  
**Authors:** @akollegger  
**Related:** RFC-0006 (World Items — discrete carriable objects, a complementary but separate system), RFC-0018 (RDC Skill Tiers — sketches a per-ghost `rdc-ledger`; this RFC supersedes that sketch with a general implementation), RFC-0022 (Group Exam Eval Protocol — depends on this RFC for token budgets and jackpot distribution)

---

## Summary

Introduce a general-purpose in-world resource ledger that tracks named, fungible resource balances per ghost. Resources are typed quantities — integers or bounded decimals — that can be credited, debited, drained on a schedule, and transferred atomically across multiple ghosts in a single operation. The ledger is the authoritative layer for all "how much does this ghost have of X" questions, covering exam token budgets, conference currency, raffle tickets, skill experience points, and any other quantifiable resource a mechanic requires — without the mechanics needing to own their own storage.

---

## Motivation

Several existing and planned mechanics need to track per-ghost quantities:

- **Exam eval (RFC-0022)** — token budgets that drain over time and are replenished by jackpot distributions across a group.
- **RDC skill tiers (RFC-0018)** — `handsPlayed` counter and skill tier, sketched as a bespoke `rdc-ledger` package but never specified as a shared primitive.
- **Leaderboard points** — per-class metrics (steps taken, sessions attended, cards exchanged, quests completed) mentioned in `docs/project-overview.md § Game Mechanics`.
- **Conference currency** — raffle entries, vendor quest rewards, and collectible prizes imply some notion of earnable, spendable value.
- **Future mechanics** — bounty hunting (RFC-0016), platform links (RFC-0020), and any vendor-contributed quest can plausibly need to credit or check a ghost's balance of something.

Without a shared ledger, each mechanic invents its own storage (a Neo4j property here, an in-memory map there) with no consistent API, no atomicity guarantees across mechanics, and no unified observability surface. The ledger solves this once.

The ledger is explicitly **not** an item system. RFC-0006 covers discrete, named world objects that occupy space, can be carried, and are picked up or dropped. The ledger covers fungible quantities — amounts that add and subtract, not things that sit on tiles or move between inventories.

---

## Design

### 1. Resource Types

A **resource type** is a named, system-wide definition. Types are registered at world-build time (config file or admin API) and are immutable once ghosts hold balances.

```ts
interface ResourceType {
  id: string            // e.g. "exam-token", "raffle-ticket", "hands-played"
  label: string         // display name, e.g. "Exam Token"
  unit: "integer" | "decimal"
  min: number           // floor, typically 0
  max: number | null    // ceiling, null = unbounded
  visibility: "self" | "group" | "public"
                        // who can read another ghost's balance
  decayable: boolean    // whether scheduled drain is permitted for this type
}
```

Initial resource types for AIEWF 2026:

| ID | Label | Unit | Min | Max | Visibility | Decayable |
|---|---|---|---|---|---|---|
| `exam-token` | Exam Token | integer | 0 | null | group | yes |
| `raffle-ticket` | Raffle Ticket | integer | 0 | null | public | no |
| `xp` | Experience | integer | 0 | null | public | no |
| `hands-played` | Hands Played | integer | 0 | null | public | no |

Additional types can be registered by vendor-contributed mechanics. The type registry is the only point of coupling between the ledger and game content.

### 2. Balance Model

Each ghost has at most one balance record per resource type. A balance record is created on first credit; it does not exist until then (no "zero balance for everyone" pre-seeding).

```
(:Ghost)-[:HAS_BALANCE { amount: Int, resourceTypeId: String }]->(:ResourceBalance)
```

Or equivalently as a property map on the relationship if Neo4j traversal performance favors it. The storage shape is an implementation detail; the invariants are:

- `amount >= resourceType.min` always
- `amount <= resourceType.max` if max is non-null
- Balance mutations are serialized per ghost per resource type (no lost updates)

### 3. Operations

The ledger exposes five operations. All are performed by the ledger service, never directly against Neo4j by callers.

#### `credit(ghostId, resourceTypeId, amount)`

Add `amount` to the ghost's balance. Creates the balance record if absent. Clamps to `max` if the type has one. Returns the new balance.

#### `debit(ghostId, resourceTypeId, amount)`

Subtract `amount` from the ghost's balance. Fails with `INSUFFICIENT_BALANCE` if `balance - amount < min`. Returns the new balance.

#### `transfer(fromGhostId, toGhostId, resourceTypeId, amount)`

Atomic debit from one ghost, credit to another. Fails atomically — if the debit would violate the floor, neither side changes. Useful for peer-to-peer exchanges (e.g. paying for a quest hint).

#### `distribute(ghostIds[], resourceTypeId, totalAmount)`

Atomic multi-ghost credit: divide `totalAmount` equally across all listed ghost IDs, crediting each ghost `floor(totalAmount / n)`. Any remainder (from integer division) is credited to the first ghost in the list. This is the jackpot operation RFC-0022 depends on. All credits succeed or none do.

#### `balance(ghostId, resourceTypeId)`

Read a ghost's current balance. Returns 0 if no balance record exists (never-credited ghost). Subject to `visibility` rules — callers without permission receive `VISIBILITY_DENIED`.

### 4. Scheduled Drain

For `decayable` resource types, the ledger supports a recurring drain: a periodic debit applied automatically by a background fiber.

```ts
interface DrainSchedule {
  ghostId: string
  resourceTypeId: string
  amountPerTick: number
  intervalMs: number
  // when balance reaches min, drain stops automatically and fires a domain event
}
```

Drain schedules are registered and cancelled via the ledger API:

- `scheduleDrain(ghostId, resourceTypeId, amountPerTick, intervalMs)` — idempotent; re-registering replaces the existing schedule for that ghost+type.
- `cancelDrain(ghostId, resourceTypeId)` — stops the scheduled drain.

When a drain tick would reduce the balance below `min`, it clamps to `min` and fires a `ledger.balance-floored` domain event (ghostId, resourceTypeId, finalBalance). Callers (e.g. the exam engine) subscribe to this event to detect dormancy transitions.

Drain is implemented as a scheduled Effect fiber in `server/world-api`, one fiber per active schedule, scoped to the ghost's session lifetime.

### 5. Domain Events

The ledger emits structured domain events for every mutation, consumed by Colyseus (for spectator broadcast) and the telemetry pipeline:

| Event | Payload |
|---|---|
| `ledger.credited` | ghostId, resourceTypeId, delta, newBalance |
| `ledger.debited` | ghostId, resourceTypeId, delta, newBalance |
| `ledger.transferred` | fromGhostId, toGhostId, resourceTypeId, amount |
| `ledger.distributed` | ghostIds[], resourceTypeId, totalAmount, amountEach |
| `ledger.balance-floored` | ghostId, resourceTypeId, finalBalance |
| `ledger.drain-scheduled` | ghostId, resourceTypeId, amountPerTick, intervalMs |
| `ledger.drain-cancelled` | ghostId, resourceTypeId |

Events are emitted on the Effect `PubSub` layer (consistent with the existing `transcript` broadcast pattern).

### 6. Visibility and Ghost MCP Surface

Ghosts can query their own balances via a new MCP tool:

```
ledger.balance { resourceTypeId: "exam-token" }
→ { ok: true, amount: 450 }
```

For `public` resources, ghosts can query another ghost's balance:

```
ledger.balance { ghostId: "ghost-42", resourceTypeId: "raffle-ticket" }
→ { ok: true, amount: 3 }
```

For `group` and `self` visibility types, the query is denied if the requesting ghost is not in the same group or is not the ghost itself.

Ghosts cannot directly call `credit`, `debit`, `distribute`, or `scheduleDrain` — those are server-side operations invoked by game mechanics (exam engine, quest engine, etc.), not by ghost agents.

### 7. Relationship to RFC-0006 World Items

Items (RFC-0006) are discrete, named objects that occupy tiles and ghost inventories. The ledger tracks fungible quantities. The two systems are complementary and do not overlap:

- A `Brass Key` is a world item — it exists somewhere specific, has identity, and is picked up as a whole.
- `exam-token: 450` is a ledger balance — it has no location, no identity, and changes by arithmetic.

Quest mechanics may bridge both: completing a quest (returning a world item to a location) triggers a ledger credit as a reward. That bridge is in the quest engine, not in either primitive.

### 8. Relationship to RFC-0018 RDC Ledger

RFC-0018 sketches a bespoke `rdc-ledger` package with `handsPlayed + skillTier per ghostId`. This RFC provides the general foundation; the RDC mechanic would use:

- `hands-played` resource type (integer, unbounded, public) — `credit` by 1 per hand completion.
- Tier promotion is computed client-side from the `hands-played` balance against the threshold table in RFC-0018. The tier itself can be stored as a derived view in Neo4j or computed on read — it is not a ledger resource because it is not independently additive.

The bespoke `rdc-ledger` package described in RFC-0018 should not be built; this ledger serves that need.

### 9. Package Ownership

| Package | Responsibility |
|---|---|
| `server/world-api/src/LedgerService.ts` | Core ledger: balance model, operations, drain scheduler fibers |
| `server/world-api/src/errors.ts` | New tagged errors: `InsufficientBalance`, `VisibilityDenied`, `UnknownResourceType` |
| `server/world-api/src/mcp-server.ts` | New `ledger.balance` MCP tool |
| `shared/types/` | `ResourceType`, `BalanceResult`, `LedgerEvent` types |
| `server/colyseus/` | Subscribes to ledger domain events; broadcasts balance changes for spectator-visible resource types |

---

## Open Questions

1. **Resource type registration.** Should resource types be declared in a config file (static, loaded at startup), an admin API (dynamic, requires a running server), or both? Config-file registration is simpler and auditable; API registration enables vendor-contributed mechanics to register their own types without a server restart.

2. **Drain fiber reliability.** Effect fibers are in-process and lost on server restart. For the exam use case, a server restart during an active exam session would zero out all drain schedules. Options: persist active drain schedules to Neo4j and reload them on startup; accept restarts as resetting drain state (requires the exam engine to re-register drains on reconnect); use a Redis TTL as the drain clock instead of an in-process fiber. Which reliability level is required for AIEWF 2026?

3. **Integer vs. decimal resource types.** The current design supports both, but the implementation complexity of `decimal` (precision, rounding rules for `distribute`) may not be worth it for v1. Should `decimal` be deferred and only `integer` implemented initially?

4. **Visibility enforcement granularity.** The three visibility levels (`self`, `group`, `public`) cover obvious cases. Is there a need for `friends` (visible to ghosts you've exchanged cards with) or `team` (visible to members of any shared group, not just exam groups)?

5. **Ledger history and audit trail.** Should every balance mutation be logged to an append-only event log (useful for post-conference analysis and dispute resolution), or is the current balance sufficient? If logged, is the JSONL-on-disk pattern (consistent with conversation threads) adequate, or does this belong in the time-series backend (open question in `docs/architecture.md`)?

6. **Negative balances.** `min: 0` is the default, but some mechanics (debt, deficit scoring) may want to permit negative balances. Should the `min` floor be per-type only, or should individual ghost balance records be able to override the floor?

7. **Cross-mechanic resource spending.** If two mechanics both debit the same resource type simultaneously (e.g., exam drain fires at the same moment a quest engine charges a fee), how is contention handled? Neo4j write locks per balance node are likely sufficient, but worth stating explicitly.

---

## Alternatives

**Per-mechanic storage (status quo).** Each mechanic stores its own resource balances as Neo4j properties or in-memory maps. Simplest to implement incrementally but produces n independent storage shapes, no shared observability, and no atomicity across mechanics. Rejected because it does not scale past two or three mechanics.

**World items as fungible resources.** Represent tokens, tickets, and XP as carriable items (RFC-0006) with high multiplicity. Rejected because fungible quantities have different semantics (arithmetic, no location, no tile capacity) than discrete objects. Conflating them would break both systems.

**External ledger service.** Use a third-party ledger or accounting service (e.g., a payments API, a blockchain). Rejected for AIEWF 2026 on operational complexity grounds. The ledger described here is simple enough to own in-process.
