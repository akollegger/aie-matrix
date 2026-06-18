# Feature Specification: Resilient Service Components

**Feature Branch**: `035-resilient-service-components`
**Created**: 2026-06-18
**Status**: Draft

## Proposal Context *(mandatory)*

- **Related Proposal**: Follows operational diagnosis of frozen ghosts caused by cascading failures from agent-host restart (see conversation context: agent-host pod restart at 12:36 caused catalog loss, NPC MCP session breakage, and random-agent orphaned ghost tasks)
- **Scope Boundary**: Resilience improvements to four existing services — `agent-host`, `npc-agent`, `random-agent`, and the server's Colyseus world room — so each tolerates independent restarts of the others without operator intervention
- **Out of Scope**: New agent types, new session mechanics, changes to the map format, changes to the A2A protocol interface, multi-region or active-active clustering

## Clarifications

### Session 2026-06-18

- Q: Who owns the spawn/no-spawn decision when random-agent re-registers after an agent-host restart — agent-host or random-agent? → A: Two paths exist. (1) Startup reconciliation: agent-host calls `spawnRosterForAgent`, which fetches `/v1/roster` from the agent and provisions ghosts idempotently — "ghost already active" is a no-op. (2) Heartbeat path: agent-host responds with session state; random-agent queries the world API for pre-existing ghost IDs and spawns only the missing delta. Path 1 handles cold restarts; path 2 handles the case where agent-host restarted but random-agent's ghosts are still live in the world.
- Q: Should heartbeat reuse the existing registration endpoint or be a separate endpoint? → A: Separate `POST /v1/catalog/:agentId/heartbeat` endpoint. Matches existing Barnacle heartbeat pattern; registration is expensive (fetches agent card, validates, stores) while heartbeat must be lightweight (~100 bytes vs ~2KB). Consul, Kubernetes, and the codebase's own Barnacle pattern all use separate endpoints. Agent-host responds with current session state so agents can self-trigger roster reconciliation.
- Q: What storage backend should agent-host use for the durable catalog? → A: Redis (already deployed per spec-016, used by world-api for pub/sub). Hash per agent ID with TTL for stale-entry cleanup. Agent-host adds `ioredis` client (already a workspace dep); no new infrastructure required.
- Q: Does each npc-agent ghost have its own MCP session, or is there one shared connection? → A: One shared MCP connection for all ghosts. Per-ghost tick loop state (running/paused) tracked in-process; reconnect heals all ghosts simultaneously.
- Q: Should random-agent discard stale A2A task IDs on re-registration (clean slate) or handle per-task `task-not-found` responses defensively? → A: Per-task detection — discard and re-initiate any task ID that receives a `task-not-found` response, regardless of whether re-registration occurred. Handles all causes of stale IDs, not just agent-host restarts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — NPC ghosts resume movement after any service restart (Priority: P1)

An operator restarts any single pod in the cluster (agent-host, npc-agent, server, or random-agent). Within a short recovery window, NPC ghosts visible in the Intermedium client are moving again without manual intervention.

**Why this priority**: The most user-visible symptom — frozen ghosts make the world look dead. Operators should be able to restart any pod without triggering a manual recovery sequence.

**Independent Test**: Restart the `npc-agent` pod. Observe that within 90 seconds, the three NPC ghost entities resume position updates in the Intermedium client.

**Acceptance Scenarios**:

1. **Given** npc-agent is running with active MCP sessions, **When** the `server` pod is restarted, **Then** npc-agent detects the broken MCP sessions, reconnects with backoff, and resumes ghost ticks within 90 seconds
2. **Given** npc-agent is running with active MCP sessions, **When** the `npc-agent` pod itself is restarted, **Then** it re-registers with agent-host and resumes ghost ticks within 90 seconds of the pod becoming ready
3. **Given** npc-agent is running, **When** MCP calls fail repeatedly (5+ consecutive errors for one ghost), **Then** that ghost's tick loop pauses and retries with exponential backoff rather than generating continuous error logs

---

### User Story 2 — Random wanderer ghosts reappear after agent-host restart (Priority: P1)

After `agent-host` is restarted (e.g. due to a deploy or pod eviction), the random wanderer ghosts that were previously visible return to the map without operator intervention.

**Why this priority**: The autospawn mechanism (032) is rendered ineffective if agent-host losing its ephemeral catalog means wanderers never respawn.

**Independent Test**: Restart the `agent-host` pod while `random-agent` is running. Within 3 minutes, random wanderer ghosts are visible and moving in the Intermedium client.

**Acceptance Scenarios**:

1. **Given** random-agent is registered with agent-host and has active wanderer ghosts, **When** agent-host is restarted, **Then** random-agent re-registers within one heartbeat interval (≤60 seconds); random-agent queries the world API for its existing ghosts and spawns only those missing from the active session
2. **Given** agent-host has restarted and has an empty catalog, **When** random-agent's periodic heartbeat fires, **Then** agent-host treats it as a fresh registration and notifies random-agent of the active session; random-agent owns the decision to spawn
3. **Given** random-agent's A2A push notifications are failing with connection errors, **When** agent-host becomes reachable again, **Then** random-agent resumes successful push delivery without requiring a restart

---

### User Story 3 — Agent catalog survives agent-host restarts (Priority: P2)

Agent registrations are not lost when agent-host restarts. On startup, agent-host restores the last-known catalog and immediately attempts to verify which agents are still reachable.

**Why this priority**: Durable catalog eliminates the race condition where the 120-second passive-wait window expires before agents re-register — especially critical if agents have long tick intervals.

**Independent Test**: Register npc-agent and random-agent, then restart agent-host. Immediately after it becomes ready, query the agent-host catalog endpoint and confirm both agents are listed (even if marked as unverified/pending).

**Acceptance Scenarios**:

1. **Given** two agents are registered, **When** agent-host is restarted, **Then** the catalog endpoint returns both agents within 5 seconds of pod readiness — before any heartbeat has fired
2. **Given** agent-host restores a catalog entry for an agent, **When** that agent's health check fails (pod is down), **Then** the entry is marked inactive rather than removed, so it re-activates when the agent returns
3. **Given** agent-host restores a catalog entry for a `rosterAgent`, **When** a live session is found on startup AND the agent health check passes, **Then** agent-host notifies the agent of the active session; the agent decides whether to spawn based on its own roster reconciliation

---

### User Story 4 — Graceful degradation with visible status (Priority: P3)

When a dependent service is unavailable, each service continues operating at reduced capacity and logs structured events that make the degraded state observable, rather than silently failing or crashing.

**Why this priority**: Operators need to distinguish "working normally" from "degraded but recovering" from "stuck permanently" — currently all three look the same in logs.

**Independent Test**: Shut down agent-host while npc-agent is running. Confirm npc-agent logs show a structured `degraded` event (not just repeated error lines), continues its internal state machine, and logs a `recovered` event when agent-host returns.

**Acceptance Scenarios**:

1. **Given** npc-agent cannot reach the MCP server, **When** the backoff retry limit is not yet reached, **Then** logs show a single structured `degraded` event per ghost rather than one error line per tick
2. **Given** random-agent's push notifications are failing, **When** agent-host becomes reachable, **Then** logs show a `recovered` event and normal push delivery resumes
3. **Given** any service is in a degraded state, **When** an operator queries the service's health endpoint, **Then** the response reflects the degraded status (not a generic 200 OK)

---

### Edge Cases

- What happens if agent-host restarts multiple times within a single heartbeat interval? (Re-registrations must be idempotent — no duplicate ghost spawns)
- What happens if an agent registers but the session has ended between catalog restore and spawn? (Spawn should be skipped; catalog entry stays valid)
- What if random-agent's wanderer ghosts are still present in the world state from a previous run when it re-registers? (Reconciliation should detect and not double-spawn)
- What if the MCP reconnect backoff is in progress when the pod's liveness probe fires? (Backoff must not block the HTTP health endpoint)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each agent service MUST re-register with agent-host on a periodic heartbeat (≤60 second interval), independent of startup registration
- **FR-002**: agent-host MUST persist the agent catalog to durable storage (not `/tmp`) so registrations survive pod restarts
- **FR-003**: On startup, agent-host MUST restore the catalog from durable storage before beginning the reconciliation pass
- **FR-004**: On startup with a restored catalog, agent-host MUST health-check each known agent and, for any reachable `rosterAgent` entry when a session is active, call `spawnRosterForAgent` — which fetches `/v1/roster` from the agent and provisions ghosts idempotently ("ghost already has active session" is treated as success). This path applies only at startup; the heartbeat path (FR-001, IC-001) notifies the agent of session state and the agent self-reconciles.
- **FR-005**: npc-agent MUST detect broken per-ghost MCP connections and attempt reconnection per ghost with exponential backoff (starting at 2s, capping at 60s); each ghost has its own MCP client and reconnects independently
- **FR-006**: npc-agent MUST pause a ghost's tick loop when that ghost's MCP connection is broken and resume it once reconnected, rather than generating an error per tick for that ghost
- **FR-007**: random-agent MUST detect consecutive push-notification failures to agent-host and enter a reconnect state, retrying delivery once connectivity is restored
- **FR-007a**: random-agent MUST detect `task-not-found` responses from agent-host per push attempt, immediately discard that task ID, and re-initiate the task — this handles stale task IDs from any agent-host restart without requiring a full re-registration cycle
- **FR-008**: random-agent MUST reconcile its active ghost roster after re-registration: query the world API to detect its own pre-existing ghost IDs in the active session, and spawn only the missing remainder rather than a full new roster
- **FR-009**: agent-host re-registration MUST be idempotent — repeated registrations from the same agent update the catalog entry and notify the agent of the active session; the spawn/no-spawn decision belongs to the agent, not agent-host
- **FR-010**: Each service health endpoint MUST reflect degraded status when a critical dependency is unreachable, not return a generic healthy response
- **FR-011**: Degraded-state log events MUST be structured (machine-readable) and emitted once per state transition, not once per failed operation

### Key Entities

- **Agent Catalog Entry**: Represents a registered agent; includes agent ID, base URL, `rosterAgent` flag, last-seen timestamp, health status (active / inactive / unverified)
- **Ghost Roster**: The set of ghost IDs owned by an agent within a session; owned and reconciled by the agent itself — agent-host is not authoritative on roster state
- **MCP Session**: One `GhostMcpClient` instance per ghost in npc-agent, stored in a module-level `mcpByGhostId` map. Each has its own lifecycle (connected / reconnecting / failed). Ghost tick loops are paused and resumed per-ghost independently; one broken connection does not affect other ghosts.
- **Heartbeat**: A periodic re-registration message from an agent to agent-host that also serves as a liveness signal

### Interface Contracts

- **IC-001**: Agent liveness MUST use a dedicated `POST /v1/catalog/:agentId/heartbeat` endpoint, separate from registration (`POST /v1/catalog/register`). Heartbeat payload is minimal (`{agentId, ts}`); registration carries the full agent card. This matches the existing Barnacle heartbeat pattern and the Consul/Kubernetes convention of separating registration from liveness. agent-host updates `lastSeenAt` on heartbeat and may notify the agent of current session state in the response.
- **IC-002**: The agent-host catalog restore MUST be transparent to agents — no changes required to agent registration payloads or workflows
- **IC-003**: The world API ghost-roster query used by random-agent reconciliation MUST be an existing endpoint (no new server API required for MVP)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any single pod restart, the world resumes normal ghost activity (NPCs moving, wanderers present) within 3 minutes without operator intervention
- **SC-002**: Agent-host catalog is populated within 5 seconds of pod readiness (from durable restore), eliminating the 120-second passive-wait window
- **SC-003**: NPC ghost tick errors during MCP reconnection are reduced from one error per tick interval to one structured event per state transition (>95% reduction in error log volume during degraded periods)
- **SC-004**: Zero duplicate ghost spawns occur when an agent re-registers with agent-host after an agent-host restart
- **SC-005**: Each service health endpoint correctly reports degraded status within 10 seconds of a critical dependency becoming unreachable

## Assumptions

- Durable catalog storage will use an existing infrastructure component already available in the cluster (Redis, which is already deployed per spec-016); no new storage backend is introduced
- A new lightweight `POST /v1/catalog/:agentId/heartbeat` endpoint will be added to agent-host; the existing registration endpoint (`POST /v1/catalog/register`) is not reused for heartbeats to avoid triggering registration side-effects on every beat
- The Colyseus world room's ghost roster is queryable via the existing world HTTP API, sufficient for random-agent reconciliation
- Heartbeat interval of 30 seconds is acceptable latency for re-registration after agent-host restart; sub-30s recovery is not required for this feature
- A2A task IDs are treated as expired on a per-task basis when agent-host returns `task-not-found`; random-agent discards and re-initiates that specific task immediately rather than waiting for re-registration

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update to document catalog durability requirement and heartbeat pattern
- `CLAUDE.md` — update "Recent Changes" section when implemented
- `deploy/staging/` — update any relevant health probe configuration if liveness/readiness probes are modified
