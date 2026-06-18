# Research: Resilient Service Components

**Feature**: 035-resilient-service-components  
**Date**: 2026-06-18

## Decision 1: MCP Session Architecture (per-ghost, not shared)

**Decision**: Each ghost in npc-agent and random-agent gets its own `GhostMcpClient` instance, stored in a module-level `mcpByGhostId: Map<string, GhostMcpClient>`. The spec clarification (Q4) assumed a shared connection; the actual implementation is per-ghost.

**Rationale**: Per-ghost isolation means one broken connection does not block other ghosts. The reconnect strategy must therefore operate at the ghost level, not the service level. `ghostActionLoop` in npc-agent uses `Effect.acquireRelease` for the MCP client — the correct place to add reconnect is a retry wrapper around the entire acquire/loop/release block.

**Alternatives considered**:
- Shared connection: would require multiplexing and token-switching per ghost; incompatible with how `GhostMcpClient` constructs its token from `ctx.token`.

**Spec impact**: Spec data model note for `MCP Session` should read "per-ghost client, one per active ghost" rather than "one shared connection".

---

## Decision 2: Catalog Durability Backend — Redis via ioredis

**Decision**: agent-host will use Redis (hash-per-agent-ID) for catalog durability, adding `ioredis` as a direct dependency.

**Rationale**: Redis is already deployed in the cluster (spec-016). `world-api` already has a working `RedisGhostStoreService` pattern using `ioredis` with TTL-based cleanup and graceful fallback when `REDIS_URL` is unset. agent-host can follow the same pattern: a `RedisCatalogService` that wraps the existing `CatalogService` interface, falling back to the file-based implementation when Redis is unavailable.

**Key world-api patterns to reuse**:
- `server/world-api/src/redis/RedisGhostStoreService.ts` — TTL, key prefix, fallback layer
- `makeRedisLayerFromEnv()` pattern for optional Redis wiring via env var

**Alternatives considered**:
- Kubernetes ConfigMap: requires k8s API access from agent-host, ~100ms write latency, not idiomatic
- Persistent volume for `/tmp/catalog.json`: adds PVC infra overhead; doesn't help with stale entries or TTL
- Keep ephemeral + rely only on heartbeats: leaves a 30s gap at startup where catalog is empty; durable store eliminates it

**New dependency**: `ioredis` added to `server/agent-host/package.json`

---

## Decision 3: Heartbeat Endpoint — Separate, Lightweight

**Decision**: New `POST /v1/catalog/:agentId/heartbeat` endpoint in agent-host. Payload: `{ ts: string }`. Response: `{ sessionId?: string; sessionActive: boolean; sessionUrl?: string }`.

**Rationale**:
- Registration (`POST /v1/catalog/register`) fetches and validates the full agent card (~2KB round-trip), writes to Redis, and may trigger roster spawn side-effects. Running this every 30s would add unnecessary load and risk spurious spawn triggers.
- Barnacle already uses a dedicated heartbeat endpoint (separate schema); this follows the same pattern.
- Consul, Kubernetes liveness probes, and etcd all use separate registration vs. heartbeat endpoints for the same reason: registration is expensive and stateful; heartbeat is cheap and idempotent.
- The heartbeat response carrying `sessionActive` + `sessionId` is the signal agents need to self-trigger roster reconciliation — no polling required.

**Endpoint behavior**:
1. Lookup agent by `:agentId` in catalog; return 404 if not registered
2. Update `lastSeenAt` timestamp on the catalog entry
3. Fetch active session from world-api (cached, max 10s stale)
4. Return `{ sessionActive: boolean, sessionId?: string }`

**Auth**: same bearer token as registration (`AGENT_HOST_TOKEN`). Cluster-internal only; not exposed via ingress.

---

## Decision 4: npc-agent MCP Reconnect Strategy

**Decision**: Wrap `ghostActionLoop`'s `Effect.acquireRelease` block in `Effect.retry` with an exponential backoff schedule (base 2s, max 60s, cap 10 attempts before structured `degraded` log).

**Current behavior**: `ghostActionLoop` uses `Effect.acquireRelease` for the MCP client. If connection fails at acquire time, the outer `Effect.catchAll` logs and the fiber exits. If a tool call fails mid-loop, `Effect.catchAll` on the tick logs and continues — but the MCP client is still the broken one, so every subsequent tick also fails.

**Target behavior**:
1. Tick-level `McpCallError` increments a consecutive-failure counter per ghost
2. After N consecutive failures (configurable, default 5), the current MCP client is considered dead; the loop exits cleanly
3. The outer retry schedule re-acquires a fresh MCP client and restarts the loop
4. One structured `{ kind: "npc-agent.mcp.degraded", ghostId }` event is emitted on first failure; `{ kind: "npc-agent.mcp.recovered", ghostId }` on reconnect
5. Backoff is per-ghost; other ghosts are unaffected

**Effect schedule**: `Schedule.exponential("2 seconds") |> Schedule.upTo("60 seconds")` composed with `Schedule.recurs(10)` for a hard cap before escalating to a pod-level health failure.

---

## Decision 5: random-agent Roster Reconciliation

**Decision**: After re-registration (on heartbeat response `sessionActive: true`), random-agent calls `GET /registry/ghosts?agentId={agentId}` (or equivalent world API endpoint) to get the set of ghost IDs already present in the active session. It spawns only the missing portion of its configured roster size.

**Current behavior**: random-agent stores active ghost IDs in `loopsByGhostId: Map<string, MoveLoop>`. If the process has been running continuously, this map reflects current state. If agent-host restarted but random-agent did not, the in-memory map is still valid — the ghosts exist in the world. The problem is random-agent has no way to know if the session changed under it.

**Reconciliation flow**:
1. Heartbeat response includes `{ sessionActive: true, sessionId: "01K..." }`
2. random-agent compares stored `activeSessionId` with received `sessionId`
3. If session ID changed (or was unknown), trigger reconciliation:
   - Query world API for current ghosts owned by this agent in the session
   - Compute diff: (configured roster size) − (currently moving ghosts) = ghosts to spawn
   - Spawn only the delta
4. If session ID unchanged, no action (ghosts are fine)

**Avoids**: double-spawn when agent-host restarts but random-agent's ghosts are still alive in the world.

---

## Decision 6: random-agent task-not-found Handling

**Decision**: In the A2A push ingest handler (agent-host `POST /v1/internal/a2a-agent-push`), when forwarding to random-agent's task context: if the agent returns a "task not found" / unknown task error, agent-host logs a structured `supervisor.task-not-found` event. On the random-agent side, the movement loop detects when its MCP client gets disconnected (task cancelled by agent-host) and re-initiates via the `startMovementFromSpawn` flow with a new task.

**Correction from spec**: FR-007a said random-agent detects `task-not-found` in push responses. But random-agent doesn't push — it *receives* pushes (world events) via A2A from agent-host. The stale task ID problem is on agent-host's side (it holds `s.currentTaskId` which is invalid after its own restart). The fix is:
1. agent-host: when sending a world event to a ghost's A2A context and receiving "task not found", treat it as a session health failure → restart the session (which re-initiates the A2A task)
2. random-agent: on MCP disconnect / task-cancel signal, re-register and re-spawn its ghosts

This is cleaner: agent-host already has health loop restart logic; extending it to handle `task-not-found` A2A errors is a one-line change to the error classification.

---

## Startup Reconciliation Wait

**Finding**: The 120s timeout seen in production was from `AGENT_HOST_RECONCILIATION_WAIT_MS` env var overriding the 30s default (`server/agent-host/src/main.ts:163`). With a durable Redis catalog and startup health-check pings, the passive wait can be eliminated entirely: agent-host loads the catalog from Redis, pings each known agent, and immediately spawns rosters for live agents — no polling loop needed.

**Decision**: Replace the polling loop in `main.ts:192–218` with an eager ping-and-spawn pass over the restored catalog. The `AGENT_HOST_RECONCILIATION_WAIT_MS` env var becomes unused and can be deprecated.

---

## Testing Strategy

### Unit tests (ship in same change — no live services required)

| Component | Test file location | What to cover |
|---|---|---|
| `RedisCatalogService` | `server/agent-host/src/catalog/__tests__/RedisCatalogService.test.ts` | All methods with mock Redis client; error paths (connection refused, key missing) |
| Heartbeat handler | `server/agent-host/src/__tests__/heartbeat.test.ts` | 200 + session state, 404 for unknown agent, `lastSeenAt` update |
| npc-agent reconnect schedule | `ghosts/npc-agent/src/__tests__/reconnect.test.ts` | Consecutive failure counter, backoff schedule, degraded/recovered events |
| random-agent session reconciliation | `ghosts/random-agent/src/__tests__/reconciliation.test.ts` | Session ID change triggers reconciliation; same session ID is a no-op; partial roster spawns delta only |
| random-agent heartbeat client | `ghosts/random-agent/src/__tests__/heartbeat.test.ts` | Heartbeat fires on interval; session-active response triggers reconciliation check |

### Integration tests (require Redis; may land separately if CI infra unavailable)

| Component | What to cover |
|---|---|
| `RedisCatalogService` + real Redis | Persist → restart → restore round-trip; TTL expiry removes stale entries |
| agent-host startup reconciliation | Start agent-host with pre-populated Redis catalog; verify roster spawn fires without waiting for re-registration |

### Failure-mode / chaos tests

Documented as manual runbook steps in `quickstart.md` (executable by operators, not CI):

| Scenario | Steps | Expected outcome |
|---|---|---|
| agent-host pod restart | `kubectl rollout restart deployment/agent-host -n aie-matrix` | Ghosts visible and moving within 3 min |
| npc-agent pod restart | `kubectl rollout restart deployment/npc-agent -n aie-matrix` | NPCs resume ticking within 90s |
| server pod restart | `kubectl rollout restart deployment/server -n aie-matrix` | npc-agent reconnects; NPCs resume within 90s |
| Kill agent-host mid-session | Scale to 0, wait 2 min, scale back to 1 | Catalog restored from Redis; wanderers respawn |
