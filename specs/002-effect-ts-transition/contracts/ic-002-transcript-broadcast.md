# IC-002: Transcript Broadcast Interface Contract

**Feature**: Effect-ts Transition (`002-effect-ts-transition`)  
**Referenced by**: spec.md § IC-002  
**Status**: Draft

This contract defines the publish-subscribe interface for broadcasting IRL event transcripts to ghost subscribers. It decouples the ingestion source from the Colyseus broadcast layer.

---

## TranscriptEvent Shape

```typescript
interface TranscriptEvent {
  source: string      // Speaker/session identifier, e.g. "stage-a", "panel-keynote"
  text: string        // Raw transcript segment (one sentence or phrase)
  timestamp: number   // Unix epoch milliseconds (when the segment was captured)
}
```

**Constraints**:
- `source`: non-empty string; no whitespace-only values
- `text`: non-empty string; maximum 2,048 characters per segment
- `timestamp`: positive integer

---

## Publisher Interface

The ingestion path (IRL transcript source adapter) calls a single publish function:

```typescript
// Signature
publishTranscript(event: TranscriptEvent): Effect<boolean, never, TranscriptHub>

// boolean return: true if published, false if dropped (hub at capacity — dropping semantics)
// Never fails — publish failures are silent drops, not errors
```

**Semantics**:
- The publisher is non-blocking. If all subscriber queues are full, the message is dropped rather than blocking the publisher.
- There is no acknowledgement or delivery guarantee. IRL transcripts are ephemeral; a ghost missing one segment will receive the next.
- The publisher does not know or care how many subscribers exist.

---

## Subscriber Interface

Each adopted ghost is assigned a subscription fiber at adoption time:

```typescript
// Invoked once per ghost adoption — runs as a scoped fiber
subscribeGhostToHub(ghostId: string): Effect<never, never, TranscriptHub | WorldBridgeService>

// Fiber lifecycle:
//   - Starts: on ghost adoption (Effect.forkScoped)
//   - Ends: when the enclosing scope closes (ghost disconnect, server shutdown)
//   - Restart: supervised — if the fiber crashes, it is restarted automatically
```

**Semantics**:
- Each ghost receives its own independent queue. One slow ghost does not affect others.
- Backpressure strategy: `PubSub.dropping(256)` — if a ghost's queue is full, new messages are silently dropped.
- The subscriber fiber loops forever until the scope closes. No external coordination is required to cancel it.
- Message delivery to the ghost is via the existing `WorldBridgeService` or a Colyseus broadcast call; the specific delivery mechanism is an implementation detail.

---

## Hub Configuration

| Property | Value | Rationale |
|---|---|---|
| PubSub type | `dropping` | Non-blocking publisher; slow ghosts miss messages rather than blocking others |
| Buffer size | `256` | Enough to absorb brief spikes from one transcript segment arriving quickly |
| Scope | Server lifetime | Hub is created once at startup and shutdown with the server |

---

## Thundering Herd Protection

When a single transcript arrives and all 5,000 ghosts attempt to react simultaneously:

- Each ghost has its own independent fiber and queue — there is no lock contention.
- The `dropping` semantics mean delivery is best-effort per ghost, never blocking the publisher.
- The Colyseus broadcast call (inside each ghost fiber) may still contend for the Colyseus room lock. If this becomes a bottleneck, the implementation should batch or stagger the Colyseus calls — this is an implementation concern, not a contract concern.

---

## Contract Boundaries

This contract explicitly excludes:
- The source of transcripts (WebSocket, SSE, polling — open question per architecture.md).
- The format of the message sent to each ghost after `TranscriptEvent` is received (that is the ghost protocol, not this contract).
- The number of concurrent subscribers (5,000 is a performance target, not a contract ceiling).

---

## Contract Change Policy

Changes to `TranscriptEvent` shape are potentially breaking for the ingestion source adapter. Any field addition should be backward-compatible (optional). Any field removal or rename requires a coordinated update to the ingestion source and this contract document in the same change.
