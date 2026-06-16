# Feature Specification: Ghost Agent Autospawning

**Feature Branch**: `032-ghost-autospawn`  
**Created**: 2026-06-16  
**Status**: Draft  

## Proposal Context *(mandatory)*

- **Related Proposal**: Builds on RFC-0009 (agent-host A2A), RFC-0028 (NPC agent), RFC-0029 (funder-into-NPC)
- **Scope Boundary**: (1) agent-host reconciliation on startup for any already-active live session; (2) random-agent self-managed roster via `GET /v1/roster` so it plugs into the existing `spawnRosterForAgent` machinery
- **Out of Scope**: Session creation/activation (handled by map-editor admin panel); adding new ghost types; changing the NPC character catalog format; persistent ghost state across session boundaries

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghosts appear after pod restart (Priority: P1)

An operator restarts agent-host (or any ghost agent pod) while a live session is already running. Currently the world is empty after restart. After this feature, ghosts reappear automatically within a minute of the pods becoming healthy.

**Why this priority**: Pod restarts are routine (deploys, node scale-downs). The world being empty after every restart is the most visible failure mode — it directly breaks the player experience with no manual recovery path available to end-users.

**Independent Test**: With an active live session running, restart the agent-host pod and observe that NPC characters and wanderers reappear in the Intermedium client without any manual intervention.

**Acceptance Scenarios**:

1. **Given** an active live session and running ghost sessions, **When** the agent-host pod restarts, **Then** within 60 seconds of becoming healthy all expected ghosts are re-spawned into the session
2. **Given** an active live session and a freshly deployed npc-agent pod, **When** npc-agent completes startup and registers with agent-host, **Then** agent-host spawns the full NPC roster without requiring a `spawn-trusted` API call
3. **Given** no active live session, **When** agent-host starts up, **Then** no spawn attempts are made and startup completes normally

---

### User Story 2 — Ghosts appear when a new session is activated (Priority: P1)

An operator activates a map session via the map-editor admin panel. All enabled NPC characters and the configured number of random wanderers appear in the world automatically.

**Why this priority**: Tied with P1 — this is the intended primary activation path. Every world fair session starts this way.

**Independent Test**: Start agent-host, npc-agent, and random-agent with no active session. Activate a session via the admin panel and observe that all ghosts appear in Intermedium without any further action.

**Acceptance Scenarios**:

1. **Given** all ghost agents running and registered, and no active session, **When** a session is activated, **Then** all NPC roster characters are spawned into the session
2. **Given** all ghost agents running and registered, and no active session, **When** a session is activated, **Then** 10 random wanderers (or the configured count) are spawned into the session
3. **Given** a session already has ghosts from a previous spawn, **When** the spawn is triggered again (e.g., by a second activation event), **Then** no duplicate ghosts are created

---

### User Story 3 — Wanderer count is operator-configurable (Priority: P2)

An operator can control how many random wanderers are spawned by setting an environment variable on the random-agent deployment, without code changes.

**Why this priority**: Different events (demo vs. world fair) need different ghost densities. Configuration via env var follows the pattern already used for other tunables in this system.

**Independent Test**: Deploy random-agent with `RANDOM_AGENT_COUNT=5`, activate a session, and confirm exactly 5 wanderers appear.

**Acceptance Scenarios**:

1. **Given** `RANDOM_AGENT_COUNT=5`, **When** the roster is spawned, **Then** exactly 5 wanderer ghosts appear
2. **Given** `RANDOM_AGENT_COUNT` is unset, **When** the roster is spawned, **Then** exactly 10 wanderer ghosts appear (default)
3. **Given** `RANDOM_AGENT_COUNT=0`, **When** the roster is requested, **Then** an empty roster is returned and no wanderers are spawned

---

### Edge Cases

- What happens if agent-host reconciliation runs before npc-agent has finished registering? → Reconciliation should retry or wait; npc-agent self-registers and agent-host already handles catalog propagation
- What if the world API is unreachable at agent-host startup? → Reconciliation attempt should fail gracefully and retry on next interval rather than crashing the process
- What if ghost provisioning fails for some characters but not others? → Already handled by `spawnRosterForAgent` — per-character success/failure is tracked independently
- What if a wanderer ghost with the same `wanderer-N` displayName already exists in the session? → The `ghostId already has an active session` check in `spawn` is idempotent; duplicate names are acceptable since ghostId uniqueness is what matters

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: agent-host MUST check for an active live session on startup, after catalog load and self-registration are complete
- **FR-002**: If an active session is found on startup, agent-host MUST call `spawnRosterForAgent` for every catalog entry with `rosterAgent: true` that has zero currently-running sessions
- **FR-003**: The startup reconciliation MUST be non-blocking — agent-host MUST finish starting and accept requests regardless of whether reconciliation succeeds or fails
- **FR-004**: random-agent MUST expose `GET /v1/roster` returning a list of N synthetic wanderer entries, where N is controlled by `RANDOM_AGENT_COUNT` (default 10)
- **FR-005**: Each roster entry returned by random-agent MUST include at minimum `characterId` (`wanderer-1` … `wanderer-N`) and `displayName`
- **FR-006**: The random-agent catalog entry in `catalog.json` MUST include `"rosterAgent": true` so the existing `spawnRosterForAgent` machinery handles it without changes to SupervisorService
- **FR-007**: The existing `world.session.start` event path in SupervisorService MUST continue to trigger roster spawning for both NPC and random-agent entries (no regression)
- **FR-008**: Reconciliation and event-driven spawning MUST both be idempotent — re-running when ghosts already exist MUST NOT create duplicates

### Interface Contracts

- **IC-001**: `GET /v1/roster` on random-agent MUST return the same schema as npc-agent's `/v1/roster`: `Array<{ characterId: string; displayName: string; background?: string }>`
- **IC-002**: SupervisorService's `spawnRosterForAgent` is the authoritative spawn path — neither agent should call world-api spawn endpoints directly

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an agent-host pod restart with an active session, all expected ghosts reappear within 60 seconds of the pod passing its readiness probe
- **SC-002**: After a new session is activated via the admin panel, all NPC characters and wanderers are visible in the Intermedium client within 60 seconds, with no operator API calls required
- **SC-003**: Zero duplicate ghost sessions are created across any combination of startup reconciliation and session-start event triggers
- **SC-004**: random-agent wanderer count matches `RANDOM_AGENT_COUNT` (or 10 if unset) in every observed spawn

## Assumptions

- The existing `spawnRosterForAgent` implementation in SupervisorService requires no changes — both improvements are purely additive
- A single active session is the normal operating state; the reconciliation logic handles the first active session found (consistent with how `demo.mjs` behaves)
- NPC character `.gram` files and the NPC catalog are unchanged by this feature
- The K8s deployment already has `RANDOM_AGENT_COUNT` available as an env var injection point (can be added to the random-agent Deployment manifest)
- `builtIn: false` catalog entries self-register; the reconciliation loop does not need to wait for them — it calls `spawnRosterForAgent` only for entries already present in the catalog at the time it runs

## Documentation Impact *(mandatory)*

- `deploy/k8s/ghosts/random-agent.yaml` — add `RANDOM_AGENT_COUNT` env var
- `CLAUDE.md` Recent Changes section — update after implementation
- `docs/architecture.md` — note the reconciliation pattern if open question on ghost lifecycle is documented there
