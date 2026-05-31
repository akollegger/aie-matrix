# Data Model: In-World Resource Ledger

## Shared Types (`shared/types/src/ledger.ts`)

```ts
/** ULID-format transaction ID; also the idempotency key. */
export type TransactionId = string

/** Actor identifier — ghost id, "world", NPC id, etc. */
export type ActorId = string

/** Resource type identifier, e.g. "gold", "xp", "exam-token". */
export type ResourceId = string

export type ResourceClass = "conserved" | "monotonic"

export interface ResourceType {
  id: ResourceId
  class: ResourceClass
  floor: number       // minimum allowed balance; default 0
  label: string       // human-readable display name
}

export interface Transfer {
  resource: ResourceId
  qty: number         // positive integer; direction determined by from/to
  from: ActorId
  to: ActorId
  location?: { h3Index: string }  // set when a world item moves to/from a tile
}

export interface Transaction {
  id: TransactionId           // ULID; idempotency key
  transfers: Transfer[]
  cause: string               // e.g. "go", "exam.jackpot", "seed", "drain"
  actors: ActorId[]           // actors whose consent this transaction carries
  ts: number                  // server timestamp (ms since epoch)
  prevHash: string            // hash of predecessor; "" for genesis
  hash: string                // SHA-256(canonical body + prevHash)
}

/** Per-actor materialized holdings cache entry. */
export interface BagEntry {
  actorId: ActorId
  resource: ResourceId
  qty: number
}

/** Result of an inventory lookup. */
export interface BagResult {
  actorId: ActorId
  holdings: BagEntry[]
}

/** Cost declared on a :GO rule edge. */
export interface ActionCost {
  resource: ResourceId
  qty: number
  payee: ActorId    // defaults to "world"
}

/** Quote returned before a costed action commits. */
export interface CostQuote {
  transactionId: TransactionId  // pre-generated ULID for the pending transaction
  costs: ActionCost[]
}
```

---

## Neo4j Schema

### Nodes

```
(:LedgerEntry {
  id:         string     // ULID transaction id
  cause:      string
  actors:     string[]
  ts:         integer    // ms epoch
  prevHash:   string
  hash:       string
  transfers:  string     // JSON-serialized Transfer[] (Neo4j has no array-of-objects type)
})
```

### Relationships

```
(:LiveSession)-[:LEDGER_HEAD]->(:LedgerEntry)   // points to the genesis entry; set once at session start
(:LiveSession)-[:LEDGER_TIP]->(:LedgerEntry)    // points to the most recent entry; updated on every append
(:LedgerEntry)-[:NEXT_ENTRY]->(:LedgerEntry)    // ordered chain; genesis has no outgoing NEXT_ENTRY
```

The session holds exactly two ledger relationships regardless of chain length. Replay walks forward from `LEDGER_HEAD` via `NEXT_ENTRY` links. The writer reads `LEDGER_TIP` to get the current chain tip hash before appending, then moves `LEDGER_TIP` to the new entry atomically in the same transaction.

### Indexes

```cypher
CREATE CONSTRAINT ledger_entry_id_unique IF NOT EXISTS
  FOR (e:LedgerEntry) REQUIRE e.id IS UNIQUE;
```

---

## Map Grammar Extension (`.map.gram`)

New `Resources` layer block in map definition files:

```gram
[resources:Resources {name: "World Resources"} |
  (:Resource { id: "gold",       class: "conserved",  qty: 100, floor: 0, label: "Gold" }),
  (:Resource { id: "energy",     class: "conserved",  qty: 500, floor: 0, label: "Energy" }),
  (:Resource { id: "xp",         class: "monotonic",  qty: 0,   floor: 0, label: "Experience" }),
]
```

- `qty` on a `conserved` resource is the total seeded into the world bag at session start.
- `qty` on a `monotonic` resource is ignored (no fixed supply); `0` by convention.
- Parsed by `@aie-matrix/map-gram`; consumed by `LedgerService` genesis transaction.

---

## Rule Edge Cost Extension (`.map.gram` rules)

```gram
[rules:Rules |
  (red)-[:GO { cost: [{ qty: 5, resource: "gold", payee: "world" }] }]->(blue),
]
```

- `cost` is an optional array of `ActionCost` objects on any `:GO` edge property.
- Parsed from the gram AST by `movement.ts` when evaluating a `go` action.

---

## In-Memory State (`LedgerService`)

```ts
// Keyed by actorId → resourceId → current balance
type BagCache = Map<ActorId, Map<ResourceId, number>>

// Seen transaction IDs for idempotency (whole-session window)
type SeenIds = Set<TransactionId>

// The hash of the most recently appended transaction
type ChainTip = { hash: string; id: TransactionId }
```

---

## State Transitions

```
Session starts
  └─► LedgerService.init()
        ├─ Load ResourceTypes from map definition
        ├─ Replay (:LedgerEntry) chain from genesis → build BagCache
        └─ If no entries: append genesis seed transaction → world bag seeded

Ghost calls `go` on costed edge
  └─► movement.ts
        ├─ LedgerService.quote(actorId, costs[]) → CostQuote | InsufficientFunds
        ├─ [consent checkpoint per autonomy setting]
        └─ LedgerService.commit(transaction) → Transaction | InsufficientFunds | ConservationViolation | DuplicateTransaction

Server mechanic mints XP
  └─► LedgerService.commit({ transfers: [{ from: "world.xp-issuer", to: actorId, resource: "xp", qty: N }], ... })

Ghost calls `inventory`
  └─► LedgerService.bag(actorId) → BagResult  (O(1) memory read)

Scheduled drain (calendar event fires)
  └─► LedgerService.commit(drainTransaction)  // clamped to floor; never goes negative
```
