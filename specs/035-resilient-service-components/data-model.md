# Data Model: Resilient Service Components

## Entities

### CatalogEntry (extended — additive only)

Existing type in `server/agent-host/src/types.ts`. Two new optional fields added to the `kind: "agent"` variant:

```typescript
type CatalogEntry =
  | {
      readonly kind?: "agent";
      readonly agentId: string;
      readonly baseUrl: string;
      readonly agentCard: AgentCard;
      readonly registeredAt: string;
      readonly builtIn: boolean;
      readonly resourceGrants?: ReadonlyArray<...>;
      // NEW:
      readonly lastSeenAt?: string;       // ISO 8601; updated on heartbeat or registration
      readonly healthStatus?: "active" | "inactive" | "unverified";
      // "unverified" = restored from Redis before first ping
      // "active"     = responded to ping or sent heartbeat
      // "inactive"   = ping failed; entry retained for recovery
    }
  | { readonly kind: "mini-game"; ... };  // unchanged
```

**Validation rules**:
- `lastSeenAt` is set by agent-host; never trusted from registration payload
- `healthStatus` defaults to `"unverified"` on catalog restore from Redis
- `healthStatus` transitions: `unverified → active` (ping ok) | `unverified → inactive` (ping fail) | `active → inactive` (ping fail) | `inactive → active` (heartbeat received or re-registration)

**Persistence**: JSON-serialized as a Redis hash field; key `agent-host:catalog`, field per `agentId`.

---

### HeartbeatRequest (new)

Sent by agents to `POST /v1/catalog/:agentId/heartbeat`.

```typescript
type HeartbeatRequest = {
  readonly ts: string;  // ISO 8601 timestamp from the agent's clock
};
```

---

### HeartbeatResponse (new)

Returned by agent-host from `POST /v1/catalog/:agentId/heartbeat`.

```typescript
type HeartbeatResponse = {
  readonly sessionActive: boolean;
  readonly sessionId?: string;  // ULID; present only when sessionActive === true
};
```

**State transitions for agents**:
- `sessionActive: false` → no action; continue heartbeating
- `sessionActive: true, sessionId === storedSessionId` → no action; session is known
- `sessionActive: true, sessionId !== storedSessionId` → trigger roster reconciliation, update stored session ID
- `sessionActive: true, storedSessionId === undefined` → fresh session detected; trigger reconciliation

---

### AgentReconnectState (new — npc-agent in-memory only)

Tracked per ghost in `ghosts/npc-agent/src/reconnect.ts`. Not persisted.

```typescript
type AgentReconnectState = {
  ghostId: string;
  consecutiveFailures: number;  // reset to 0 on successful tick
  status: "ok" | "degraded" | "reconnecting";
  // "ok"           = ticking normally
  // "degraded"     = consecutive failures ≥ threshold; about to reconnect
  // "reconnecting" = backoff in progress; tick loop paused
};
```

**Lifecycle**:
1. Created with `status: "ok"` when ghost fiber starts
2. `consecutiveFailures` increments on each `McpCallError` in tick
3. At threshold (default 5): `status → "degraded"`, emit structured log, exit inner tick loop
4. Retry schedule re-acquires MCP client: `status → "reconnecting"` during backoff
5. On successful connect + first successful tick: `status → "ok"`, emit recovered log, reset counter

---

### RosterReconciliationState (new — random-agent in-memory only)

Tracked in `ghosts/random-agent/src/reconciliation.ts`. Not persisted.

```typescript
type RosterReconciliationState = {
  activeSessionId: string | null;  // last known session ID from heartbeat response
  reconciling: boolean;            // guard against concurrent reconciliation runs
};
```

**Reconciliation trigger**: `activeSessionId` changes → query world API for current ghost roster → compute delta → spawn missing.

---

## State Transition Diagrams

### CatalogEntry.healthStatus

```
            agent-host startup
                    │
                    ▼
              [unverified]
              /          \
        ping ok         ping fail
            │                │
            ▼                ▼
         [active]        [inactive]
            │    \        /    │
     heartbeat    \      /   heartbeat /
     received      \    /    re-register
                    \  /
               (no transition)
```

### npc-agent Ghost Reconnect

```
   fiber start
       │
       ▼
    [ok] ──── tick ok ──────────────────── resets consecutiveFailures
       │
    McpCallError
       │
  +1 consecutiveFailures
       │
  ≥ threshold?
   No → back to [ok] (tick continues)
   Yes ↓
   [degraded] → emit npc-agent.mcp.degraded
       │
   exit inner loop (MCP client released)
       │
       ▼
  [reconnecting] → backoff schedule
       │
   acquire fresh MCP client
   ├─ fail → retry (exponential)
   └─ success ↓
       │
   first tick ok
       │
       ▼
    [ok] → emit npc-agent.mcp.recovered
```

### random-agent Session Awareness

```
  heartbeat fires (every 30s)
          │
          ▼
  GET /v1/catalog/:id/heartbeat
          │
  ┌───────┴───────────────┐
  │                       │
sessionActive: false   sessionActive: true
  │                       │
  │               sessionId == stored?
  │               ┌───────┴───────┐
  │              yes              no
  │               │               │
  │            no-op        reconcile roster
  │                         (query world API,
  │                          spawn delta)
  │                               │
  └───────────────────────────────┘
          continue heartbeating
```
