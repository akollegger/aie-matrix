# IC-002: Ledger Transaction Event

**Owner**: `server/world-api/src/LedgerService.ts` (emitter)  
**Consumers**: `server/colyseus/` (broadcast bag changes to spectators)

## Event Shape

Published on `ledger:transaction:committed` via the existing Redis pub/sub channel (`RedisPublishService`):

```ts
export interface LedgerTransactionCommittedEvent {
  type: "ledger:transaction:committed"
  sessionId: string
  transactionId: TransactionId
  cause: string
  ts: number
  // Per-actor balance changes — only actors whose bags changed are included.
  // Colyseus broadcasts these to connected spectators for visible resources.
  changes: Array<{
    actorId: ActorId
    resource: ResourceId
    newBalance: number
    delta: number        // positive = gained, negative = spent
  }>
}
```

## Consumer Contract (Colyseus)

- `server/colyseus/` subscribes to `ledger:transaction:committed`.
- For each entry in `changes`, broadcast the `newBalance` for spectator-visible resources (read policy `"public"`).
- Resources with `"self"` read policy MUST NOT be broadcast to other actors.
- The event carries enough information to update the Colyseus state schema without a separate balance query.

## Floor-Clamp Signal

When a drain transaction clamps a balance to its floor:
- The `delta` in `changes` reflects the actual amount deducted (not the attempted amount).
- `newBalance` equals the floor value.
- Consumers detecting `newBalance === floor` for a resource can react accordingly (e.g., exam engine detecting dormancy).
- No separate `ledger:balance:floored` event type is emitted.
