# Feature Specification: NPC Agent — Rule-Based Character Roster

**Feature Branch**: `028-npc-agent`  
**Created**: 2026-06-10  
**Status**: Draft  
**Input**: User description: "an npc-agent with basic, rule-based capabilities that are a strategic upgrade over the random-agent, but lacking any LLM-dependencies for deep reasoning and communication. the agent should be customizable, drawing from a catalog of characters that have names, backgrounds, dialog trees, etc. when joining a session, the top-level agent should attempt to spawn every enabled character."

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0026](../../proposals/rfc/0026-npc-agent.md) — NPC Agent: Rule-Based Character Roster
- **Scope Boundary**: A new `npc-agent` package in `ghosts/` that reads a character catalog, spawns one character ghost per enabled entry when a session starts, and drives each character's movement and dialog via deterministic rule tables — no LLM calls anywhere in the critical path. To support agent-initiated roster spawning, this feature also adds three minimal capabilities to existing services (per RFC-0026 §4): an **agent-callable spawn endpoint** (scoped auth) on the agent-host, **emission of `world.session.start`** by the world server, and a **per-ghost `background`** field through adoption and spawn context.
- **Out of Scope**: LLM-powered conversation, dynamic quest generation, persistent character memory across sessions, **NPC-to-NPC dialog of any kind** (an NPC ignores messages from sibling roster characters), admin UI for editing the character catalog

## Clarifications

### Session 2026-06-10

- Q: Do NPC characters reply to DIRECT messages from other NPCs? → A: No — an NPC ignores messages whose sender is one of the npc-agent's own roster characters; it replies only to humans (`PARTNER`) and non-NPC external agents. This removes the NPC↔NPC loop concern entirely.
- Q: What triggers the top-level npc-agent to spawn its roster? → A: The npc-agent self-spawns on a `world.session.start` event, calling the agent-host spawn API once per enabled character (it initiates spawns rather than being spawned per-ghost like random-agent).
- Q: How do DialogNode trigger conditions match inbound text? → A: Case-insensitive keyword/substring match — a node fires if any of its triggers appears in the lowercased message text.
- Q: What on-disk format do catalog files use? → A: gram format (parsed via `@relateby/pattern`), consistent with the project's existing `.map.gram` and `.calendar.gram` files — not JSON or YAML.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Session Populates with Named NPCs (Priority: P1)

A session operator starts a live session and the npc-agent automatically places all enabled characters from the catalog into the world, each moving and acting according to their individual rules rather than random dice rolls.

**Why this priority**: This is the core value — replacing the anonymous random wanderer with recognizable characters that behave consistently and predictably is the fundamental upgrade.

**Independent Test**: Start a session with the npc-agent registered, observe that each enabled character in the catalog appears as a distinct ghost with its name, and that their movement choices align with their stated behavioral disposition (e.g., a "collector" character seeks cells containing items, a "guardian" character stays near a landmark).

**Acceptance Scenarios**:

1. **Given** a character catalog with 3 enabled entries and 1 disabled entry, **When** the npc-agent receives a session join event, **Then** exactly 3 character ghosts are spawned and the disabled character does not appear
2. **Given** spawned character ghosts are active, **When** a player inspects a character's ghost identity, **Then** the character's configured name and background description are visible
3. **Given** the npc-agent process restarts mid-session, **When** the agent reconnects, **Then** existing character loops resume under the same ghost IDs (no ghost duplication)

---

### User Story 2 — Characters Follow Behavioral Rules, Not Randomness (Priority: P2)

A player exploring the world encounters NPCs whose actions follow a recognizable, character-consistent pattern — the "merchant" gravitates toward other agents, the "hermit" avoids crowded cells, the "collector" picks up items — rather than moving unpredictably.

**Why this priority**: Strategic behavior is what differentiates npc-agent from random-agent. Without this, the characters are just cosmetically renamed wanderers.

**Independent Test**: Run a character configured as a "resource-seeker" in a world containing items. After 20 ticks, confirm the character has moved toward and taken at least one item that was within 3 cells of its starting position, demonstrating goal-directed movement rather than random drift.

**Acceptance Scenarios**:

1. **Given** a character has a rule "move toward nearest item when inventory is empty", **When** items exist within a navigable range, **Then** the character moves consistently toward the closest item rather than a random exit
2. **Given** a character has a rule "avoid cells with more than 2 occupants", **When** the character's current cell reaches 3 occupants, **Then** the character exits to the least-crowded neighboring cell
3. **Given** a character has no applicable rule for the current world state, **When** the tick fires, **Then** the character falls back to a configurable default action (idle, random move, or stay)

---

### User Story 3 — Characters Converse with Any Ghost via a Dialog Tree (Priority: P3)

When **any** other ghost (a human-controlled partner OR another agent) sends a message to an NPC character, the character enters its dialog tree and responds with pre-written dialog that fits the current conversation context — rather than ignoring the message or echoing a generic placeholder.

**Why this priority**: This is the conversational upgrade over random-agent. The random-agent only replies to human-partner (`PARTNER`-priority) messages and silently drops messages from other ghosts (`DIRECT`/`NEAR`/`GROUP` priority), so it cannot participate in agent-to-agent conversation. NPC characters must respond to any addressing ghost so the world feels populated with talkers, not just movers. Scripted dialog achieves this without LLM inference.

**Independent Test**: Drive the NPC from an **external ghost** (a separate test agent, not a human and not the NPC itself). Configure a character with a dialog tree that has a greeting node triggered by any inbound message and a farewell node triggered by the word "bye". From the external ghost, send "hello" then "bye" to the NPC. Confirm the NPC replies with the greeting text on the first message and the farewell text on the second — proving the dialog tree fires for a ghost-originated message, not only a human partner.

**Acceptance Scenarios**:

1. **Given** an NPC character receives a message addressed to it from a non-NPC external agent (`DIRECT` priority — not a human partner, not a sibling NPC), **When** the message text matches a dialog node trigger condition (case-insensitive keyword), **Then** the character enters the dialog tree and replies with one of the node's configured response texts (supports multiple alternatives for variety)
2. **Given** an NPC character receives a message from a human partner (`PARTNER` priority), **When** the message matches a dialog node, **Then** the character replies from the same dialog tree (humans and ghosts use the same tree)
3. **Given** a character receives a message that matches no dialog node, **When** the character evaluates the tree, **Then** the character replies with the tree's fallback/default response (never silent)
4. **Given** a dialog node has a transition defined (e.g., greeting → conversation), **When** the character delivers the node's response, **Then** subsequent messages from that sender are evaluated from the new dialog state
5. **Given** two different ghosts are each mid-conversation with the same NPC at different nodes in its dialog tree, **When** either ghost sends its next message, **Then** the NPC responds from that ghost's own dialog state — the two conversations never share or cross-contaminate state
6. **Given** an automated integration test running an external ghost that exchanges a scripted message sequence with the NPC, **When** the test runs end-to-end against a live world, **Then** the NPC's replies match the expected dialog-tree outputs at each step
7. **Given** an automated integration test running two external (non-NPC) agents that drive interleaved, simultaneous conversations with the same NPC, **When** the test runs end-to-end, **Then** each agent's replies match the expected dialog-tree outputs for its own conversation independent of the other's progress
8. **Given** an NPC character receives a `DIRECT` message from a sibling NPC in the same roster, **When** the message is evaluated, **Then** the NPC ignores it (no dialog reply) — preventing NPC↔NPC exchanges

---

### User Story 4 — Operator Configures the Character Catalog (Priority: P4)

A session operator adds a new character to the catalog by creating a configuration file. On the next session start, that character appears automatically alongside the existing roster, with no code changes required.

**Why this priority**: Extensibility without code changes is what makes the system usable beyond the initial set of characters. Config-driven catalogs enable rapid iteration on character personalities and event-specific rosters.

**Independent Test**: Add a new `.character.gram` file to the catalog directory, restart the npc-agent, join a session, and confirm the new character ghost appears and behaves according to its rules.

**Acceptance Scenarios**:

1. **Given** a catalog directory with a new `.character.gram` file, **When** the npc-agent starts, **Then** the character is loaded and available for spawning without any TypeScript or config changes outside the catalog
2. **Given** a `.character.gram` file with a validation error (missing required attribute / malformed gram), **When** the npc-agent starts, **Then** the invalid entry is skipped with a logged warning and all valid characters still load
3. **Given** a character is marked `enabled: false` in its catalog entry, **When** the npc-agent joins a session, **Then** that character is not spawned

---

### Edge Cases

- What happens when the agent-host rejects a spawn request for one character (e.g., capacity limit)? The remaining characters must still spawn; failed spawns are logged and do not abort the session join.
- What happens when two characters have the same configured name? Catalog loading should reject duplicates with a clear error, ensuring each character has a unique identity in the world.
- What happens when a dialog tree has a cycle (node A transitions to node B, node B transitions to node A)? The system should handle infinite cycles gracefully, limiting traversal depth or detecting loops.
- What happens when a character's behavior rule references a world-state value (e.g., "items nearby") and the MCP call fails? The rule evaluation must degrade gracefully — skip that rule, try the next one, fall back to default.
- What happens when the catalog directory is empty? The npc-agent joins the session but spawns no characters, logging that the roster is empty.
- What happens when one NPC character messages another? The recipient recognizes the sender as a sibling roster character and ignores it (FR-009), so NPC↔NPC reply loops cannot occur.
- What happens when an NPC receives a `NEAR` (proximity broadcast) or `GROUP` message rather than one addressed to it? In this feature NPCs only enter the dialog tree for messages addressed to them (`DIRECT`, from a non-NPC agent) or from a human partner (`PARTNER`); broadcast/group messages are not auto-answered (avoids chatter storms). This is an explicit scoping decision, not an oversight.
- What happens when a message arrives for a character whose action loop has not yet started (spawn in flight)? The notification must be ignored or queued without crashing; a missed early greeting is acceptable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The npc-agent MUST read a character catalog from a configurable directory at startup; the catalog consists of one `.character.gram` file per character, parsed with `@relateby/pattern` (the same gram tooling used for `.map.gram` and `.calendar.gram`)
- **FR-002**: Each catalog entry MUST define at minimum: a unique character ID, a display name, a background description, a behavioral-rules list, and a dialog tree
- **FR-003**: Catalog entries MUST support an `enabled` boolean flag; entries with `enabled: false` MUST be excluded from spawning
- **FR-004**: On receiving a `world.session.start` event, the npc-agent MUST spawn one ghost per enabled catalog entry by calling the agent-host spawn API; each spawned ghost is an independent character the npc-agent then drives. Unlike the random-agent (which is spawned per-ghost *by* the host), the npc-agent self-initiates these roster spawns.
- **FR-005**: Each spawned character MUST run its own independent action loop, isolated from other characters, so one character's failure does not affect others
- **FR-006**: Each character's action loop MUST evaluate its behavioral rules in priority order each tick, executing the first rule whose condition evaluates to true; rules access world state (location, occupants, inventory, exits) through MCP calls
- **FR-007**: When no behavioral rule condition is satisfied, the character MUST execute a per-character configurable default action (supported defaults: `idle`, `random-move`, `stay`)
- **FR-008**: The npc-agent MUST react to inbound `world.message.new` A2A notifications and, when the message is addressed to one of its characters by a non-NPC external agent (`DIRECT` priority) or by a human partner (`PARTNER` priority), evaluate that character's dialog tree from its current dialog state and reply with a matching response text; if no node matches, the fallback response MUST be sent. (This is the explicit upgrade over random-agent, which responds only to `PARTNER` and drops ghost-originated messages.)
- **FR-009**: The npc-agent MUST NOT enter the dialog tree for messages whose sender is one of its own roster characters (a sibling NPC); such messages MUST be ignored. NPC-to-NPC conversation is out of scope, and this exclusion is what prevents NPC↔NPC reply loops (no separate turn cap is required).
- **FR-010**: A DialogNode's trigger conditions MUST be matched against inbound text using case-insensitive keyword/substring matching — a node fires if any of its trigger strings appears within the lowercased message text
- **FR-011**: Dialog nodes MUST support multiple response text alternatives; when a node is selected, one alternative is chosen (random selection is acceptable for text variety — this is the only intentionally non-deterministic behavior)
- **FR-012**: Dialog transitions MUST update the per-sender dialog state so subsequent inbound messages from the same sender are evaluated from the new node; each NPC MUST track dialog state independently per conversation partner so that multiple simultaneous conversations progress through the tree without sharing or overwriting each other's position
- **FR-013**: The npc-agent top-level process MUST NOT import or invoke any LLM client library; all decision logic must be deterministic rule evaluation or dialog-tree traversal
- **FR-014**: Catalog loading errors (missing required fields, duplicate IDs, invalid gram shape) MUST be logged as warnings and the affected entries skipped; the agent MUST start successfully with the valid subset
- **FR-015**: The feature MUST include automated integration tests in which external (non-NPC) agents drive scripted message exchanges against a live NPC and assert the dialog-tree outputs at each step — covering both (a) a single multi-turn conversation and (b) two or more simultaneous, interleaved conversations that each maintain independent dialog state

### Key Entities

- **CharacterDefinition**: A catalog entry, authored as a `.character.gram` file. Attributes: `id` (unique slug), `name` (display name), `background` (description string), `enabled` (boolean), `defaultAction` (`idle` | `random-move` | `stay`), `behaviorRules` (ordered list), `dialogTree` (root node + node map)
- **BehaviorRule**: A single rule in a character's decision table. Attributes: `id`, `condition` (declarative expression over world state), `action` (`WorldAction` — a discriminated union keyed on `do`; parameters mirror MCP tool arguments). Declaration order is the authoritative priority; no `priority` field.
- **DialogNode**: A node in a character's dialog tree. Attributes: `id`, `triggerConditions` (list of case-insensitive keyword/substring triggers; the node fires when any trigger appears in the lowercased inbound text), `responses` (list of text alternatives), `transition` (optional: next node ID after responding), `fallback` (boolean — designates the catch-all node)
- **DialogState**: Per-character, per-conversation-partner runtime state tracking which dialog node is "current" for the next inbound message from that sender
- **NpcAgentCatalog**: Runtime-loaded collection of validated CharacterDefinitions; provides lookup by ID and filtered list of enabled entries

**Conversation cardinality**: A conversation is the pair *(NPC, partner)*, where a partner is a human or a non-NPC external agent (never a sibling NPC — see FR-009). Each NPC owns its own `partner → DialogState` map, so `n` NPCs each conversing with `k` partners yields up to **n·k** distinct conversation states (the true total is the sum of each NPC's partner count). Consequence: the same partner talking to two NPCs produces two independent states (the key is the pair, not the partner alone). State is keyed one level deeper than the random-agent's `ghostId`-keyed maps: per NPC character, then per partner ghost ID.

### Interface Contracts

- **IC-001**: The character catalog file format MUST be gram (parsed via `@relateby/pattern`), consistent with `.map.gram` and `.calendar.gram`. A documented gram shape (required node labels and attributes for character, behavior rule, and dialog node) MUST be published so operators can author and validate `.character.gram` files; the reference shape lives in `ghosts/npc-agent/schema/character.gram.md`
- **IC-002**: NPC characters MUST use the same A2A spawn-context schema (`aie-matrix.agent-host.spawn-context.v1`) as the random-agent — no new spawn protocol is introduced
- **IC-003**: NPC characters MUST use the existing `GhostMcpClient` tool interface (`go`, `whereami`, `exits`, `inventory`, `say`, `take`, `offer`, etc.) without extending it — behavior variety comes from rule configuration, not new tools
- **IC-004**: The character catalog directory MUST be configurable via an environment variable (`NPC_CATALOG_DIR`) with a sensible default path for local development
- **IC-005**: The npc-agent's A2A agent card MUST declare `pushNotifications: true` and consume the `aie-matrix.world-event.v1` schema for both `world.session.start` (triggers roster spawn — IC-006) and `world.message.new` (triggers dialog) events; dialog replies are sent via the existing MCP `say` tool (with `to` set to the originating ghost for `DIRECT` delivery)
- **IC-006**: This feature ADDS an agent-callable spawn endpoint to the agent-host (no such endpoint exists today — the current `/v1/sessions/spawn/:agentId` requires the host dev token and is for external orchestrators only). The endpoint MUST authenticate the calling agent via its own scoped session credential (Constitution Principle V — no parallel bare-secret auth path). The npc-agent calls it to create one character ghost per enabled entry; spawned characters use the `aie-matrix.agent-host.spawn-context.v1` schema (IC-002).
- **IC-007**: This feature ADDS emission of the `world.session.start` world event (schema `aie-matrix.world-event.v1`) by the world server when a live session begins — the event kind is defined and bridge-mapped today but never broadcast. The npc-agent consumes it as its roster-spawn trigger.
- **IC-008**: This feature ADDS an optional per-ghost `background` string to the registry adoption payload and `SpawnContext.ghostCard`, so each character's identity (name + background) is distinct when inspected. Today only `displayName` is per-ghost; agent `about` is per-agent in the AgentCard.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All enabled characters from a catalog of up to 20 entries are spawned within 30 seconds of a session join event
- **SC-002**: Each character's action loop executes at least one rule-driven action (not a fallback random move) within the first 5 ticks when the world state satisfies at least one configured rule condition
- **SC-003**: 100% of inbound messages addressed to a character (from a human partner OR a non-NPC external agent) that has a configured dialog tree receive a non-empty reply within 2 seconds
- **SC-007**: An integration test driven by an external ghost completes a multi-turn scripted dialog (≥3 exchanges) with an NPC and the NPC's replies match the expected dialog-tree outputs at every turn
- **SC-008**: An integration test in which two external ghosts hold interleaved simultaneous conversations with the same NPC produces, for each ghost, replies matching that conversation's expected dialog-tree outputs — with zero cross-contamination between the two conversations
- **SC-004**: Adding a new catalog entry and restarting the npc-agent results in the new character appearing in the next session without any code changes
- **SC-005**: A catalog of 10 characters with 5 behavior rules each loads and validates in under 1 second at agent startup
- **SC-006**: Zero LLM API calls appear in network traces during any npc-agent session — all behavior is fully offline-capable

## Assumptions

- The npc-agent is deployed as a separate package in `ghosts/npc-agent/`, structured identically to `ghosts/random-agent/` (same A2A express server pattern, same Docker/Kubernetes conventions)
- Characters share a single npc-agent process and each runs on its own async loop (same pattern as random-agent's `loopsByGhostId` map); process-level parallelism is not required
- Behavioral rule conditions are evaluated against world state obtained from MCP calls already in use by the random-agent (`whereami`, `exits`, `inventory`); no new MCP tools are required for the initial rule set
- The dialog system is purely reactive (respond to inbound messages); NPCs do not initiate conversation unprompted in this feature
- Session operators are the primary catalog authors; catalog files are authored in gram (`.character.gram`), consistent with the project's existing `.map.gram` / `.calendar.gram` files and parsed via `@relateby/pattern`
- The agent-host exposes (or will expose) an agent-initiated spawn API the npc-agent can call to create character ghosts on `world.session.start`; confirming this endpoint is a planning-phase prerequisite (IC-006)
- The random-agent remains unchanged and deployable alongside npc-agent; this is an additive new package, not a replacement

## Documentation Impact *(mandatory)*

- `docs/project-overview.md` — update agent roster section to describe npc-agent and the character catalog concept
- `ghosts/npc-agent/README.md` — new file documenting catalog format, environment variables, and how to add a character
- `ghosts/npc-agent/schema/character.gram.md` — new file documenting the catalog gram shape (per IC-001), with a worked example `.character.gram`
- `AGENTS.md` — add npc-agent entry alongside random-agent for agent-consumer guidance
