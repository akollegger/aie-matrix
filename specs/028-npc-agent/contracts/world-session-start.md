# Contract IC-007: `world.session.start` Event Emission

**Owner**: `server/world-api` + `server/src` (world fanout) · **Additive** (event kind defined, never emitted today).

## Current state

`world.session.start` ∈ `WorldEventKind` ([server/agent-host/src/types.ts:117](../../../server/agent-host/src/types.ts)) and is mapped in `colyseus-bridge/translate-world-v1.ts:18`, but the world server never broadcasts a `world-v1` fanout with `t:"session.start"`. Only `message.new`, `contract.submitted`, `leaderboard.updated` are emitted.

## Change

When a live session begins, the world server emits a fanout via the existing `fanoutWorldV1` → `room.broadcast("world-v1", …)` path (the same mechanism as `message.new`, `server/src/index.ts:441`).

### Payload (`aie-matrix.world-event.v1`)

```json
{
  "schema": "aie-matrix.world-event.v1",
  "kind": "world.session.start",
  "payload": { "sessionId": "<session id>" },
  "ghostId": "<coordinator ghost id or session-scoped>",
  "eventId": "<ulid>",
  "sentAt": "<iso8601>"
}
```

## Delivery & consumption

- Host bridge `ColyseusWorldBridge` already listens for `world-v1` and `deliverWorldEvent` forwards to A2A-push agents ([SupervisorService.ts:537](../../../server/agent-host/src/supervisor/SupervisorService.ts)).
- The npc-agent coordinator (`executor.ts`) reacts to `world.session.start` by calling the roster-spawn endpoint (IC-006) for every enabled character.

## Compatibility

Additive — existing consumers ignore unknown/uninteresting event kinds (e.g. random-agent filters in `asWorldEvent`). No existing behavior changes.
