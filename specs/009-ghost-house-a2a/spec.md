# Feature Specification: Ghost House A2A Coordination

**Feature Branch**: `009-ghost-house-a2a`  
**Created**: 2026-04-24  
**Status**: Draft  
**Input**: Ghost agents collaborating and coordinating through the Ghost House over A2A

## Proposal Context *(mandatory)*

- **Related Proposal**: [ADR-0004: A2A as the Ghost Agent Protocol](../../proposals/adr/0004-a2a-ghost-agent-protocol.md) · [RFC-0007: Ghost House Architecture](../../proposals/rfc/0007-ghost-house-architecture.md)
- **Scope Boundary**: Build the canonical ghost house service — A2A host, MCP proxy, Colyseus bridge, agent supervisor, and catalog — so that ghost agents can be registered, spawned, supervised, and fed world events. Covers all three behavioral tiers (Wanderer, Listener, Social) across three delivery phases. ADR-0004 and RFC-0007 are the authoritative design documents; implementation must stay synced with them, and significant deviations require explicit approval before merging.
- **Out of Scope**: Ghost agent authentication and credential issuance beyond the Phase 1 static dev token (deferred to a follow-up ADR); multi-house federation; agent sandbox / container hosting for contributors without public endpoints; telemetry stack selection (open question in `docs/architecture.md`); quest mechanics beyond what MCP tools already expose.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Contributor ships a Wanderer agent (Priority: P1)

A third-party contributor implements a Wanderer-tier ghost agent (MCP only: random or rule-based movement, no social behavior), registers it with the ghost house catalog, and sees it running as a live ghost in the Matrix world.

**Why this priority**: This is the minimum viable contribution path. It validates the full loop — catalog registration, spawn, MCP proxy forwarding, agent supervision — without requiring the Colyseus bridge. It is the baseline every other tier builds on.

**Independent Test**: Register the reference `random-agent` with the ghost house catalog, assign it to a ghost, and confirm the ghost moves autonomously in the world. Delivers a live ghost without any other tier being built.

**Acceptance Scenarios**:

1. **Given** a ghost house running with an empty catalog, **When** a contributor POSTs a valid agent card (with `matrix` extension, `tier: "wanderer"`) to the catalog registration endpoint, **Then** the agent card is stored and retrievable from the catalog.
2. **Given** a registered Wanderer agent, **When** the ghost house spawns it for an adopted ghost, **Then** the agent receives its spawn context (ghost id, world entry point) and begins emitting `go` actions via MCP.
3. **Given** a running Wanderer agent, **When** the ghost's assigned agent crashes, **Then** the agent supervisor restarts it within the configured retry policy (exponential backoff, max 5 retries per hour).
4. **Given** a running Wanderer agent, **When** the TCK conformance suite runs against it, **Then** all Wanderer-tier tests pass.
5. **Given** the `random-agent` reference implementation, **When** evaluated against the Wanderer TCK, **Then** all tests pass and it serves as a valid onboarding baseline.

---

### User Story 2 — Ghost receives world events (Priority: P2)

A Listener-tier ghost agent is registered with the ghost house and receives translated world events — proximity changes, incoming messages, quest triggers — pushed to it from the Colyseus bridge via A2A.

**Why this priority**: Enables reactive behavior. Without event delivery, agents are blind to the world. This tier unlocks observation agents (research probes, dashboard feeds, NPC witnesses) and is the prerequisite for Social agents.

**Independent Test**: Register a Listener agent that logs all received A2A events. Trigger a `message.new` event in the world (a partner sends a message to the ghost). Confirm the agent's event log contains the translated event. No `say` output required.

**Acceptance Scenarios**:

1. **Given** a Listener agent registered in the ghost house catalog, **When** another participant in the world sends a message to the ghost, **Then** the Colyseus bridge translates the event and the A2A host pushes it to the agent within observable latency.
2. **Given** a Listener agent with an active A2A stream, **When** the ghost enters proximity of another ghost in the world, **Then** the agent receives a proximity notification event.
3. **Given** a Listener agent, **When** a quest trigger fires for the ghost's location, **Then** the agent receives the translated quest notification.
4. **Given** a Listener agent, **When** the TCK conformance suite runs against it, **Then** all Listener-tier tests pass (including positive confirmation that the agent does *not* emit `say` actions, making non-speech a testable property).

---

### User Story 3 — Ghost speaks and converses (Priority: P3)

A Social-tier ghost agent receives world events and responds by emitting `say` actions via A2A, which the Colyseus bridge routes into the world as conversation records — visible to nearby ghosts and their human partners.

**Why this priority**: Enables the signature ghost behavior: two-way conversation between ghosts and with human attendees. This is the full social loop and requires the complete ghost house pipeline.

**Independent Test**: Deploy a Social agent that echoes received messages back as `say` responses. Send a message to the ghost from a partner. Confirm the echo appears in the world's conversation log. Validates both inbound (Colyseus bridge → A2A) and outbound (A2A `say` → Colyseus bridge) paths.

**Acceptance Scenarios**:

1. **Given** a Social agent receiving a `message.new` event, **When** the agent emits a `say` action via A2A, **Then** the Colyseus bridge routes the speech into the world as a conversation record attributed to the ghost.
2. **Given** a ghost in a Social conversation, **When** a partner sends a message, **Then** the agent receives it as a `message.new` event with `role: "partner"` and `priority: PARTNER`, matching the conversation model from RFC-0005.
3. **Given** two Social agents in proximity, **When** one emits a `say` action, **Then** the other receives a `message.new` event containing the speech.
4. **Given** a Social agent, **When** the TCK conformance suite runs against it, **Then** all Social-tier tests pass.

---

### User Story 4 — Core team operates the ghost house reliably (Priority: P2)

The core team can deploy, configure, and observe the ghost house as a single service that manages all spawned agents, enforces tier conformance, and survives agent failures without manual intervention.

**Why this priority**: Operational reliability is required before any contributed agents run at the event. The ghost house is a single point of failure and must operate autonomously for the duration of AIEWF 2026.

**Independent Test**: Start the ghost house with two agents registered (one Wanderer, one Social). Kill one agent process. Confirm the supervisor detects the failure, attempts restarts per the retry policy, and logs the event. The other agent continues unaffected.

**Acceptance Scenarios**:

1. **Given** the ghost house is running, **When** a health check ping to a spawned agent times out (30s), **Then** the supervisor marks the agent unhealthy, begins restart with exponential backoff, and logs the failure.
2. **Given** an agent that has exceeded 5 restarts in an hour, **When** it fails again, **Then** the supervisor stops retrying and marks the agent permanently failed until operator intervention.
3. **Given** a ghost that is released (adoption ends), **When** the ghost house initiates shutdown for its agent, **Then** the agent receives a graceful cancellation and is hard-killed after 10 seconds if it does not comply.
4. **Given** the ghost house catalog, **When** a new agent card is published with a `matrix.tier` that does not match the declared A2A capabilities, **Then** the catalog rejects the registration with a descriptive error.

---

### Edge Cases

- What happens when a spawned agent's endpoint becomes unreachable mid-session (network partition, NAT timeout)?
- How does the MCP proxy handle a world server restart while agents are active?
- What happens when two contributors register agents with the same name?
- How does the Colyseus bridge behave if it falls behind on event fanout (slow agent, burst of events)?
- What happens when an agent sends a `say` action but the ghost has no active proximity context in Colyseus?
- How does the ghost house handle a Wanderer agent that accidentally sends A2A `say` actions it is not supposed to emit?

## Requirements *(mandatory)*

### Functional Requirements

**Catalog Service**

- **FR-001**: The ghost house MUST expose a catalog registration endpoint that accepts A2A agent cards with a valid `matrix` extension object.
- **FR-002**: The catalog MUST validate that an agent card's `matrix.tier` is one of `"wanderer"`, `"listener"`, or `"social"` and that the declared A2A capabilities are consistent with the claimed tier.
- **FR-003**: The catalog MUST store registered agent cards in a file-backed persistent store so that contributed agents survive ghost house restarts.
- **FR-004**: The catalog MUST serve the full list of registered agents so that ghost assignment tooling can present available choices.

**A2A Host**

- **FR-005**: The A2A host MUST implement A2A protocol v0.3.0, including streaming (SSE) for long-running autonomous agent sessions and push notifications for event delivery to Listener and Social agents.
- **FR-006**: The A2A host MUST use the non-blocking send pattern (start task, then call `setTaskPushNotificationConfig`) when delivering push notifications, per the validated pattern from spike-008.
- **FR-007**: For Phase 1, the A2A host MUST accept a static bearer token (`GHOST_HOUSE_DEV_TOKEN`) for both inbound (agent → house) and outbound (house → agent) authentication. This mechanism MUST be disabled outside localhost deployments.

**MCP Proxy**

- **FR-008**: The MCP proxy MUST re-expose the world server's MCP tools (`whereami`, `look`, `exits`, `go`, inventory tools) to spawned agents without requiring agents to hold direct world server credentials.
- **FR-009**: The MCP proxy MUST forward agent MCP calls to the world server using ghost-scoped credentials, so that world state mutations are attributed to the correct ghost.
- **FR-010**: The MCP proxy MUST validate that an agent only calls tools declared in its `matrix.requiredTools` and reject calls to undeclared tools.

**Colyseus Bridge**

- **FR-011**: The Colyseus bridge MUST translate Colyseus world events (`message.new`, proximity changes, quest triggers, session notifications) into A2A events and deliver them to the relevant spawned agent.
- **FR-012**: The Colyseus bridge MUST route `say` actions received from Social agents via A2A outbound to Colyseus as conversation records attributed to the ghost.
- **FR-013**: Incoming partner messages MUST arrive at Social agents as A2A `message.new` events with `role: "partner"` and `priority: PARTNER`, consistent with RFC-0005.

**Agent Supervisor**

- **FR-014**: The agent supervisor MUST spawn a registered agent when a ghost adopts it: resolve the agent card, validate capability requirements, provision a ghost-scoped token, initialize the agent with spawn context, and subscribe to Colyseus events.
- **FR-015**: The agent supervisor MUST perform periodic health checks (A2A ping) with a 30-second timeout and initiate restart on failure.
- **FR-016**: Restart policy MUST use exponential backoff and cap at 5 retries per hour before declaring the agent permanently failed.
- **FR-017**: On ghost release, the supervisor MUST send graceful cancellation to the agent and hard-kill after 10 seconds if the agent does not terminate.
- **FR-018**: The supervisor MUST enforce per-agent rate limits on action emission to protect the world server from agent runaway.

**TCK Conformance**

- **FR-019**: The project MUST include a TCK (Test Conformance Kit) with independent test suites for each behavioral tier (Wanderer, Listener, Social).
- **FR-020**: The `random-agent` reference implementation MUST pass the full Wanderer TCK and serve as the onboarding baseline for third-party contributors.

**Design Document Sync**

- **FR-021**: All implementation decisions that deviate from ADR-0004 or RFC-0007 MUST be documented in the relevant proposal file before the change is merged. Significant deviations (protocol choice, component boundaries, tier definitions) MUST receive explicit approval.

### Key Entities

- **Ghost House**: The single canonical service that hosts ghost agents; exposes A2A host, MCP proxy, Colyseus bridge, agent supervisor, and catalog as internal components.
- **Agent Card**: The registration record for a ghost agent; standard A2A agent card fields plus a `matrix` extension object declaring tier, ghost classes, required tools, memory kind, LLM provider, and author attribution.
- **Ghost Agent**: An autonomous agent contributed by the core team or a third party; implements MCP only (Wanderer), MCP + A2A receive (Listener), or MCP + A2A full (Social).
- **Behavioral Tier**: One of three conformance levels (Wanderer, Listener, Social) that determines which protocols an agent must implement and what the TCK validates.
- **Spawned Agent Instance**: A live agent process or endpoint actively running on behalf of a specific ghost; managed by the agent supervisor.
- **World Event**: A Colyseus-sourced notification (message, proximity change, quest trigger, session) translated by the Colyseus bridge into an A2A event.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-001**: Agent card schema — standard A2A agent card plus `matrix` extension object as specified in RFC-0007 §Agent Card Schema. `matrix.schemaVersion` = 1 for this feature. Breaking changes to the `matrix` shape bump `schemaVersion`.
- **IC-002**: A2A protocol v0.3.0 — all house↔agent communication uses this version. Protocol version declared in `A2A-Version` header and in agent cards' `protocolVersion` field.
- **IC-003**: MCP tool set exposed by the MCP proxy — `whereami`, `look`, `exits`, `go`, inventory tools. Agents declare required tools via `matrix.requiredTools`; the proxy validates availability at spawn.
- **IC-004**: World event envelope — the A2A event payload format for translated Colyseus events (`message.new`, proximity, quest, session). Format validated by spike-008 (IC-008 envelope); must be canonicalized in the ghost house implementation guide.
- **IC-005**: Catalog HTTP API — registration, listing, and spawn endpoints. Spike-008 used `/v1/catalog/register`, `/v1/catalog`, `/v1/catalog/spawn/:agentId` as non-normative placeholders; these paths MUST be canonicalized before Phase 1 ships.
- **IC-006**: Spawn context payload — the initialization message sent by the house to an agent at spawn (ghost id, ghost card, world entry point, ephemeral token scope).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A third-party contributor following the contribution guide can register a Wanderer-tier agent and see it running as a live ghost in the world within 30 minutes of reading the guide.
- **SC-002**: The ghost house delivers world events to Listener and Social agents with end-to-end latency low enough that ghost reactions feel responsive to human observers in the world.
- **SC-003**: A crashed agent is detected and restarted without human intervention, with the ghost's presence restored in the world within the supervisor's retry window.
- **SC-004**: 100% of Wanderer TCK tests pass for the `random-agent` reference implementation at Phase 1 completion.
- **SC-005**: 100% of Listener TCK tests pass for the example `observer-agent` at Phase 2 completion.
- **SC-006**: 100% of Social TCK tests pass for the first contributed Social-tier agent at Phase 3 completion.
- **SC-007**: The ghost house operates continuously across the AIEWF 2026 event duration without requiring manual restarts of the host service itself.
- **SC-008**: ADR-0004 and RFC-0007 accurately reflect the shipped implementation at each phase boundary — no undocumented deviations remain open.

## Assumptions

- Phase 1 contributors provide a reachable localhost endpoint; public HTTPS endpoints are required for Phase 2/3 external contributors.
- The world server (Colyseus) and its MCP tools are available and stable before ghost house development begins; the ghost house builds on top of the existing MCP wire protocol from ADR-0001.
- A2A protocol v0.3.0 (as shipped in `@a2a-js/sdk`) is sufficiently stable for the AIEWF 2026 timeline; a v1.0 upgrade is tracked but not planned for this feature.
- Authentication beyond the static dev token is out of scope; no external contributor deployments are permitted until the auth ADR is resolved.
- File-backed catalog persistence is sufficient for the weekend-event scope; a database is not required.
- Colyseus schema changes that break the ghost house bridge require coordination with the world server team; the bridge is an internal implementation detail not exposed to contributed agents.
- The `random-agent` reference implementation ships with the core project and is maintained by the core team.

## Documentation Impact *(mandatory)*

- **ADR-0004** (`proposals/adr/0004-a2a-ghost-agent-protocol.md`) — MUST be updated when any implementation decision differs from the ADR's stated decision or consequences. Significant deviations require approval before merge.
- **RFC-0007** (`proposals/rfc/0007-ghost-house-architecture.md`) — MUST be updated when component boundaries, interfaces, HTTP paths, capability manifest, or the agent card schema are changed from the RFC draft. Open questions in §Open Questions MUST be resolved and struck or answered as implementation proceeds.
- Ghost house integration guide — MUST document the push-notification invariant (non-blocking send required), the `GHOST_HOUSE_DEV_TOKEN` restriction, the canonicalized catalog HTTP paths, and the world event envelope format.
- Contributing guide for ghost agents — MUST be updated to reflect the finalized agent card schema, tier definitions, and TCK invocation instructions.
- `CLAUDE.md` — MUST be updated with the ghost house package and its technology stack under Recent Changes when the package ships.
