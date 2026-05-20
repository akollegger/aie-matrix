# IC-004: Redis World Events Contract

**Channel**: `aie-matrix:world-events`  
**Publisher**: `server/world-api/src/redis/RedisPublishService.ts`  
**Subscribers**: Colyseus (`server/colyseus/`), agent-host (`server/agent-host/`)  
**Constant location**: `@aie-matrix/shared-types` — `WORLD_EVENTS_CHANNEL = "aie-matrix:world-events"`

All messages are JSON-serialised strings. Subscribers parse with `JSON.parse`.

---

## `world.session-started`

Published by `POST /live` after session record is created.

```json
{
  "type": "world.session-started",
  "sessionId": "01JVXYZ...",
  "name": "AIEWF 2026 Main",
  "maps": [{ "mapId": "moscone-west-l2", "role": "primary" }]
}
```

**Subscriber behaviour**:
- **Colyseus**: loads movement graph for the primary map from Neo4j. Updates `/:spectator/room` metadata.
- **agent-host**: records session context for agent event delivery.

---

## `world.map-changed`

Published by `PATCH /live/:id/maps` after `[:USES]` edges are updated.

```json
{
  "type": "world.map-changed",
  "sessionId": "01JVXYZ...",
  "maps": [{ "mapId": "moscone-west-l3", "role": "primary" }],
  "removedCells": ["8f2830828052d25", "8f2830828052d26"],
  "addedCells": ["8f28308280529ab", "8f28308280529ac"]
}
```

**Subscriber behaviour**:
- **world-api** (self): rebuilds in-memory movement graph and cell index. Rejects `go` on `removedCells` with `CELL_NOT_IN_MAP`. Triggers ghost evacuation.
- **Colyseus**: removes `ghostTiles` entries for ghosts on `removedCells`. Broadcasts `message.map-changed` room event to WebSocket clients.
- **agent-host**: delivers `aie-matrix.world-event.v1` of type `world.map-changed` to each adopted ghost agent.

---

## `world.session-ended`

Published by `DELETE /live/:id`.

```json
{
  "type": "world.session-ended",
  "sessionId": "01JVXYZ...",
  "endedAt": "2026-06-29T18:00:00Z"
}
```

**Subscriber behaviour**:
- **Colyseus**: marks session ended in room metadata.
- **agent-host**: stops delivering world events to agents for this session.

---

## Delivery Guarantees

Redis pub/sub is fire-and-forget. If the broadcast succeeds but a subscriber misses it (e.g., restart in flight), services recover via the `GET /live?status=active` heartbeat poll (RFC-0013 OQ-2). Recommended poll interval: 30 seconds.

---

## No-op Tier 1 behaviour

When `REDIS_URL` is unset, `RedisPublishService` is a no-op Layer: publish calls return `Effect.void` and log a single debug line. No event is delivered to other services in Tier 1 single-process mode.
