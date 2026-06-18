# RFC-035: Resilient Service Components

**Status**: Accepted  
**Date**: 2026-06-18  
**Spec**: `specs/035-resilient-service-components/spec.md`  
**Branch**: `035-resilient-service-components`

## Problem

On 2026-06-18, agent-host was restarted and three cascading failures occurred:

1. **Catalog lost**: agent-host stores registrations in `/tmp/catalog.json` — ephemeral per pod. After restart, no agents were registered. The 120s startup reconciliation wait timed out because no agents knew to re-register.
2. **NPC ghosts frozen**: npc-agent's MCP client throws `McpCallError` on every tick with no retry or reconnect logic. One error per tick generated continuous log spam and ghosts stopped moving.
3. **random-agent orphaned**: random-agent held A2A task IDs from the previous agent-host instance. After restart, push notifications to those task IDs failed with "Task not found". No reconnect or task re-initiation logic existed.

None of the services had any cross-service resilience — each assumed the others were always available.

## Proposal

Four targeted changes, each owned by the service responsible for its own resilience:

### 1. Durable agent catalog (agent-host)

Replace the ephemeral `/tmp/catalog.json` with a Redis-backed store (Redis is already deployed per spec-016). On startup, agent-host restores the catalog from Redis and immediately pings known agents, replacing the 120s passive-wait polling loop with an eager ping-and-spawn pass.

New dependency: `ioredis` v5 in `server/agent-host`. Falls back to file-backed catalog when `REDIS_URL` is unset.

### 2. Dedicated heartbeat endpoint (agent-host)

Add `POST /v1/catalog/:agentId/heartbeat` — a lightweight liveness signal separate from the full registration flow (which fetches and validates the agent card). Matches the existing Barnacle heartbeat pattern. Response includes current session state (`sessionActive`, `sessionId`) so agents can self-trigger roster reconciliation without polling.

### 3. Per-ghost MCP reconnect with backoff (npc-agent)

Wrap each ghost's `ghostActionLoop` (which uses `Effect.acquireRelease` for its MCP client) in an `Effect.retry` schedule. After a configurable number of consecutive tick failures (default 5), the ghost exits its inner loop cleanly, the MCP client is released, and the retry schedule re-acquires a fresh connection with exponential backoff (2s → 60s cap). Emits structured `npc-agent.mcp.degraded` / `npc-agent.mcp.recovered` events — one per state transition, not one per tick.

### 4. Session-aware roster reconciliation + push resilience (random-agent)

random-agent gains two resilience behaviours:

- **Heartbeat client**: calls `POST /v1/catalog/:agentId/heartbeat` every 30s. On session ID change, triggers roster reconciliation: queries the world API for existing ghost IDs attributed to this agent and spawns only the missing delta.
- **Push resilience**: detects consecutive push-notification failures (→ `push.degraded`) and recovers on success (→ `push.recovered`). On `task-not-found` response from agent-host, discards the stale task ID and re-initiates a fresh A2A task for that ghost.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Catalog storage | Redis hash per agentId, 24h TTL | Already deployed; ioredis pattern exists in world-api |
| Heartbeat endpoint | Separate `POST /v1/catalog/:agentId/heartbeat` | Registration is expensive (fetches agent card); Barnacle and Consul/k8s use separate endpoints |
| MCP session architecture | Per-ghost client (existing) | Isolation — one broken connection doesn't affect other ghosts |
| Spawn ownership (heartbeat path) | Agent self-manages via reconciliation | Agent has ground truth on which ghosts are live; avoids double-spawn |
| Spawn ownership (startup path) | agent-host calls `spawnRosterForAgent` (idempotent) | Handles cold start where random-agent may not be running yet |
| task-not-found handling | Per-task discard-and-reinitiate in random-agent | Handles all causes of stale IDs, not just agent-host restarts |

Full decision rationale in `specs/035-resilient-service-components/research.md`.

## Interface Contracts

- `POST /v1/catalog/:agentId/heartbeat` → `specs/035-resilient-service-components/contracts/heartbeat-endpoint.md`
- `CatalogEntry` type extended with `lastSeenAt?` and `healthStatus?` (additive, backward-compatible)

## Testing

- Unit tests for all new Effect `Layer` implementations (constitution requirement)
- Integration tests for Redis catalog round-trip (may land separately if Redis unavailable in CI)
- Manual chaos runbook: 4 restart scenarios in `specs/035-resilient-service-components/quickstart.md`

## Success Criteria

- Any single pod restart → world resumes normal ghost activity within 3 minutes, no operator intervention
- agent-host catalog populated within 5s of pod readiness (from Redis restore)
- NPC tick errors reduced >95% during MCP reconnection periods
- Zero duplicate ghost spawns on re-registration
