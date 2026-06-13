# Tasks: Migrate funder-agent into npc-agent

**Input**: Design documents from `specs/029-funder-into-npc/`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: No new packages or infrastructure needed — this is a code migration within `ghosts/npc-agent/`.

- [ ] T001 Review `ghosts/funder-agent/src/executor.ts` and `ghosts/funder-agent/src/buildAgentCard.ts` to extract all logic that moves into npc-agent (inbox poll, state maps, contract MCP calls, QUESTIONS bank)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Type system and parser extensions that all three user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Add `behaviorKind: "rule-engine" | "funder"` to `CharacterDefinition` in `ghosts/npc-agent/src/types.ts` (optional field, default `"rule-engine"`)
- [ ] T003 Extend `parseCharacterGramText` in `ghosts/npc-agent/src/catalog/parse-character-gram.ts` to read `behaviorKind` via `strProp`, validate against the closed set, and default to `"rule-engine"` when absent
- [ ] T004 Verify `pnpm typecheck` passes in `ghosts/npc-agent/` after T002 and T003

**Checkpoint**: Type system and parser ready — all story phases can now begin.

---

## Phase 3: User Story 1 — Funder character runs inside npc-agent (Priority: P1) 🎯 MVP

**Goal**: A funder ghost spawns alongside other NPC characters, advertises contracts, accepts "accept" messages, opens contracts, and evaluates submitted answers.

**Independent Test**: Spawn npc-agent into a live session. Confirm a funder ghost appears, responds to messages with the advertisement, opens a contract on "accept", and evaluates a submitted answer with `verdict: 1.0`.

### Implementation for User Story 1

- [ ] T005 [US1] Create `ghosts/npc-agent/src/behavior/funder-behavior.ts` with module-level state maps (`ghostState`, `contractToFunder`, `openContractCount`), the `QUESTIONS` bank, and exported functions: `funderTick(ghostId, mcp)`, `handleContractSubmitted(contractId, contractorId, mcpByGhostId)`, `clearFunderState(ghostId)`
- [ ] T006 [US1] Add conditional dispatch inside the tick `tryPromise` in `ghostActionLoop` in `ghosts/npc-agent/src/executor.ts`: when `characterDef.behaviorKind === "funder"` call `funderTick`; otherwise call `buildSnapshot` + `evaluateRules`
- [ ] T007 [US1] Call `clearFunderState(ghostId)` in `launchGhostLoop` in `ghosts/npc-agent/src/executor.ts` after `Fiber.interrupt(existing)` and before forking the new fiber, guarded by `characterDef.behaviorKind === "funder"`
- [ ] T008 [US1] Add `world.contract.submitted` routing in the world event dispatch block of `execute()` in `ghosts/npc-agent/src/executor.ts`: extract `contractId` and `contractorId` from `ev.payload`, call `handleContractSubmitted(contractId, contractorId, mcpByGhostId)`
- [ ] T009 [US1] Create `ghosts/npc-agent/catalog/funder.character.gram` with: character node (`id: "funder"`, `behaviorKind: "funder"`, `enabled: true`, `defaultAction: "go-random"`), minimal stub dialog tree (one idle node with wildcard self-loop), and `HAS_DIALOG` wiring edge
- [ ] T010 [P] [US1] Write unit tests in `ghosts/npc-agent/tests/funder-behavior.test.ts` covering: `funderTick` sends advertisement on any inbound message; `funderTick` opens a contract when inbox contains "accept"; `handleContractSubmitted` calls `eval_contract_evaluate` and resets state; `clearFunderState` removes all maps for the given ghostId
- [ ] T011 [US1] Run `pnpm test` in `ghosts/npc-agent/` — all existing tests must continue to pass, new funder tests must pass

**Checkpoint**: Funder character runs inside npc-agent and is fully testable.

---

## Phase 4: User Story 2 — funder-agent container retired (Priority: P2)

**Goal**: The Docker Compose stack runs with one fewer service while funder character interactions still work via npc-agent.

**Independent Test**: Remove `funder-agent` from `deploy/staging/docker-compose.yml`, start the stack, confirm npc-agent brings up the funder character and no missing-service errors occur.

### Implementation for User Story 2

- [ ] T012 [US2] Remove the `funder-agent` service block (build, environment, ports, networks, depends_on, healthcheck) from `deploy/staging/docker-compose.yml`
- [ ] T013 [US2] Verify `docker-compose config` (or `podman-compose config`) on `deploy/staging/docker-compose.yml` shows no reference to `funder-agent`
- [ ] T014 [P] [US2] Update `CLAUDE.md`: remove the `funder-agent` technology stack entry and add a `029-funder-into-npc` entry noting that the funder character now runs inside npc-agent

**Checkpoint**: Compose stack runs without funder-agent container.

---

## Phase 5: User Story 3 — Funder state cleared on re-spawn (Priority: P3)

**Goal**: Re-spawning a funder ghost discards any prior contract state and starts fresh in idle.

**Independent Test**: Spawn a funder ghost, open a contract (confirm `ghostState` is `awaiting_submission`), re-spawn the ghost, confirm state resets to idle and a stale `world.contract.submitted` event is silently ignored.

### Implementation for User Story 3

- [ ] T015 [US3] Verify T007 (clearFunderState call in launchGhostLoop) also clears `contractToFunder` and `openContractCount` for the given ghostId in `ghosts/npc-agent/src/behavior/funder-behavior.ts` — update `clearFunderState` if needed
- [ ] T016 [P] [US3] Add re-spawn test to `ghosts/npc-agent/tests/funder-behavior.test.ts`: after `clearFunderState`, all three maps return no entry for the cleared ghostId; a subsequent `handleContractSubmitted` for the old contractId returns without calling any MCP tool

**Checkpoint**: Re-spawn is clean — no dangling contract state.

---

## Phase 6: Polish & Documentation

**Purpose**: Documentation, cleanup, and final verification.

- [ ] T017 [P] Update `docs/architecture.md` if it references funder-agent as a separate deployed service
- [ ] T018 [P] Update `ghosts/npc-agent/README.md` to list the funder character in the catalog description
- [ ] T019 Run `pnpm run build` from repo root — must pass cleanly (hard gate per constitution)
- [ ] T020 Run `pnpm test` from repo root — all packages must pass
- [ ] T021 Run `/speckit-verify` and confirm GO verdict before opening PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 — core behavior migration
- **Phase 4 (US2)**: Depends on Phase 3 (funder must be in npc-agent before removing the container)
- **Phase 5 (US3)**: Depends on Phase 3 (re-spawn test requires funder state to exist first)
- **Phase 6 (Polish)**: Depends on Phases 3–5 all complete

### Within Each User Story

- T005 before T006, T007, T008 (funder-behavior.ts must exist before executor.ts calls into it)
- T009 before T011 (gram file must exist for catalog-loader test to pass)
- T010 and T009 can run in parallel with each other

### Parallel Opportunities

- T010 (write funder tests) and T009 (write gram file) can run in parallel
- T014 (CLAUDE.md update) can run in parallel with T012 and T013
- T017 and T018 (doc updates) can run in parallel with each other
- Phases 4 and 5 can run in parallel once Phase 3 is complete

---

## Parallel Example: Phase 3 (US1)

```bash
# T005 must complete first, then these can run in parallel:
Task T009: "Create ghosts/npc-agent/catalog/funder.character.gram"
Task T010: "Write unit tests in ghosts/npc-agent/tests/funder-behavior.test.ts"
# Then sequentially:
Task T006: dispatch seam in executor.ts
Task T007: clearFunderState call in launchGhostLoop
Task T008: world.contract.submitted routing
# Finally:
Task T011: pnpm test
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2 (fast — only type + parser changes)
2. Complete Phase 3 (core migration)
3. **STOP and VALIDATE**: Run tests, confirm funder character works in npc-agent
4. Proceed to Phase 4 (remove container) only after Phase 3 passes

### Incremental Delivery

1. Phase 1 + 2 → Type system ready
2. Phase 3 → Funder runs in npc-agent (MVP: functional parity)
3. Phase 4 → Container retired (deployment simplification goal achieved)
4. Phase 5 → Re-spawn correctness (cleanup/robustness)
5. Phase 6 → Polish and PR

---

## Notes

- No new npm dependencies needed — all required packages already in `ghosts/npc-agent/package.json`
- The `ghosts/funder-agent/` package directory is left in the repo but not built or deployed; deletion can happen in a follow-up cleanup PR
- DCO sign-off required on all commits: `git commit -s`
