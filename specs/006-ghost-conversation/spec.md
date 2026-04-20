# Feature Specification: Ghost Conversation Mechanics

**Feature Branch**: `006-ghost-conversation`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: Ghost conversation mechanics as defined in RFC-0005 and ADR-0003

## Proposal Context *(mandatory)*

- **Related Proposals**: [`proposals/rfc/0005-ghost-conversation-model.md`](../../proposals/rfc/0005-ghost-conversation-model.md) (authoritative design), [`proposals/adr/0003-conversation-server.md`](../../proposals/adr/0003-conversation-server.md) (authoritative architecture decision)
- **Scope Boundary**: The `server/conversation/` package (notification bridge + conversation store), the `say` MCP tool in `server/world-api/`, Colyseus signal delivery, and the HTTP endpoints that ghost house services use to read message history for their registered ghost instances.
- **Out of Scope**: Memory modules, information decay, social graph recording, variable cluster radius ("shouting"), Neo4j store implementation, proximity event signals (`ghost.entered_cluster`, `ghost.left_cluster`), and any ghost behavior beyond issuing `say`.

> **Tight coupling notice**: This specification is intentionally synchronized with RFC-0005 and ADR-0003. Any deviation between this document and those proposals is a defect and must be discussed before implementation proceeds. The proposals are the authoritative source of truth; this document translates them into testable requirements.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghost Enters Conversation and Broadcasts a Message (Priority: P1)

A ghost agent navigates to a location, checks who is nearby via `look`, and issues a `say` command. This transitions the ghost from normal state to **conversational mode**: movement is suspended and the ghost begins broadcasting on its thread. All ghosts currently within the speaker's 7-cell H3 cluster receive a `message.new` Colyseus signal. The signal carries only identifiers (`thread_id`, `message_id`). Any ghost that wants the content fetches it from the conversation store. The full message record — including who could hear it — is durably persisted.

**Why this priority**: This is the foundational primitive. Without it, ghosts cannot communicate; all conference experience goals (sessions, hallway exchanges, vendor interactions) are blocked.

**Independent Test**: A ghost with two nearby ghosts issues `say "hello"`. The ghost enters conversational mode. The two nearby ghosts each receive a `message.new` signal. The message record is readable from the store. Movement commands are rejected until `bye` is issued.

**Acceptance Scenarios**:

1. **Given** a ghost in normal state is at cell C with two other ghosts in cells within `{C} ∪ neighbors(C)`, **When** the ghost issues `say { content: "hello" }`, **Then** the ghost enters conversational mode, both nearby ghosts receive a Colyseus `message.new` signal with `{ thread_id: <ghost_id>, message_id: <ulid> }`, and movement commands are rejected.
2. **Given** the same `say` call, **Then** a JSONL record is appended to the store with all required fields: `thread_id`, `message_id`, `timestamp`, `role`, `name`, `content`, `mx_tile`, and `mx_listeners` listing both nearby ghosts.
3. **Given** a ghost already in conversational mode, **When** the ghost issues another `say`, **Then** the ghost remains in conversational mode, a new signal is sent to whoever is currently in the cluster, and a new record is persisted.
4. **Given** no other ghosts are within the speaker's cluster, **When** the ghost issues `say`, **Then** the message is still persisted and no signals are sent (empty `mx_listeners`).
5. **Given** a ghost at a pentagon cell (5 neighbors instead of 6), **When** the ghost issues `say`, **Then** the cluster is computed correctly as 6 cells and `say` succeeds normally.

---

### User Story 2 — Ghost Ends a Conversation (Priority: P2)

A ghost in conversational mode finishes speaking and issues `bye`. The engine returns the ghost to normal state, re-enabling movement and all other actions. The conversation record is complete in the store and remains readable.

**Why this priority**: `bye` is the only exit from conversational mode. Without it a ghost would be permanently suspended after its first `say`. It is a direct dependency of User Story 1.

**Independent Test**: A ghost issues `say`, confirms it is in conversational mode and cannot move, issues `bye`, then successfully issues a movement command.

**Acceptance Scenarios**:

1. **Given** a ghost in conversational mode, **When** the ghost issues `bye`, **Then** the ghost returns to normal state and movement commands are accepted.
2. **Given** a ghost in normal state, **When** the ghost issues `bye`, **Then** the command is accepted as a no-op and the ghost remains in normal state.
3. **Given** a ghost that has returned to normal state after `bye`, **When** the ghost issues `say` again, **Then** the ghost re-enters conversational mode and the new message is appended to the same persistent thread.

---

### User Story 3 — Ghost House Monitors Ghost Conversation History (Priority: P3)

A ghost house is an external service that operates multiple ghost instances, each paired with a single IRL user. It needs to read conversation history for any of its registered ghost instances — to update ghost goals, inform agent strategy, or relay context back to the IRL user — without requiring a live Colyseus connection. It authenticates with its registered API key and queries the conversation store over HTTP, specifying a `ghost_id` for each instance it wants to inspect.

**Why this priority**: Ghost house autonomy depends on async access to conversation history per ghost instance. Without it, a ghost house cannot build strategies, react to what a ghost heard, or surface information back to the IRL user it represents.

**Independent Test**: After ghost instance A and ghost instance B (both operated by the same ghost house) have each issued `say` commands, the ghost house calls `GET /threads/{ghost_id_A}` and `GET /threads/{ghost_id_B}` with its single API key and receives the correct records for each. No Colyseus connection is required.

**Acceptance Scenarios**:

1. **Given** a ghost instance has sent five messages, **When** its ghost house calls `GET /threads/{ghost_id}` with a valid API key, **Then** the response contains all five message records in chronological order.
2. **Given** a known `message_id`, **When** the ghost house calls `GET /threads/{ghost_id}/{message_id}` with a valid API key, **Then** the response returns exactly that record.
3. **Given** an invalid or missing API key, **When** the ghost house calls either endpoint, **Then** the request is rejected with an authorization error.
4. **Given** a ghost house operates two ghost instances, **When** it calls `GET /threads/{ghost_id}` for each using the same API key, **Then** both calls succeed and return the correct records for their respective instances.
5. **Given** a large thread, **When** the ghost house calls `GET /threads/{ghost_id}?after={message_id}&limit={n}`, **Then** the response returns at most `n` records newer than `message_id`, enabling "fetch since last seen" pagination.
6. **Given** a server restart occurred, **When** the ghost house calls `GET /threads/{ghost_id}`, **Then** all messages written before the restart are still returned (persistence survives restart).

---

### User Story 4 — Developer Exercises Conversation from ghost-cli (Priority: P4)

A developer runs the ghost-cli to directly operate a ghost during development or debugging. They issue `say` to enter conversational mode, observe the state change reflected in the CLI (movement commands are rejected with a clear message), send additional messages, and issue `bye` to return to normal state. The CLI provides unambiguous feedback on each state transition.

**Why this priority**: The ghost-cli is the primary hands-on tool for exercising and debugging the conversation feature in isolation. Without CLI support, the only way to drive `say` and `bye` is through a full ghost house integration, which significantly slows development iteration. It also serves as the reference implementation for how conversation state should surface in any UI.

**Independent Test**: A developer with a running ghost-cli session issues `say "hello world"`, observes a conversational mode indicator, attempts a movement command (sees a clear rejection), issues `bye`, then successfully issues a movement command. Full round-trip validated without a ghost house.

**Acceptance Scenarios**:

1. **Given** a ghost-cli session with a ghost in normal state, **When** the developer issues `say "hello"`, **Then** the CLI confirms the transition to conversational mode with a visible state indicator and reports the message was broadcast.
2. **Given** a ghost in conversational mode via ghost-cli, **When** the developer attempts a movement command, **Then** the CLI displays an error indicating the ghost is in conversational mode and must issue `bye` first.
3. **Given** a ghost in conversational mode, **When** the developer issues `bye`, **Then** the CLI confirms the return to normal state and subsequent movement commands succeed.
4. **Given** a ghost in conversational mode, **When** the developer issues another `say`, **Then** the new message is broadcast and the CLI confirms it was sent without changing state.

---

### User Story 5 — Ghost Moves Through a Cluster (Priority: P5)

As ghosts move around the conference world, cluster membership is evaluated per message. A ghost within the speaker's cluster at the moment `say` is processed receives a `message.new` notification for that message. One that has moved out since the last `say` does not. There is no persistent subscription — membership is a point-in-time snapshot, computed each time the speaker issues `say`.

**Why this priority**: Spatial auto-subscribe is what makes conversation emergent rather than explicit. Without it, ghosts would have to manage subscriptions manually, which contradicts the design intent.

**Independent Test**: Ghost A and Ghost B start in different clusters. Ghost B moves into Ghost A's cluster. Ghost A issues `say`. Ghost B receives the signal. Ghost B moves out. Ghost A issues `say` again. Ghost B does not receive the signal. Fully self-contained.

**Acceptance Scenarios**:

1. **Given** Ghost B is outside Ghost A's cluster, **When** Ghost A issues `say`, **Then** Ghost B does not receive a `message.new` signal and is not listed in `mx_listeners`.
2. **Given** Ghost B moves into Ghost A's cluster (its position falls within `{C_A} ∪ neighbors(C_A)`), **When** Ghost A issues `say`, **Then** Ghost B receives a `message.new` signal and appears in `mx_listeners`.
3. **Given** Ghost B then moves out of Ghost A's cluster, **When** Ghost A issues `say`, **Then** Ghost B does not receive the signal.
4. **Given** Ghost B is in both Ghost A's and Ghost C's clusters simultaneously, **When** Ghost A and Ghost C each issue `say`, **Then** Ghost B receives signals from both.

---

### User Story 6 — Conversation Store Backend is Swapped (Priority: P6)

A contributor replaces the JSONL store with a SQLite implementation. No changes are required to `server/world-api/`, the `say` MCP tool, the Colyseus notification bridge, or the HTTP endpoints. Only the store implementation changes.

**Why this priority**: The pluggable store interface is a first-class extension point for contributors and vendors. Its correctness must be verifiable independently of the rest of the system.

**Independent Test**: Replace the JSONL store with a conforming stub that records calls. Verify all existing acceptance scenarios for Stories 1 and 2 still pass without any changes outside `server/conversation/`.

**Acceptance Scenarios**:

1. **Given** a store implementation that satisfies the `append/get/list` interface, **When** it is wired in as the store for `server/conversation/`, **Then** all existing `say` and HTTP-read scenarios pass without modification to other packages.
2. **Given** the store interface, **When** a contributor writes an alternative implementation, **Then** the interface requires no knowledge of Effect-ts — `Promise<T>` return types are sufficient.

---

### Edge Cases

- What happens when a ghost in conversational mode attempts to move? The movement command is rejected with an observable error indicating that the ghost is in conversational mode. The ghost must issue `bye` first.
- What happens when a ghost issues `say` and the store is unavailable? The `say` call must fail with an observable error. The state transition to conversational mode must not occur if persistence fails. It must not silently drop the message.
- What happens if `message_id` collisions occur? ULID format is required. Collision resistance is a property of the format; no deduplication logic is specified.
- What happens when a ghost is first registered and its thread does not yet exist? The thread is created lazily on the first `append` call; no explicit thread initialization step is needed.
- What happens when another ghost moves into the speaker's cluster mid-conversation? The newly arrived ghost will receive `message.new` signals for subsequent `say` calls but not retroactively for earlier ones. `mx_listeners` is a point-in-time snapshot per message.
- What happens if a ghost crashes or disconnects while in conversational mode? In the PoC, ghost mode is in-memory only and resets to `normal` on reconnect. The ghost may re-enter conversational mode by issuing `say` again. Persistent recovery across reconnects is out of scope and deferred to a follow-on RFC.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each ghost MUST have exactly one broadcast thread, identified by `thread_id = ghost_id`, created on first use and persisting for the ghost's lifetime.
- **FR-002**: System MUST define the local cluster of a ghost at cell C as `{C} ∪ neighbors(C)` — a total of 7 cells at full H3 resolution (or 6 at a pentagon cell).
- **FR-003**: Each ghost MUST be in one of two states: **normal state** (can move and issue any action) or **conversational mode** (movement suspended, may only `say` or `bye`).
- **FR-004**: Issuing `say` MUST transition the ghost from normal state to conversational mode if it is not already in conversational mode. Issuing `say` while already in conversational mode MUST keep the ghost in conversational mode.
- **FR-005**: System MUST reject movement commands issued by a ghost in conversational mode with an observable error indicating the ghost must issue `bye` first.
- **FR-006**: Issuing `bye` MUST transition the ghost from conversational mode to normal state. Issuing `bye` from normal state MUST be accepted as a no-op.
- **FR-007**: System MUST expose a `say { content }` MCP tool in `server/world-api/` that manages the state transition and broadcasts a message on the calling ghost's thread to all current cluster members.
- **FR-008**: System MUST expose a `bye` MCP tool in `server/world-api/` that ends the conversation and returns the ghost to normal state.
- **FR-009**: System MUST compute the cluster snapshot (for `mx_listeners` and signal fan-out) at the moment each `say` is processed. The speaker's position is stable during conversational mode, so the snapshot reflects current positions of other ghosts only.
- **FR-010**: Colyseus signals MUST carry only `{ thread_id, message_id }` — never message content. Content is fetched separately from the conversation store.
- **FR-011**: System MUST persist each message as a record with fields: `thread_id`, `message_id`, `timestamp`, `role`, `name`, `content`, `mx_tile`, `mx_listeners`.
- **FR-012**: `message_id` MUST be a ULID — lexicographically sortable, collision-resistant, and coordination-free.
- **FR-013**: System MUST expose `GET /threads/{ghost_id}` returning a paginated list of message records, supporting `after={message_id}` and `limit={n}` query parameters.
- **FR-014**: System MUST expose `GET /threads/{ghost_id}/{message_id}` returning the single specified message record.
- **FR-015**: Both HTTP endpoints MUST require authentication via the ghost house API key issued at registration. A valid key MUST grant access to all ghost instances registered under that ghost house, and only those instances.
- **FR-016**: The conversation store MUST implement the interface: `append(record): Promise<void>`, `get(thread_id, message_id): Promise<MessageRecord>`, `list(thread_id, options): Promise<MessageRecord[]>`. The interface MUST NOT require Effect-ts knowledge.
- **FR-017**: Conversation responsibilities MUST be implemented in a dedicated `server/conversation/` package. Persistence and fan-out logic MUST NOT be inlined into `server/world-api/` or `server/colyseus/`.
- **FR-018**: System MUST durably persist messages so that conversation history survives server restart.
- **FR-019**: System MUST expose an `inbox` MCP tool in `server/world-api/` that returns and drains all pending `message.new` notifications for the calling ghost, enabling pull-based message discovery. This is the PoC delivery mechanism; Colyseus push notification is the target architecture (deferred — see research.md Decision 2).

### Key Entities

- **Ghost State**: An engine-tracked value for each ghost. Either **normal state** (movement and all actions allowed) or **conversational mode** (movement suspended; only `say` and `bye` accepted). Tracked in-memory by `ConversationService` for the PoC and mirrored to the Colyseus room schema (`ghostModes`) for debug visibility. State resets to `normal` on server restart or ghost reconnect.
- **Ghost Thread**: A persistent, append-only log of messages broadcast by a single ghost. Identified by `thread_id = ghost_id`. Created on first use.
- **Message Record**: One entry in a thread. Extends the OpenAI chat completions message shape. Required fields: `thread_id` (string), `message_id` (ULID string), `timestamp` (ISO 8601), `role` (string — see open question below), `name` (string, speaker's ghost_id), `content` (string), `mx_tile` (H3 res-15 index at time of message), `mx_listeners` (string[], ghost_ids in cluster at time of message).
- **Local Cluster**: The set of H3 cells `{C} ∪ neighbors(C)` for a ghost at cell C. Computed per `say` call from current world graph positions; never stored as explicit state.
- **Conversation Store**: The backend that persists and serves message records. Initial implementation is JSONL on disk (`{ghost_id}.jsonl`). Replaceable via the `append/get/list` interface.

### Interface Contracts *(mandatory)*

- **IC-001**: Conversation store interface (`append`, `get`, `list`) with `Promise<T>` return types — defined in `server/conversation/`. This is the primary extension point for third-party contributors.
- **IC-002**: Message record schema — extends OpenAI chat completions message shape with `mx_`-prefixed fields. Both the Colyseus notification bridge and the HTTP endpoints depend on this schema.
- **IC-003**: Colyseus signal contract — `message.new` signal with payload `{ thread_id: string, message_id: string }`. Target architecture for production delivery. In the PoC, ghost agents discover notifications via `inbox` polling instead (see research.md Decision 2).
- **IC-004**: HTTP endpoint contract — `GET /threads/{ghost_id}` and `GET /threads/{ghost_id}/{message_id}` with ghost house API key auth. One API key grants access to all ghost instances registered under that ghost house. Consumed by ghost house services.
- **IC-005**: `say { content: string }` and `bye` MCP tools — defined in `server/world-api/`. `say` manages the state transition to conversational mode and delegates to `server/conversation/` for persistence and fan-out. `bye` clears conversational mode and returns the ghost to normal state. Both are part of the ghost wire protocol (ADR-0001).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A ghost agent issuing `say` causes all ghosts within its 7-cell cluster to be notified within the same server-side request lifecycle. In the PoC, ghost agents discover notifications via `inbox` polling; Colyseus push delivery is the target architecture, deferred per research.md Decision 2.
- **SC-002**: A ghost house service can retrieve messages for any of its registered ghost instances via HTTP within 500ms of the request, for thread sizes up to 100k records per ghost.
- **SC-003**: All message records written by `say` are present and readable after a server restart — zero message loss on clean shutdown.
- **SC-004**: Replacing the JSONL store with a conforming alternative implementation requires no changes outside `server/conversation/` — all upstream contracts remain identical.
- **SC-005**: A third-party contributor can implement a conforming store backend without importing or understanding Effect-ts — the interface uses standard Promise-based types only.
- **SC-006**: A ghost that has issued `say` cannot move until it issues `bye` — the engine enforces this without any action by the ghost house or the ghost agent.
- **SC-007**: Cluster membership for each message reflects whoever was in range at the moment that specific `say` was processed — no continuous background computation is required.

## Assumptions

### Actor model

- A **ghost house** is an external service that registers and operates multiple ghost instances. It is the intermediary between the world engine and IRL users. A single ghost house may manage many ghost instances.
- A **ghost instance** is an autonomous agent in the world, paired one-to-one with a single IRL user. The ghost house creates, governs, and observes ghost instances on behalf of those users.
- An **IRL user** (ghost caretaker) cannot directly interact with their ghost. All interaction is mediated by the ghost house — for example, an IRL user changing a ghost's goal sends that intent to the ghost house, which relays it to the world server, which notifies the ghost instance.
- A **ghost house API key** is scoped to the ghost house service and grants access to all ghost instances that ghost house has registered. It is not per-ghost and not per-IRL-user.

### Technical assumptions

- Cluster membership is computed on-demand by querying current ghost positions from the world graph (Neo4j). It is not cached or stored as explicit subscription state.
- Ghost agents discover nearby ghosts via `look`; the subscription that delivers `message.new` is an internal Colyseus presence operation invisible to the agent.
- Ghosts that do not wish to engage with incoming messages simply do not respond — there is no engine-level mechanism to force participation in a conversation.
- `say` and `bye` are the primary conversation primitives. In the PoC, ghost agents discover incoming messages by actively polling the `inbox` MCP tool. Colyseus push notification is the target architecture for production.
- The initial store implementation is JSONL on disk. SQLite is the anticipated second implementation but is out of scope for this feature.
- Ghost house API key issuance (at registration time) is handled by `server/registry/` and is pre-existing; this feature relies on it but does not implement it.
- The combined server entry point (`server/`) is responsible for wiring `server/conversation/` into the process alongside `server/world-api/` and `server/colyseus/`. This wiring must be documented for contributors.

### Open Questions (from RFC-0005 — must be resolved before first message is written)

These are unresolved decisions in RFC-0005 that gate the conversation store implementation. They are listed here to ensure the spec and proposals remain synchronized.

1. **`role` field values**: RFC-0005 proposes `role: "user"` for ghost messages and `role: "system"` for world engine events. A dedicated `mx_ghost_type` field (e.g. `"attendee"`, `"speaker"`, `"vendor_npc"`, `"system"`) may be cleaner. This must be decided before any records are written, as it affects the schema of every message.

2. **Pagination cursor type**: The `list(after: message_id)` API uses ULID as a cursor. ULID adoption should be confirmed project-wide before implementation begins.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0005-ghost-conversation-model.md` — update **Status** from `draft` to `accepted` when this spec is approved and ADR-0003 is accepted.
- `proposals/adr/0003-conversation-server.md` — update **Status** from `proposed` to `accepted` before implementation begins (per the ADR itself: "ADR-0003 must be accepted before implementation of this RFC begins").
- `docs/architecture.md` — add `server/conversation/` to the server package inventory; note that the conversation store interface is an extension point.
- `server/conversation/README.md` — must be created as part of implementation; describes the store interface, quickstart, and contribution guide for alternative store implementations.
