# Implementation Plan: Resilient Service Components

**Branch**: `035-resilient-service-components` | **Date**: 2026-06-18 | **Spec**: [spec.md](spec.md)

## Summary

Four services — agent-host, npc-agent, random-agent, and server — currently have no reconnect logic and lose state on restart, causing frozen ghosts and missing wanderers. This plan makes each service tolerant of restarts in the others by adding: a durable Redis-backed agent catalog (agent-host), a dedicated heartbeat endpoint (agent-host), per-ghost MCP reconnect with exponential backoff (npc-agent), and session-aware roster reconciliation triggered by heartbeat responses (random-agent). Every change ships with unit tests covering all Effect service methods and error paths; integration tests cover the Redis catalog round-trip; and a chaos runbook documents manual failure-mode verification.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)
**Primary Dependencies**: `effect` v3+, `ioredis` v5 (new dep in `server/agent-host`), `@a2a-js/sdk` 0.3.13+, `@modelcontextprotocol/sdk` 1.29+, `express` v4
**Storage**: Redis (catalog hash per agent ID, TTL-based cleanup); existing `catalog.json` as fallback when `REDIS_URL` unset
**Testing**: `vitest` (unit, integration); manual chaos runbook (`quickstart.md`)
**Target Platform**: GKE (Kubernetes 1.28+), Node.js 24 server process
**Project Type**: Microservice cluster (agent-host + ghost agents)
**Performance Goals**: Heartbeat round-trip < 20ms cluster-internal; catalog restore on startup < 500ms
**Constraints**: Zero new public HTTP endpoints; heartbeat endpoint is cluster-internal only; no changes to A2A or MCP protocol interfaces
**Scale/Scope**: ~5 registered agents, ~25 active ghosts per session

## Constitution Check

- **Proposal linkage**: spec-035 serves as the written proposal; cross-cutting resilience changes of this scope should be backed by an RFC. An RFC (`proposals/rfc/RFC-035-resilient-service-components.md`) will be authored as the first task in this plan.
- **Boundary preservation**: agent-host owns the catalog and heartbeat contract; each agent owns its own reconnect and reconciliation logic. No cross-package side-effects.
- **Contract artifacts**: `POST /v1/catalog/:agentId/heartbeat` endpoint documented under `contracts/heartbeat-endpoint.md` before implementation.
- **Verification**: every Effect `Layer` implementation ships with unit tests covering all methods and typed error paths (constitution §Service Testing Requirements). Integration tests planned for `RedisCatalogService`; may land separately if Redis unavailable in CI — documented with explicit gap list.
- **Documentation**: `docs/architecture.md`, `CLAUDE.md` (Recent Changes), `deploy/staging/` health probe config identified in Documentation Impact.

## Project Structure

### Documentation (this feature)

```text
specs/035-resilient-service-components/
├── plan.md              ← this file
├── research.md          ← Phase 0 (complete)
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output (includes chaos runbook)
├── contracts/
│   └── heartbeat-endpoint.md   ← Phase 1 output
└── tasks.md             ← /speckit.tasks output (not yet)
```

### Source Code

```text
proposals/rfc/
└── RFC-035-resilient-service-components.md   [new]

server/agent-host/
├── package.json                              [add ioredis dep]
└── src/
    ├── catalog/
    │   ├── CatalogService.ts                 [existing — interface unchanged]
    │   ├── RedisCatalogService.ts            [new — Redis-backed Layer]
    │   └── __tests__/
    │       └── RedisCatalogService.test.ts   [new — unit tests with mock Redis]
    ├── app.ts                                [add heartbeat endpoint]
    ├── main.ts                               [replace polling reconciliation with eager ping-and-spawn]
    └── __tests__/
        └── heartbeat.test.ts                 [new — heartbeat handler unit tests]

ghosts/npc-agent/
└── src/
    ├── executor.ts                           [wrap ghostActionLoop in retry schedule]
    ├── reconnect.ts                          [new — backoff schedule, degraded/recovered events]
    └── __tests__/
        └── reconnect.test.ts                 [new — consecutive failure, backoff, events]

ghosts/random-agent/
└── src/
    ├── executor.ts                           [session reconciliation on heartbeat signal]
    ├── heartbeat.ts                          [new — periodic heartbeat client]
    ├── reconciliation.ts                     [new — roster diff + partial spawn logic]
    └── __tests__/
        ├── heartbeat.test.ts                 [new]
        └── reconciliation.test.ts            [new]
```

**Structure Decision**: Changes are distributed across existing packages; no new top-level directories. Each package owns its resilience logic — no shared resilience library. This avoids a cross-package dependency for what are fundamentally per-service concerns.

---

## Phase 0: Research

**Status: Complete** → see [research.md](research.md)

Key resolved questions:

| Unknown | Resolution |
|---|---|
| MCP session architecture | Per-ghost (not shared); reconnect must be per-ghost |
| Catalog durability backend | Redis via ioredis; follow world-api's `RedisGhostStoreService` pattern |
| Heartbeat endpoint design | Separate `POST /v1/catalog/:agentId/heartbeat`; response carries `sessionActive + sessionId` |
| npc-agent reconnect approach | `Effect.retry` with exponential schedule wrapping the acquireRelease block |
| random-agent reconciliation trigger | Heartbeat response `sessionId` change detection; world API ghost query for diff |
| task-not-found ownership | agent-host health loop handles it (classifies A2A task errors → session restart); not random-agent |
| Startup reconciliation replacement | Eager ping-and-spawn over restored Redis catalog; eliminates passive polling loop |

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](data-model.md) for full entity definitions. Summary of additions:

**`CatalogEntry`** (extends existing, additive only):
- `lastSeenAt?: string` — ISO timestamp of last heartbeat or registration
- `healthStatus: "active" | "inactive" | "unverified"` — `unverified` on restore from Redis before first ping; `active` after successful ping; `inactive` after ping failure

**`HeartbeatRequest`** (new):
- `ts: string` — ISO timestamp from caller

**`HeartbeatResponse`** (new):
- `sessionActive: boolean`
- `sessionId?: string` — present when `sessionActive: true`

**`AgentReconnectState`** (new, npc-agent in-memory only):
- `consecutiveFailures: number`
- `backoffMs: number`
- `status: "ok" | "degraded" | "reconnecting"`

---

### Interface Contracts

#### `POST /v1/catalog/:agentId/heartbeat`

See [contracts/heartbeat-endpoint.md](contracts/heartbeat-endpoint.md).

```
Request
  Method: POST
  Path:   /v1/catalog/:agentId/heartbeat
  Auth:   Authorization: Bearer <AGENT_HOST_TOKEN>
  Body:   { "ts": "<ISO 8601 timestamp>" }

Response 200
  { "sessionActive": true,  "sessionId": "01KVDBB8A67TQW6GEM5DYS18MH" }
  { "sessionActive": false }

Response 404
  { "error": "agent not registered" }
  (agent must call POST /v1/catalog/register first)

Side effects
  - Updates CatalogEntry.lastSeenAt
  - Updates CatalogEntry.healthStatus → "active"
  - Does NOT trigger spawnRosterForAgent (agents self-manage spawning)
```

---

### Implementation Steps (ordered by dependency)

#### Step 1 — RFC (prerequisite for all code changes)
Write `proposals/rfc/RFC-035-resilient-service-components.md` summarising the problem, decisions from research.md, and the four implementation areas. Links to spec-035.

#### Step 2 — agent-host: RedisCatalogService
New `RedisCatalogService.ts` implementing the same `CatalogService` interface as the existing file-backed service:
- `load()` → `HGETALL agent-host:catalog` → deserialize entries; return empty catalog if key missing
- `save(catalog)` → `HMSET agent-host:catalog { [agentId]: JSON.stringify(entry) }` for each entry
- `register()` / `deregister()` → delegate to in-memory logic, then persist
- TTL: `EXPIRE agent-host:catalog 86400` (24h; refreshed on each save)
- Layer: `RedisCatalogServiceLive` wraps `CatalogServiceLive` with Redis persistence; falls back to file-only when `REDIS_URL` unset (mirrors `world-api` fallback pattern)
- **Tests**: unit tests with `ioredis-mock` covering all methods + Redis error paths

#### Step 3 — agent-host: heartbeat endpoint
Add `POST /v1/catalog/:agentId/heartbeat` handler to `app.ts`:
- Auth: same bearer check as registration
- 404 if agentId not in catalog
- Update `lastSeenAt` + set `healthStatus: "active"`
- Return active session state (cache world-api `/live?status=active` for ≤10s)
- **Tests**: heartbeat handler unit tests (known agent → 200; unknown → 404; `lastSeenAt` updated)

#### Step 4 — agent-host: replace startup reconciliation
Replace `main.ts:192–218` polling loop with eager pass:
1. Load catalog from Redis (Step 2)
2. For each entry with `agentCard.matrix.rosterAgent === true`: ping the agent's `/health` or agent card URL
3. If ping succeeds AND active session found: call `supervisor.spawnRosterForAgent(...)` directly
4. Entries that fail ping are marked `healthStatus: "inactive"` — not removed
5. Deprecate `AGENT_HOST_RECONCILIATION_WAIT_MS` env var (log warning if set, ignore it)

#### Step 5 — npc-agent: per-ghost MCP reconnect
New `reconnect.ts` exports:
- `makeReconnectSchedule()` → `Schedule.exponential("2 seconds").pipe(Schedule.upTo("60 seconds"))`
- `McpReconnectState` per ghost: `{ consecutiveFailures, backoffMs, status }`
- Structured log helpers: `logDegraded(ghostId)`, `logRecovered(ghostId)`

Modify `executor.ts`:
- In `ghostActionLoop`, after `Effect.acquireRelease`, wrap the tick loop in a consecutive-failure counter
- After `CONSECUTIVE_FAILURE_THRESHOLD` (default 5) tick errors, exit the inner loop (triggers release → disconnect)
- Outer `Effect.retry(makeReconnectSchedule())` re-acquires a fresh MCP client
- Emit `degraded` event on first failure; `recovered` event on successful reconnect
- **Tests**: unit — mock `GhostMcpClient` that fails N times then succeeds; assert degraded/recovered events and correct retry count

#### Step 6 — random-agent: heartbeat client
New `heartbeat.ts`:
- `startHeartbeat(agentId, agentHostUrl, token, onSessionChange)` → `setInterval` every 30s
- Calls `POST /v1/catalog/:agentId/heartbeat`
- Compares returned `sessionId` with stored `activeSessionId`; if changed (or newly active), calls `onSessionChange(sessionId)`
- Structured log on heartbeat failure (retry silently next interval)
- **Tests**: interval fires; session change callback triggered on ID change; no callback on same ID

#### Step 7 — random-agent: roster reconciliation
New `reconciliation.ts`:
- `reconcileRoster(worldApiUrl, agentId, targetCount, activeLoops)` → queries `GET /registry/ghosts` filtered by `agentId`; returns list of missing ghost IDs (or count to spawn)
- Called from `onSessionChange` callback (Step 6)
- Spawns only the delta (calls existing spawn path)
- **Tests**: world API returns 3 ghosts, target is 10 → spawns 7; world API returns 10 → spawns 0; world API error → logs, no spawn

#### Step 8 — random-agent: wire heartbeat + reconciliation into agent startup
Modify `agent.ts`:
- After successful registration, call `startHeartbeat(...)` with `onSessionChange → reconcileRoster(...)`
- Pass current `loopsByGhostId` size as `activeLoops` count for delta calculation

#### Step 9 — Tests: integration (RedisCatalogService)
In `server/agent-host/src/catalog/__tests__/RedisCatalogService.integration.test.ts`:
- Skip when `REDIS_URL` unset
- Persist catalog → clear in-memory → restore from Redis → verify all entries present
- TTL: write entry, expire key manually, reload → empty catalog (graceful)

#### Step 10 — Documentation & chaos runbook
- `proposals/rfc/RFC-035-resilient-service-components.md` (Step 1)
- `specs/035-resilient-service-components/contracts/heartbeat-endpoint.md`
- `specs/035-resilient-service-components/quickstart.md` — local dev setup (env vars, Redis container), smoke test commands, chaos runbook (4 restart scenarios with expected outcomes)
- `docs/architecture.md` — add heartbeat pattern and catalog durability section
- `CLAUDE.md` — update Recent Changes

---

## Testing Matrix (per Constitution §Service Testing Requirements)

| Component | Test tier | Ships with change? | Methods covered | Error paths covered |
|---|---|---|---|---|
| `RedisCatalogService` | Unit (ioredis-mock) | Yes | `load`, `save`, `register`, `deregister` | Redis ECONNREFUSED, missing key, malformed JSON |
| `RedisCatalogService` | Integration (real Redis) | Plan in same change; tests MAY land separately | Same | TTL expiry, connection retry |
| Heartbeat handler | Unit | Yes | Heartbeat 200/404, `lastSeenAt` update | Unknown agent, Redis write failure |
| Startup reconciliation | Unit | Yes | Ping-and-spawn pass | Agent ping failure → inactive (no spawn) |
| npc-agent reconnect | Unit | Yes | Consecutive failure counter, retry schedule | 5 failures → disconnect → backoff → reconnect |
| random-agent heartbeat client | Unit | Yes | Interval fire, session change detection | Heartbeat HTTP error (silent retry) |
| random-agent reconciliation | Unit | Yes | Roster diff, delta spawn | World API error, zero delta |

**Integration test gap**: `RedisCatalogService` integration tests require a live Redis instance. If CI does not have Redis available, the gap is explicitly documented here: `load()` round-trip and TTL expiry are uncovered by unit tests. Plan to add to CI once Redis sidecar or service is confirmed available (tracked in tasks.md).

---

## Complexity Tracking

No constitution violations requiring justification.

---

## Post-Design Constitution Re-Check

- ✅ RFC authored as first task (Principle I)
- ✅ Each package owns its own resilience behavior; no new cross-package deps (Principle II)
- ✅ Every Step has at least one independently demonstrable slice with a test or smoke command (Principle III)
- ✅ `POST /v1/catalog/:agentId/heartbeat` contract documented in `contracts/` before implementation (Principle IV)
- ✅ Heartbeat is infrastructure (health/liveness); MCP/A2A interface unchanged (Principle V)
- ✅ All work on feature branch with DCO sign-off (Principle VI)
