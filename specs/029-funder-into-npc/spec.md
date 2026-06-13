# Feature Specification: Migrate funder-agent into npc-agent

**Feature Branch**: `029-funder-into-npc`  
**Created**: 2026-06-13  
**Status**: Draft  
**Input**: User description: "Migrating funder-agent into npc-agent with a special funder behavior kind"

## Proposal Context *(mandatory)*

- **Related Proposal**: Emerged from architectural discussion — the funder-agent runs a single character with stateful contract-negotiation logic that does not justify a standalone container deployment.
- **Scope Boundary**: Move the funder character's behavior into the npc-agent process. The funder runs as one of npc-agent's managed characters. The `funder-agent` package and container are retired.
- **Out of Scope**: Changes to the funder's contract negotiation logic or economy rules. Changes to other NPC character behaviors. Modifications to the gram format. Any changes to world-api, agent-host, or ghost-ts-client.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Funder character runs inside npc-agent (Priority: P1)

When npc-agent spawns, it spawns a funder character ghost alongside the existing collector, hermit, and info-attendant characters. The funder ghost roams and advertises its question-for-credit contract offer to nearby ghosts, just as before.

**Why this priority**: This is the core migration — all other stories depend on this working.

**Independent Test**: Spawn npc-agent into a live session. Confirm a ghost with the funder character appears in the world, responds to "accept", opens a contract, and evaluates submitted answers.

**Acceptance Scenarios**:

1. **Given** npc-agent starts and a session is active, **When** the roster is spawned, **Then** a funder character ghost appears in the world alongside other NPC characters.
2. **Given** a funder ghost is running, **When** any ghost sends it a message, **Then** it replies with the contract advertisement.
3. **Given** a ghost replies "accept", **When** the funder processes its inbox, **Then** it calls `eval_contract_open` and sends the question to the accepting ghost.
4. **Given** a contract is open and the contractor calls `eval_contract_submit`, **When** the `world.contract.submitted` event arrives at npc-agent, **Then** the funder calls `eval_contract_evaluate` with `verdict: 1.0` and notifies the contractor.

---

### User Story 2 — funder-agent container is retired (Priority: P2)

The `funder-agent` package no longer needs to be built, deployed, or registered as a separate container. Operators only deploy npc-agent.

**Why this priority**: This is the deployment-simplification goal — reduces one container from the compose stack and one build/deploy pipeline.

**Independent Test**: Remove `funder-agent` from Docker Compose. Confirm npc-agent brings up the funder character and the compose stack converges with no missing services.

**Acceptance Scenarios**:

1. **Given** the Docker Compose file no longer references `funder-agent`, **When** the stack starts, **Then** all NPC characters (including funder) are live within npc-agent.
2. **Given** the `ghosts/funder-agent` package still exists in the repo, **When** the pnpm workspace is resolved, **Then** it does not need to be built or run for the funder character to work.

---

### User Story 3 — Funder per-ghost state survives character re-spawn (Priority: P3)

If a funder character ghost is re-spawned (e.g., session restart), its contract state is cleared and it starts fresh from idle, rather than getting stuck in a dangling `awaiting_submission` state.

**Why this priority**: Correctness under restart — lower priority because sessions are expected to be short-lived.

**Independent Test**: Spawn a funder ghost, open a contract, then interrupt and re-spawn the ghost. Confirm the new ghost responds with advertisement (not a stale contract state).

**Acceptance Scenarios**:

1. **Given** a funder ghost has an open contract, **When** it is re-spawned, **Then** the previous contract state is discarded and the ghost starts in the idle phase.
2. **Given** a re-spawned funder ghost receives a `world.contract.submitted` event for the old contract, **Then** it ignores it without error.

---

### Edge Cases

- What happens if a second funder ghost is spawned for the same character while the first is still running? The prior loop must be interrupted before the new one starts (same behavior as existing NPC characters).
- What happens when the funder reaches `MAX_OPEN` (5) concurrent contracts? It declines new "accept" messages with a "fully booked" reply.
- What happens if `eval_contract_open` returns an insufficient-funds error? The funder notifies the accepting ghost and stays in idle.
- What happens when a `world.contract.submitted` event arrives but no funder loop is active? The event is ignored silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `CharacterDefinition` type MUST support a `behaviorKind` discriminator field with at least the values `"rule-engine"` and `"funder"`.
- **FR-002**: The `ghostActionLoop` in npc-agent MUST dispatch to a `funderTick` function when `behaviorKind` is `"funder"`, and to `evaluateRules` when it is `"rule-engine"`.
- **FR-003**: The `funderTick` function MUST poll the ghost's inbox and execute the contract-negotiation state machine (idle / awaiting_submission) on each tick.
- **FR-004**: Per-funder-ghost state (`ghostState`, `contractToFunder`, `openContractCount`) MUST be stored in module-level maps in `funder-behavior.ts`, keyed by ghostId.
- **FR-005**: npc-agent's executor MUST route `world.contract.submitted` events to the funder behavior handler, using the same `contractToFunder` reverse-lookup already used in funder-agent.
- **FR-006**: A `funder.character.gram` file MUST exist in npc-agent's catalog, declaring the character id, name, background, enabled flag, and defaultAction.
- **FR-007**: When a funder ghost is re-spawned, its prior per-ghost state MUST be cleared (maps reset for that ghostId) before the new loop starts.
- **FR-008**: Existing NPC character behaviors (rule-engine path) MUST be unaffected by this change.
- **FR-009**: The `ghosts/funder-agent` package MUST be removed from the Docker Compose stack; the package may be archived or deleted from the repo.

### Key Entities

- **CharacterDefinition**: Extended with `behaviorKind: "rule-engine" | "funder"` discriminator.
- **FunderState**: Per-ghost state machine — `{ phase: "idle" }` or `{ phase: "awaiting_submission", contractId, contractorId, question }`. Lives in `funder-behavior.ts`.
- **funder.character.gram**: Catalog entry declaring the funder character, parsed by the existing catalog loader.

### Interface Contracts

- **IC-001**: The `funder.character.gram` file MUST be parseable by npc-agent's existing `parse-character-gram.ts` catalog loader. The gram file MUST declare `behaviorKind: "funder"` as a character property.
- **IC-002**: The `funderTick` function MUST accept `(ghostId: string, mcp: GhostMcpClient)` and return `Promise<void>`, matching the call-site shape expected by `ghostActionLoop`.
- **IC-003**: The `world.contract.submitted` event routing in executor.ts MUST call into `funder-behavior.ts` via an exported `handleContractSubmitted(ghostId, contractId, contractorId)` function, keeping executor.ts free of funder state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All funder character behaviors observable before the migration remain observable after — no regression in contract open/submit/evaluate flows.
- **SC-002**: The Docker Compose stack runs with one fewer service (funder-agent removed) while all funder character interactions still work end-to-end.
- **SC-003**: npc-agent's existing test suite passes without modification. No new test failures introduced for non-funder characters.
- **SC-004**: The funder character appears in the world within the same time window as other NPC characters after a session start.
- **SC-005**: The funder correctly resets its state on re-spawn — zero dangling contract states after a restart verified by inspection.

## Assumptions

- The `funder.character.gram` catalog entry uses the same gram schema as existing character files; no format extensions are needed beyond adding `behaviorKind`.
- The funder's `MAX_OPEN` (5 concurrent contracts) and question bank are constants embedded in `funder-behavior.ts`, not externalized to gram config.
- The funder character will be seeded with starting credits via the same ledger seed mechanism used for other characters in a session (no change to seeding logic is in scope).
- npc-agent's catalog loader (`parse-character-gram.ts`) can be extended to read `behaviorKind` without breaking backward compatibility for existing gram files (default: `"rule-engine"`).
- The `ghosts/funder-agent` package directory may be left in the repo as-is (just removed from compose and not built) or deleted; either is acceptable.

## Documentation Impact *(mandatory)*

- `CLAUDE.md` — remove the funder-agent technology stack entry; update the `028-npc-agent` or add a `029` entry noting that the funder character now runs inside npc-agent.
- `docs/architecture.md` — update any reference to funder-agent as a separate deployed service.
- `ghosts/npc-agent/README.md` — add the funder character to the catalog description.
- Docker Compose file(s) — remove the `funder-agent` service definition.
