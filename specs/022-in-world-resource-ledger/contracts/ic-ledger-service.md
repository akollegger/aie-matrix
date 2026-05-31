# IC-001: LedgerService Interface

**Owner**: `server/world-api/src/LedgerService.ts`  
**Consumers**: `server/world-api/src/movement.ts` (cost enforcement), `server/world-api/src/mcp-server.ts` (`inventory` tool), calendar-triggered drain transactions (RFC-0021)

## Effect Service Tag

```ts
export class LedgerService extends Context.Tag("world-api/LedgerService")<
  LedgerService,
  LedgerServiceOps
>() {}
```

## Interface

```ts
export interface LedgerServiceOps {
  /**
   * Initialise the ledger for a session: load ResourceType declarations, replay
   * the persisted chain to rebuild the bag cache, and append the genesis seed
   * transaction if the chain is empty.
   * Must be called once after the session is established, before any other method.
   */
  init(seed: ResourceType[]): Effect.Effect<void, PersistenceError>

  /**
   * Return the current bag holdings for an actor.
   * O(1) — served from in-memory cache.
   */
  bag(actorId: ActorId): Effect.Effect<BagResult, UnknownActor>

  /**
   * Validate a proposed set of costs against the actor's current bag.
   * Returns a CostQuote (with a pre-generated transaction ULID) on success.
   * Does NOT commit anything.
   */
  quote(
    actorId: ActorId,
    costs: ActionCost[]
  ): Effect.Effect<CostQuote, InsufficientFunds | UnknownResource>

  /**
   * Append a transaction to the ledger.
   * Validates: conservation, floor constraints, duplicate ULID, unknown resources.
   * Updates the in-memory bag cache and persists to Neo4j atomically within
   * the single-writer constraint.
   */
  commit(
    tx: Omit<Transaction, "prevHash" | "hash">
  ): Effect.Effect<Transaction, InsufficientFunds | ConservationViolation | DuplicateTransaction | UnknownResource>

  /**
   * Re-walk the hash chain from genesis and verify every entry.
   * Returns the number of entries verified, or the first detected violation.
   */
  verify(): Effect.Effect<{ entries: number }, ChainTamperedError>

  /**
   * Return all resource types registered for this session.
   */
  resourceTypes(): Effect.Effect<ResourceType[]>
}
```

## Errors (extend `Data.TaggedError`)

```ts
export class InsufficientFunds extends Data.TaggedError("LedgerError.InsufficientFunds")<{
  actorId: ActorId
  resource: ResourceId
  required: number
  available: number
}> {}

export class ConservationViolation extends Data.TaggedError("LedgerError.ConservationViolation")<{
  resource: ResourceId
  expected: number
  actual: number
}> {}

export class DuplicateTransaction extends Data.TaggedError("LedgerError.DuplicateTransaction")<{
  id: TransactionId
}> {}

export class UnknownResource extends Data.TaggedError("LedgerError.UnknownResource")<{
  resource: ResourceId
}> {}

export class UnknownActor extends Data.TaggedError("LedgerError.UnknownActor")<{
  actorId: ActorId
}> {}

export class ChainTamperedError extends Data.TaggedError("LedgerError.ChainTampered")<{
  atId: TransactionId
  expectedHash: string
  actualHash: string
}> {}
```

## HTTP Error Mappings

All ledger errors that can surface through `/mcp` MUST be added to `HttpMappingError` in `server/src/errors.ts`:

| Error `_tag` | HTTP Status | Notes |
|---|---|---|
| `LedgerError.InsufficientFunds` | 422 | Include `resource`, `required`, `available` in body |
| `LedgerError.ConservationViolation` | 500 | Server bug; log at ERROR |
| `LedgerError.DuplicateTransaction` | 409 | Idempotency conflict |
| `LedgerError.UnknownResource` | 422 | Client sent an unregistered resource id |
| `LedgerError.UnknownActor` | 404 | |

`ChainTamperedError` does not surface through HTTP; it is an internal integrity check result.
