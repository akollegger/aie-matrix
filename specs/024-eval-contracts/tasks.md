# Tasks: Eval Contracts Between Ghosts

**Input**: Design documents from `specs/024-eval-contracts/`  
**Branch**: `024-eval-contracts`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/mcp-tools.md ✓, quickstart.md ✓

**Tests**: Unit tests ship with each user story (in-memory layer). Integration tests (Neo4j) ship in the Polish phase.

**Organization**: Tasks are grouped by user story. US1–US3 are all P1 and sequential by protocol design (open → accept/submit → evaluate). US4 (group contractor) extends US3's settlement path.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Types and error classes that every subsequent phase depends on.

- [x] T001 [P] Add `shared/types/src/eval-contract.ts` with `EvalContractId`, `EvalContractState` union, and `EvalContract` interface per data-model.md
- [x] T002 [P] Export new eval-contract types from `shared/types/src/index.ts`
- [x] T003 Add `server/world-api/src/eval-contract-errors.ts` with all six `Data.TaggedError` classes and `EvalContractError` union type per plan.md Phase 2
- [x] T004 Mark RFC-0022 status as `accepted` in `proposals/rfc/0022-eval-contract-protocol.md`; update `specs/024-eval-contracts/spec.md` status field from `Draft` to `accepted`

**Checkpoint**: `pnpm typecheck` passes; error types importable from `server/world-api/src/eval-contract-errors.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: GroupService extension + service interface and skeleton implementations wired into the server. No story logic yet — just the Effect service scaffolding.

- [x] T005 Add `getGroupMembers(groupId: GroupId): Effect.Effect<ActorId[], GroupNotFound>` to `server/world-api/src/GroupService.ts` interface, `GroupServiceInMemory.ts`, and `GroupServiceLive.ts` — required by T022 to freeze beneficiaries at contract acceptance
- [x] T006 Create `server/world-api/src/EvalContractService.ts` — `EvalContractServiceOps` interface with all seven method signatures and `EvalContractService` Context.Tag, per plan.md Phase 3
- [x] T007 Create `server/world-api/src/EvalContractServiceInMemory.ts` — stub Layer backed by `Map<EvalContractId, EvalContract>` with all methods returning `Effect.fail(new EvalContractNotFound(...))` placeholder; includes `LedgerServiceInMemory` and `GroupServiceInMemory` as peer dependencies
- [x] T008 Create `server/world-api/src/EvalContractServiceLive.ts` — stub Neo4j Layer with same method signatures; real logic filled in during Polish phase
- [x] T009 Add `EvalContractService` to the `ToolServices` union type in `server/world-api/src/mcp-server.ts` and wire `EvalContractServiceLive` into the `Layer.mergeAll(...)` composition in `server/world-api/src/live/`

**Checkpoint**: `pnpm run build` passes from repo root with no new errors

---

## Phase 3: User Story 1 — Client Opens a Contract (P1) 🎯 MVP

**Goal**: A client ghost with sufficient resources can open a contract; the staked amount is debited immediately into a per-contract escrow actor.

**Independent Test**: After completing this phase, call `eval_contract_open` via MCP and confirm (a) contract is in `Open` state, (b) client bag is debited, (c) `eval_contract_get` returns the contract to the named parties and is rejected for other callers.

### Implementation for User Story 1

- [x] T010 [US1] Implement `openContract` in `EvalContractServiceInMemory.ts`: validate evaluator ≠ contractor, register synthetic escrow actor (`"escrow:<id>"`), commit ledger movement `clientBag → escrow`, store contract record in `Open` state
- [x] T011 [US1] Implement `getContract` in `EvalContractServiceInMemory.ts`: return the stored record; reject with `EvalContractNotAuthorized` if caller is not client, contractor, or evaluator
- [x] T012 [US1] Implement `listContracts` in `EvalContractServiceInMemory.ts`: filter by caller role (client/contractor/evaluator) and optional state parameter
- [x] T013 [P] [US1] Add unit tests for US1 in `server/world-api/src/EvalContractService.test.ts`: happy-path open, insufficient-funds rejection, evaluator=contractor rejection, request-payload immutability rejection (FR-009), get by party, get by non-party rejection, list filters
- [x] T014 [P] [US1] Register `eval_contract_open`, `eval_contract_get`, and `eval_contract_list` MCP tools in `server/world-api/src/mcp-server.ts` per `contracts/mcp-tools.md`

**Checkpoint**: `pnpm test` passes; smoke-test `eval_contract_open` + `eval_contract_get` via MCP as described in quickstart.md

---

## Phase 4: User Story 2 — Contractor Accepts and Submits (P1)

**Goal**: A contractor ghost can accept an open contract (starting the work window), submit a response before the deadline, or decline. A contract whose deadline passes without submission transitions to `Expired` and settles at v=0.

**Independent Test**: After completing this phase, a full accept→submit flow returns a contract in `Submitted` state with an immutable submission. A decline returns the full stake to the client. Calling `eval_contract_submit` on a deadline-expired contract triggers the `Expired` → settled path.

### Implementation for User Story 2

- [x] T015 [US2] Implement `acceptContract` in `EvalContractServiceInMemory.ts`: verify caller is contractor, verify state is `Open`, transition to `Accepted`, freeze beneficiary list (empty array for ghost contractors)
- [x] T016 [US2] Implement `declineContract` in `EvalContractServiceInMemory.ts`: verify caller is contractor, verify state is `Open`, commit ledger movement `escrow → clientBag`, transition to `Declined`
- [x] T017 [US2] Implement `submitContract` in `EvalContractServiceInMemory.ts`: verify caller is contractor, verify state is `Accepted`, lazy-check deadline (if expired: commit `escrow → clientBag`, transition to `Expired`, return error `EvalContractDeadlineExpired`), record immutable submission, transition to `Submitted`
- [x] T018 [US2] Extract lazy expiry check helper from T017 and apply it in `acceptContract`, `getContract`, and `listContracts`: if state is `Accepted` and `Date.now() > deadline`, commit `escrow → clientBag` and transition to `Expired` before returning
- [x] T019 [P] [US2] Add unit tests for US2 in `EvalContractService.test.ts`: accept happy path, decline happy path, submit happy path, submit-after-deadline triggers `Expired` state (not `Settled` directly), attempt to re-submit rejected, attempt to modify submission rejected, NotAuthorized for wrong caller
- [x] T020 [P] [US2] Register `eval_contract_accept`, `eval_contract_decline`, and `eval_contract_submit` MCP tools in `server/world-api/src/mcp-server.ts`

**Checkpoint**: `pnpm test` passes; smoke-test accept→submit via MCP

---

## Phase 5: User Story 3 — Evaluator Issues Verdict and Contract Settles (P1)

**Goal**: The named evaluator issues a verdict v ∈ [0,1]; the system immediately executes atomic settlement (contractor receives `floor(stake × v)`, client receives remainder) with zero residual in escrow.

**Independent Test**: After completing this phase, a full open→accept→submit→evaluate flow settles correctly. Verify `contractorPayment + clientRefund === stakeAmount` for verdicts 0.0, 0.5, 0.75, and 1.0. Verify that evaluator = contractor is rejected.

### Implementation for User Story 3

- [x] T021 [US3] Implement `evaluateContract` in `EvalContractServiceInMemory.ts`: verify caller is evaluator, verify caller is not contractor or beneficiary, verify state is `Submitted`, record verdict, execute ghost-contractor settlement (two ledger movements: `escrow → contractorBag`, `escrow → clientBag`) using floor arithmetic, transition to `Settled`
- [x] T022 [P] [US3] Add unit tests for US3 in `EvalContractService.test.ts`: verdict 1.0 (full payment), verdict 0.0 (full refund), verdict 0.75 (proportional), evaluator=contractor rejected, evaluator=beneficiary rejected, wrong-state rejected, settlement invariant (`contractor + client === stake`) for all integer stakes and verdicts
- [x] T023 [P] [US3] Register `eval_contract_evaluate` MCP tool in `server/world-api/src/mcp-server.ts`

**Checkpoint**: `pnpm test` passes; full lifecycle smoke-test from quickstart.md runs end-to-end via MCP

---

## Phase 6: User Story 4 — Group Contractor Receives Proportional Shares (P2)

**Goal**: When the contractor is a group, the member list is frozen at acceptance as beneficiaries. Settlement pays each beneficiary an equal share (`floor(stake × v / N)`) directly, with any integer remainder returned to the client.

**Independent Test**: After completing this phase, open a contract naming a group of N members as contractor. Accept (observe beneficiary list frozen), submit, evaluate. Each member's bag increases by `floor(stake × v / N)` and client's refund equals `stake − (per_share × N)`.

### Implementation for User Story 4

- [x] T024 [US4] Update `acceptContract` in `EvalContractServiceInMemory.ts`: if `contractorId` is a `GroupId`, call `GroupService.getGroupMembers(contractorId)` (added in T005) to fetch current members and freeze them as the `beneficiaries` array on the contract record
- [x] T025 [US4] Update `evaluateContract` in `EvalContractServiceInMemory.ts`: if `beneficiaries.length > 0`, use N+1 movement group settlement path — `per_share = floor(stake × v / N)`, one ledger movement per beneficiary, remainder to client
- [x] T026 [P] [US4] Add unit tests for US4 in `EvalContractService.test.ts`: beneficiaries frozen at accept (not at open), post-accept membership change not reflected, settlement with N=2 produces correct per-share and remainder, N=1 edge case, evaluator-is-beneficiary rejection
- [x] T027 [P] [US4] Update `eval_contract_accept` MCP tool response to include `beneficiaries` array in `server/world-api/src/mcp-server.ts`

**Checkpoint**: `pnpm test` passes; group-contractor lifecycle verifiable via MCP with a test group

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Neo4j live implementation, integration tests, and documentation finalization.

- [ ] T028 Implement all methods in `EvalContractServiceLive.ts` using Neo4j Cypher: `MERGE/CREATE (:EvalContract {...})` on open; `MATCH (:EvalContract {id}) SET state=...` on transitions; `MATCH WHERE clientId=... OR contractorId=... OR evaluatorId=...` for list
- [ ] T029 [P] Add integration tests (skipped when `NEO4J_URI` absent) covering the same happy-path and error cases as unit tests, using the live layer against a real Neo4j instance
- [ ] T030 [P] Update `docs/architecture.md` to add eval contract service to the world subsystem section
- [ ] T031 [P] Update `server/world-api/README.md` to note the new `eval_contract_*` MCP tools
- [ ] T032 Run the full quickstart.md smoke-test sequence against the dev server and confirm all steps succeed
- [ ] T033 Run `pnpm run build` from repo root and confirm clean build (required gate before PR)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately; T001 and T002 can run in parallel with T003
- **Phase 2 (Foundational)**: Depends on Phase 1 completion — BLOCKS all user story phases; T005 (GroupService extension) must complete before T024
- **Phase 3 (US1)**: Depends on Phase 2; no dependency on US2–US4
- **Phase 4 (US2)**: Depends on Phase 3 (needs `openContract` and the lazy-expiry check pattern)
- **Phase 5 (US3)**: Depends on Phase 4 (needs `submitContract`)
- **Phase 6 (US4)**: Depends on Phase 5 (extends the settlement path in `evaluateContract`) and T005 (GroupService `getGroupMembers`)
- **Phase 7 (Polish)**: Depends on all story phases

### Within Each Phase

- Models/types before services
- In-memory implementation before MCP tool registration
- Unit tests written in parallel with implementation (different file: `EvalContractService.test.ts`)

### Parallel Opportunities Within Phases

| Phase | Parallel tasks |
|---|---|
| 1 | T001 + T002 (types file and index export) alongside T003 (errors file) |
| 3 | T013 (unit tests) alongside T010–T012 (implementation); T014 (MCP tools) after T010 |
| 4 | T019 (unit tests) alongside T015–T018; T020 (MCP tools) after T015 |
| 5 | T022 (unit tests) alongside T021; T023 (MCP tools) after T021 |
| 6 | T026 (unit tests) alongside T024–T025; T027 (MCP update) after T024 |
| 7 | T029, T030, T031 can all run in parallel once T028 is complete |

---

## Parallel Example: User Story 3

```bash
# Run in parallel:
Task T021: "Implement evaluateContract in EvalContractServiceInMemory.ts"
Task T022: "Add verdict/settlement unit tests in EvalContractService.test.ts"

# After T021 completes:
Task T023: "Register eval_contract_evaluate MCP tool in mcp-server.ts"
```

---

## Implementation Strategy

### MVP Scope (US1 + US2 + US3 only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundational (T005–T009) — required gate
3. Complete Phase 3: US1 — client opens contract, escrow debited, read access enforced
4. **Validate**: `eval_contract_open` + `eval_contract_get` work via MCP
5. Complete Phase 4: US2 — contractor flow + expiry
6. Complete Phase 5: US3 — evaluator verdict + settlement
7. **Validate**: Full lifecycle smoke-test from quickstart.md passes

### Full Delivery

Add Phase 6 (US4 group contractor) after MVP validation, then Polish phase before PR.

---

## Notes

- `EvalContractService.test.ts` accumulates tests from US1–US4 in a single file; each story's tests are in a clearly labeled `describe()` block
- T005 adds `getGroupMembers` to GroupService — this is a small targeted addition to an existing service, not a new service
- The Neo4j live layer (Phase 7) can be worked in parallel with US4 if team capacity allows, since it touches a different file
- `pnpm run build` (not just `pnpm typecheck`) is a hard gate before opening a PR per the constitution
