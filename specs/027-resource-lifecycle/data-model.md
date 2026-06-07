# Data Model: Resource Lifecycle (027)

## Canonical Types

### `ItemTypeDef` (authoritative — `shared/map-gram`)

```typescript
interface ItemTypeDef {
  identity: string;       // gram node identity (internal)
  typeName: string;       // Pascal-case label; used as itemRef everywhere
  name: string;           // display name
  description?: string;
  glyph?: string;
  takeable?: boolean;     // default false
  capacityCost?: number;  // default 0
}
```

`ItemDefinition` in `shared/types` is **removed**. All consumers import `ItemTypeDef` from `@aie-matrix/map-gram`.

---

### `ParsedItemPlacement` (extended — `shared/map-gram`)

```typescript
interface ParsedItemPlacement {
  h3Index: string;
  itemRef: string;       // was: itemTypeName
  layerIdentity: string;
  qty: number;           // new; default 1
}
```

---

### `SpawnGrant` (new — `shared/map-gram`)

```typescript
interface SpawnGrant {
  role: string;                                  // matches agentCard.metadata.role
  grants: Array<{ itemRef: string; qty: number }>;
}
```

Declared in the map via:
```
(:SpawnGrants { role: "sponsor", GoldCoin: 5, Water: 2 })
```
(exact gram syntax TBD in map-gram parser implementation)

---

### `ParsedMap` (updated — `shared/map-gram`)

```typescript
interface ParsedMap {
  // ... existing fields ...
  itemPlacements: ParsedItemPlacement[];  // qty field added
  spawnGrants: SpawnGrant[];             // new
  // REMOVED: resourceTypes: ParsedResourceType[]
}
```

---

### `ItemSeed` (new — `server/world-api`, local)

```typescript
interface ItemSeed {
  itemRef: string;
  qty: number;
  h3Index?: string;  // present → actor "world@{h3Index}"; absent → actor "world"
}
```

Used only by `LedgerService.init()`. Derived at session init by summing `ParsedItemPlacement.qty` per `(itemRef, h3Index)`.

---

### `LedgerService` interface (updated — `server/world-api`)

```typescript
interface LedgerServiceOps {
  init(seed: ItemSeed[]): Effect.Effect<void, LedgerPersistenceError>;
  bag(actorId: ActorId): Effect.Effect<BagResult, LedgerUnknownActor>;
  quote(actorId: ActorId, costs: Cost[]): Effect.Effect<CostQuote, ...>;
  commit(tx: Transaction): Effect.Effect<void, ...>;
  verify(): Effect.Effect<{ entries: number }, LedgerChainTamperedError>;
  // REMOVED: resourceTypes()
  // REMOVED: ensureResourceType()
}
```

Error union on `commit()`: removes `LedgerMonotonicTradeRejected`. All transfers are now conservation-checked.

---

## Actor ID Conventions

| Actor | ID format | Example |
|---|---|---|
| Tile-located world pool | `world@{h3Index}` | `world@8f2830828ffffff` |
| Unlocated world pool | `world` | spawn grants, eval payouts |
| Ghost | `ghost:{ghostId}` | `ghost@01JABCDEF...` |
| Genesis (init only) | `world.genesis` | genesis transfer source |

---

## Ledger Transfer `cause` Values

| Cause | Trigger |
|---|---|
| `"take"` | Ghost picks up item from tile |
| `"drop"` | Ghost drops item onto tile |
| `"spawn-grant"` | Role-based item grant at first connect |
| `"eval-payout"` | Eval contract resolution to ghost or group members |
| `"trade"` | `offer`/`agree` completion (existing) |
| `"group-formation"` | Group escrow transfer (existing) |
| `"group-leave"` | Group escrow return (existing) |

---

## Removed Types

| Type | Package | Replacement |
|---|---|---|
| `ItemDefinition` | `shared/types` | `ItemTypeDef` from `shared/map-gram` |
| `ResourceType` | `shared/types` | n/a — concept removed |
| `ParsedResourceType` | `shared/map-gram` | n/a |
| `CatalogResourceGrant` | `server/world-api` | `SpawnGrant` from map |
| `LedgerMonotonicTradeRejected` | `server/world-api` | n/a — removed |
