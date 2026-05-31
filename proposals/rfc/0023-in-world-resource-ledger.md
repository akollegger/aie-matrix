# RFC-0023: In-World Resource Ledger

**Status:** draft  
**Date:** 2026-05-31  
**Authors:** @akollegger  
**Related:** RFC-0002 (Rule-Based Movement — costs attach to `:GO` rules), RFC-0006 (World Items — discrete carriable objects, unified into the ledger as quantity-1 conserved resources), RFC-0018 (RDC Skill Tiers — sketches a bespoke `rdc-ledger`; this RFC supersedes that sketch), RFC-0021 (World Calendar — scheduled transfers ride the calendar), RFC-0022 (Group Exam Eval Protocol — depends on this RFC for token budgets and jackpot distribution)

---

## Summary

Introduce an in-world resource ledger: an append-only, hash-chained, double-entry transaction log that records every movement of every resource between actor-owned "bags," scoped to a single map session. All resources begin in the world bag, seeded by the map definition. Two resource classes are supported: **conserved** resources move between bags and are never silently created or destroyed; **monotonic** resources (XP, badges, certificates) are explicitly minted by authorized mechanics and only accumulate. The ledger is the authoritative source of truth; per-actor bags are materialized caches that can always be rebuilt and validated against the log. This one primitive backs item ownership, action costs, currency, exam token budgets, jackpots, and accumulating rewards like XP and badges.

---

## Motivation

Many existing and planned mechanics need to track per-actor quantities and ownership:

- **World items (RFC-0006)** — discrete objects placed, picked up, carried, and exchanged. Currently modeled as ad-hoc `HAS_OBJECT`/`CARRIES` relationships with in-memory state and deferred persistence.
- **Action costs** — "any ghost action may have an associated cost" in time, energy, currency, or another limited resource. There is no system for this today.
- **Exam eval (RFC-0022)** — token budgets that drain over time and replenish via jackpot distributions across a group.
- **RDC skill tiers (RFC-0018)** — a `handsPlayed` counter, sketched as a bespoke `rdc-ledger` never specified as a shared primitive.
- **Leaderboard points, currency, raffle tickets** — earnable, spendable, or accumulating quantities mentioned across `docs/project-overview.md`.
- **Future earned credentials** — badges and certificates that can only accumulate and can never be traded away.

Without a shared ledger, each mechanic invents its own storage with no consistent API, no atomicity across mechanics, no durability guarantee, and no unified observability. A single double-entry ledger solves this once, and as a bonus its append-only log *is* the time-series event backend that `docs/architecture.md` lists as an open question.

---

## Design

### 1. Core Model: Bags, Resources, Transactions

**Actors and bags.** Every identifiable entity that can hold resources is an **actor**, and every actor has exactly one **bag**. The **world** is an actor; ghosts are actors; NPCs are actors. (Future *animate objects* — chests, dispensers — will be actors too, with their own bags and interaction commands; the ledger needs no change to accommodate them.)

Tiles are **not** actors and own nothing. An item resting on a tile is owned by the **world**; its tile location is an *attribute of the holding*, not a claim by the tile. Picking it up transfers ownership `world → ghost` and clears the location; dropping it transfers `ghost → world` and sets a new location.

**Resources** are named, typed quantities tracked in bags. Two classes:

| Class | Semantics | Examples |
|---|---|---|
| **Conserved** | Total supply is fixed at seed time. Resources only *move* between bags; never minted or destroyed. A bag cannot go negative because you cannot transfer what you do not hold. | gold, energy, exam-token, raffle-ticket, world items (quantity-1) |
| **Monotonic** | Minted by authorized mechanics, never moved or destroyed. Accumulate only. Cannot be traded away. | xp, hands-played, badges, certificates |

The conservation invariant applies only to conserved resources: `Σ(all bags' holdings of a conserved resource) == seeded total`, for all time. This makes scarcity real and designed — how much exam-token exists in the world is a deliberate lever, not an accident.

**Transactions.** The ledger's only write is `append(transaction)`. A transaction is an atomic, ordered set of **movements**, each a double-entry transfer. The shape below is illustrative; field names and types are not normative **except** the chain fields (`prevHash` / `hash`) and `id` as the idempotency key, which the verifiability contract depends on:

```ts
interface Movement {
  resource: string        // resource type id
  qty: number             // integer
  from: string            // source bag (actor id); for monotonic mint, a designated source
  to: string              // destination bag (actor id)
  location?: Location     // optional: set when an item movement establishes a world location
}

interface Transaction {
  id: string              // ULID; also the idempotency key
  movements: Movement[]   // all-or-nothing
  cause: string           // what authored this (e.g. "go", "exam.jackpot", "trade")
  actors: string[]        // actors whose consent this transaction carries
  ts: number              // server timestamp
  prevHash: string        // hash of the previous transaction (chain link)
  hash: string            // hash(this transaction body + prevHash)
}
```

Every conserved movement balances (`from` loses exactly what `to` gains). A monotonic mint is represented as a movement whose `from` is the resource's authorized source actor (e.g. the world acting as an XP issuer); it is logged identically but exempt from the conservation check.

There is no `credit`, `debit`, `distribute`, `transfer`, or `drain` as distinct operations — they are all **transactions of one or more movements**:

- *reward* — one movement, `world → ghost`
- *cost* — one movement, `ghost → payee` (payee defaults to `world`)
- *trade* — two movements, committed atomically, carrying both actors' consent
- *jackpot* — N movements from a coin-holding actor to each recipient (see "Jackpots" below)
- *scheduled drain* — a recurring transaction, `ghost → world`, fired by the calendar (§6)

**Jackpots are a promise of exchange, not a bag.** A jackpot is not a standing pool; it is a coin-holding actor (an NPC bank, or the world) plus a deferred, event-triggered transaction that distributes to recipients. The transaction draws from that actor's bag and therefore cannot pay out more than the actor holds — conservation stays honest. (RFC-0022's "prize pool" is modeled this way: a coin-holding actor plus an event-triggered N-movement transaction, not a standing bag.)

### 2. The Log, the Chain, and Bags-as-Caches

The ledger is an **append-only log** of transactions, the single source of truth. It is **hash-chained**: each transaction embeds the hash of its predecessor, so any tampering with historical entries is detectable by re-walking the chain. (A merkle structure — enabling light verifiers to prove a single bag's balance without replaying the whole log — is a deliberate future extension; the transaction shape leaves room for it.)

**Bags are materialized caches**, not the source of truth. A bag's contents are the fold of all movements touching that actor. Any bag can be rebuilt by replaying the log, and any cached bag can be *validated* against the log on demand. This is the CQRS read-model pattern: the log is the write model; bags are the read model.

**Single writer.** An append-only chain requires exactly one serialization point per session. The world-api process that owns the session (`LIVE_SESSION_ID`) is the sole ledger writer. This is mandatory, not advisory — it constrains the multi-replica deployment story for a session to a single ledger authority.

**Durability.** The log is persisted (durable across restarts); bags are rebuilt from it on startup. **Snapshots** (periodic bag checkpoints + log-tail replay, to bound recovery time) are noted as necessary at scale but are **not required for MVP** — MVP replays from genesis.

**Persistence (candidate).** The append-only log persists to Neo4j as an ordered chain of `(:LedgerEntry)` nodes within the session subgraph, consistent with the decided world model and with RFC-0021 (World Calendar), which already persists to Neo4j and `.calendar.gram`. This RFC proposes the ledger log as the resolution to the open *Time-Series / Event Log Backend* question in `docs/architecture.md`. Whether Neo4j suffices at conference scale or a dedicated append store (JSONL-to-S3, ClickHouse, or similar) is needed is Open Question 9.

### 3. Scope: One Ledger per Session

There is no "conference" concept in the game. The model is **map** (static definition) + **session** (an instance of playing a map). The ledger is scoped to a **single session**: one world bag, one chain, one writer, seeded from that session's map definition.

For AIEWF 2026, the Moscone West map runs as a single long-lived session spanning the fair's dates, so all resources — including accumulating ones like badges and XP — simply live in that session's ledger for its duration. Cross-session carryover (a ghost replaying a different map) is out of scope.

### 4. Action Costs as Rule Properties

"Any action may have a cost." Today, **movement is the only rule-checked action**: a `go` is permitted iff the ruleset graph (RFC-0002) contains a matching `(fromClass)-[:GO]->(toClass)` edge. Costs attach to that rule edge.

```
(red)-[:GO { cost: [ { qty: 5, resource: "gold", payee: "world" },
                     { qty: 10, resource: "energy", payee: "world" } ] }]->(blue)
```

- **Costs are a list** — a move may cost several resources at once.
- **Each cost has a payee** — double-entry requires a destination. A toll names a gatekeeper NPC; ambient cost defaults to `payee: "world"`.
- **"Can't afford" is a denial reason** — the rule matches, but if any cost movement would breach the floor, the action is denied with `INSUFFICIENT_FUNDS`, alongside the existing `RULESET_DENY`.

**Known limit (not a blocker):** because only `GO` is rule-checked today, costs are movement-only for now. Cost is specified as a property of *any* action rule; extending costs to `take`, NPC commands, or quest turn-ins requires the rule system to first cover those actions. That expansion is future work.

### 5. Consent: Quote → Accept → Receipt

Any action with a cost follows a three-step quote/accept/receipt protocol at the MCP boundary, riding the existing five-point autonomy scale (`docs/project-overview.md` — *Let it run* → *I'm driving*; the invariant "irreversible actions always checkpoint" already covers the dangerous end):

1. **Quote** — a costed action discloses its cost before committing. The cost appears in the action's description/response.
2. **Accept** — confirmation per the ghost's autonomy preference for that transaction kind. A ghost may set preferences from "always ask" to "yolo" (auto-accept) per kind of transaction; below an auto-accept threshold the action proceeds without a checkpoint.
3. **Receipt** — the committed cost is reported in the action's response message.

### 6. Scheduled Transactions via the World Calendar

Recurring movements — the exam's token drain, periodic upkeep — are **scheduled transactions**, not a bespoke ledger feature. They ride the **World Calendar (RFC-0021)**: a calendar event fires a transaction (`ghost → world`) at its interval. When a drain would reduce a bag below the floor, it clamps to the floor. The ledger emits a standard `ledger.transaction.committed` event for every transaction (including floor-clamped ones); the `newBalance` field in that event payload signals floor-state to consumers. Mechanics that need to react to floor-hit (e.g. the exam engine detecting dormancy) subscribe to that event and check the balance — no special `ledger.balance-floored` event type is needed.

### 7. Ghost MCP Surface

Ghosts read their own holdings and inspect others where policy allows via the `ledger.balance` MCP tool:

```
ledger.balance                              → { ok: true, holdings: [ { resource, qty } ] }
ledger.balance { actorId: "ghost-42" }      → subject to read policy
```

Ghosts **cannot author transactions directly** for arbitrary resources — minting, charging, and jackpots are server-side, authored by game mechanics with authority. Ghost-initiated movements (trades, paying a cost) flow through the **consent protocol** (§5): a two-party trade is a single transaction carrying both actors' acceptance; a costed action carries the acting ghost's acceptance.

Read visibility is governed by a per-resource-type policy (`self` / `group` / `public`). World items and currency are typically `public`; an exam-token budget might be `group`. (Whether finer scopes like `friends` are needed is an open question.)

### 8. Relationship to RFC-0006 World Items

RFC-0006 items unify into the ledger as **conserved, quantity-1 resources** owned by actor bags, with an optional location attribute when held by the world. This works cleanly **while items remain stateless** — RFC-0006's current design (stateless refs, multiplicity by counting) fits exactly. The ledger supersedes RFC-0006's deferred persistence: `HAS_OBJECT`/`CARRIES` relationships become bag holdings; the world (not the tile) owns placed items.

Stateful items, and eventually animate objects (chests with their own commands and bags), are later complications layered on the actor model — not changes to the ledger core. We optimize for stateless items now.

### 9. Relationship to RFC-0018 RDC Ledger

RFC-0018's bespoke `rdc-ledger` should not be built. `hands-played` becomes a **monotonic** resource minted on each hand completion; skill tier remains a value *derived* from that count against RFC-0018's threshold table (computed on read, not stored as a resource — a tier is not independently additive).

### 10. Package Ownership

| Package | Responsibility |
|---|---|
| `server/world-api/src/LedgerService.ts` | Append-only log, hash chaining, single-writer guard, transaction validation (conservation + floors), bag materialization & validation |
| `server/world-api/src/movement.ts` | Cost evaluation on `:GO` rules; quote/accept/receipt integration into the `go` path |
| `server/world-api/src/world-api-errors.ts` | New `Data.TaggedError` types: `InsufficientFunds`, `ConservationViolation`, `ConsentRequired`, `UnknownResource`. Any that surface through `/mcp` must be added to the `HttpMappingError` union in `server/src/errors.ts` and handled in `errorToResponse()` via the `_tag` switch + `assertNever` pattern. |
| `server/world-api/src/mcp-server.ts` | New `ledger.balance` MCP tool; consent fields on costed actions |
| `shared/types/` | `Movement`, `Transaction`, `ResourceType`, `BagResult` types |
| `server/colyseus/` | Subscribes to transaction events; broadcasts bag changes for spectator-visible resources |
| `maps/<scene>/` | Map definition seeds the world bag; ruleset `.gram` carries `:GO` costs |

---

## Demo Scenario

With a sandbox map seeding `gold: 100` into the world bag and a ruleset `:GO` rule charging 5 gold across one edge, and a ghost adopted:

1. Call `ledger.balance` → observe empty holdings.
2. A server mechanic credits the ghost 20 gold (a `world → ghost` reward transaction). `ledger.balance` → `{ gold: 20 }`; the world bag now holds `gold: 80`. **(Conservation: 20 + 80 = 100.)**
3. `go` across the costed edge. The response carries a **quote** (5 gold). On accept, the move commits and the **receipt** reports `-5 gold`. `ledger.balance` → `{ gold: 15 }`; world bag → `gold: 85`.
4. Drain the ghost to `gold: 0`, then attempt the costed move → denied with `INSUFFICIENT_FUNDS` (the rule matches; the cost movement breaches the floor).
5. Re-submit a transaction with an already-seen `id` → rejected as a duplicate (idempotency).
6. Validate the ghost's bag against the log → matches. Tamper with any historical log entry and re-walk the chain → tampering detected.
7. Restart the server → bags rebuild from the persisted log; all balances are identical to before the restart.

**Observable acceptance criteria** (a contributor can confirm the work is done by observing these): conservation holds across steps 2–3; an unaffordable costed action is denied (4); duplicate transactions are rejected (5); a bag validates against and is reconstructable from the log, and tampering is detectable (6); balances survive a restart (7).

---

## Open Questions

1. **Resource type & seed declaration.** Where are resource types and the world bag's initial seed declared — in the map definition (`.map.gram`), a sidecar, or an admin API? Static map-embedded declaration is auditable and fits the "seeded by the map definition" model; an API enables vendor mechanics to register types at runtime without a restart. Likely map-embedded for MVP.

2. **Hashing & chain detail.** Which hash (SHA-256?), what exactly is included in the hashed body, and is the chain per-session-genesis only or does it anchor to anything external? Enough to be tamper-evident for v1; designed so a merkle layer can be added without reshaping transactions.

3. **Read policy granularity.** `self` / `group` / `public` cover the obvious cases. Is `friends` (visible to card-exchanged ghosts) or `team` needed? And does "group" visibility require the ledger to know about group membership (RFC-0022 / the Group Formation RFC), creating a dependency?

4. **Trade protocol surface.** Two-party trades need an offer/accept handshake. Is that a ledger concern (the ledger exposes a `propose`/`accept` pair that culminates in one transaction) or a higher-level mechanic that calls the ledger only at commit? Leaning higher-level, with the ledger seeing only the final consented transaction.

5. **Cost beyond movement.** Extending costs to non-movement actions requires the rule system (RFC-0002) to cover actions other than `GO`. Is that in scope soon, or do early non-movement costs need a different home (e.g. cost declared on an NPC command rather than a tile-class rule)?

6. **Idempotency window.** Transaction IDs are idempotency keys, but how long must the ledger remember seen IDs to reject duplicates — the whole session, or a bounded window? Whole-session is simplest given the log is durable anyway.

7. **Negative balances for special mechanics.** Conservation forbids negative conserved balances by construction. Do any mechanics legitimately need debt/deficit (a bag allowed below zero)? If so, that resource is effectively monotonic-negative and breaks conservation — probably better modeled as owing a separate resource than as a negative balance.

8. **Snapshot trigger (post-MVP).** When snapshots land, what triggers one — transaction count, wall-clock interval, or session checkpoint — and where are they stored relative to the log?

9. **Persistence backend at scale.** §2 proposes Neo4j `(:LedgerEntry)` nodes as the candidate store and the resolution to the open *Time-Series / Event Log Backend* question in `docs/architecture.md`. Does Neo4j suffice at conference scale, or does the append log warrant a dedicated store (JSONL-to-S3, ClickHouse, Redis stream)? This is the storage half of the durability requirement.

10. **Append throughput under load.** A single writer serializes every costed movement for up to ~3000 concurrent ghosts (a latency concern `docs/architecture.md` flags). Is in-process append with async persist sufficient, or does the writer need batching, or partitioning per session, to keep movement actions responsive?

---

## Alternatives

**Mutable balance store (the earlier draft of this RFC).** Per-actor balance rows mutated in place by `credit`/`debit`/`distribute` helpers. Simpler to implement, but no conservation guarantee, no tamper-evidence, no provenance, and no natural durability/replay story. Rejected in favor of the event-sourced log, which gives verifiability, the time-series backend, and conservation for free.

**Per-mechanic storage (status quo).** Each mechanic stores its own quantities (Neo4j properties, in-memory maps). Produces n storage shapes, no atomicity across mechanics, no shared observability. Rejected; does not scale past a couple of mechanics.

**Mutable graph state (Neo4j relationships only).** Model holdings as `(:Actor)-[:HOLDS {qty}]->(:Resource)` and mutate them in place, as RFC-0006 already does for items, with no event log. Native to the decided Neo4j world model and simplest to query. Rejected because it provides no tamper-evidence, no provenance, and no replay/audit trail — verifiability is the whole point of this RFC. Note this is not mutually exclusive with the chosen design: the materialized *bags* may well be Neo4j relationships; the distinction is that they are a derived, rebuildable cache, not the source of truth.

**Items as a separate system from resources.** Keep RFC-0006's discrete-object model wholly distinct from fungible quantities. Rejected because stateless items *are* conserved quantity-1 resources; unifying them removes a whole parallel ownership/persistence system. (Stateful/animate items remain a future actor-layer concern either way.)

**Non-conserving faucet/sink economy.** Allow any mechanic to mint or burn conserved resources freely. More flexible, but loses the conservation invariant that makes scarcity meaningful and verification trivial. Rejected for conserved resources; the monotonic class is the sanctioned, explicit exception for accumulating-only quantities.

**External ledger service (payments API, blockchain).** Operationally heavy for a single-session, in-process need. Rejected for AIEWF 2026.
