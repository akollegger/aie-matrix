# IC-003: LedgerService Interface

**Package**: `server/world-api`  
**Implementations**: `LedgerServiceLive` (Neo4j, production), `LedgerServiceInMemory` (tests)

## Interface (updated)

```typescript
interface ItemSeed {
  itemRef: string;
  qty: number;
  h3Index?: string;  // → actor "world@{h3Index}"; absent → actor "world"
}

interface LedgerServiceOps {
  /** Seed genesis transfers from map item placements. Idempotent (replay-safe). */
  init(seed: ItemSeed[]): Effect.Effect<void, LedgerPersistenceError>;

  /** Current bag holdings for an actor. O(1) — in-memory cache. */
  bag(actorId: ActorId): Effect.Effect<BagResult, LedgerUnknownActor>;

  /** Validate proposed costs against actor bag without committing. */
  quote(actorId: ActorId, costs: Cost[]): Effect.Effect<CostQuote, LedgerInsufficientFunds | LedgerUnknownActor>;

  /** Atomically commit a transaction. Updates in-memory cache and persists to Neo4j. */
  commit(tx: Transaction): Effect.Effect<void,
    | LedgerInsufficientFunds
    | LedgerConservationViolation
    | LedgerDuplicateTransaction
    | LedgerPersistenceError
  >;

  /** Re-walk hash chain and verify every entry. */
  verify(): Effect.Effect<{ entries: number }, LedgerChainTamperedError>;
}
```

## Removed from interface

- `resourceTypes(): Effect.Effect<ResourceType[]>` — removed; validation moved to ItemService sidecar
- `ensureResourceType(rt: ResourceType)` — removed
- `LedgerMonotonicTradeRejected` — removed from all error unions

## Transfer `cause` values

`"take"` | `"drop"` | `"spawn-grant"` | `"eval-payout"` | `"trade"` | `"group-formation"` | `"group-leave"`

## Conservation invariant

All commits are conservation-checked: `sum(qty deducted from senders) === sum(qty added to receivers)` for each `itemRef`. No exceptions (monotonic bypass removed).
