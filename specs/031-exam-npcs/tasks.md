# Tasks: Structured Exam NPCs (Quizmaster & Contestant)

**Input**: Design documents from `specs/031-exam-npcs/`  
**Branch**: `031-exam-npcs`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure working tree is ready and RFC documentation is updated before code changes.

- [ ] T001 Add `## Resolution` section to `proposals/rfc/0027-structured-exam-artifact.md` — humans author `.exam.gram`; quizmaster loads and compiles at startup; markdown+frontmatter is the exchange artifact and hash target; artifact format and hash content are deliberately decoupled. Mark Open Questions 1 and 7 resolved.
- [ ] T002 Add addendum to `proposals/rfc/0022-eval-contract-protocol.md` — document `artifactRef` and `disclosureRef` fields on EvalContract; document proportional settlement formula `ceil(verdict × stakeAmount)`; clarify that `submission` field carries quizmaster's record of contestant answers (MVP trust tier).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: EvalContract schema extension and exam compiler — both WP-1 and WP-2 from the plan. These are independent of each other and can run in parallel, but both must be complete before Phase 3.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### WP-1 — EvalContract schema extension

- [ ] T003 [P] Add `artifactRef: string | null` and `disclosureRef: string | null` to `EvalContract` interface in `shared/types/src/eval-contract.ts`. No `passMark` field — settlement is proportional via existing formula.
- [ ] T004 [P] Extend `EvalContractServiceOps.openContract` params in `server/world-api/src/EvalContractService.ts` — add optional `artifactRef?: string` and `disclosureRef?: string`; both default to `null`.
- [ ] T005 Update `EvalContractServiceInMemory` in `server/world-api/src/EvalContractServiceInMemory.ts` — store `artifactRef` and `disclosureRef` with `null` defaults on all contract creation paths.
- [ ] T006 Update `EvalContractServiceLive` in `server/world-api/src/EvalContractServiceLive.ts` — extend CREATE Cypher to persist new fields; extend RETURN clause to hydrate them (absent Neo4j property → `null`).
- [ ] T007 Extend `eval_contract_open` MCP tool handler in `server/world-api/src/mcp-server.ts` — accept optional `artifactRef` and `disclosureRef` input fields; pass through to `openContract`.
- [ ] T008 Add unit tests to `server/world-api/src/EvalContractService.test.ts` — quizmaster-path: `openContract` with both artifact refs present; broker-path: `openContract` with no refs → fields are `null` on returned contract.
- [ ] T009 Run `pnpm run build` from repo root and confirm clean compile after WP-1 changes.

### WP-2 — Exam compiler (parallel with WP-1)

- [ ] T010 [P] Create `ghosts/npc-agent/src/exam/parse-exam-gram.ts` — use `@relateby/pattern` `parsePatterns` to load a `.exam.gram` file; extract `Problem` nodes and their rubric relationship labels (`ExactMatch`, `Numerical`) and properties; return `QuestionSnippet[]` sorted lexicographically by `id`.
- [ ] T011 [P] Create `ghosts/npc-agent/src/exam/snippet-compiler.ts` — serialize each `QuestionSnippet` to the canonical markdown+frontmatter format defined in `specs/031-exam-npcs/contracts/exam-snippet-format.md`; expose `toPromptOnly(q)` (no `correct` field) and `toFull(q)` (with `correct`) functions.
- [ ] T012 [P] Create `ghosts/npc-agent/src/exam/hash-artifact.ts` — export `hashSnippets(snippets: string[]): string` using `node:crypto` sha256 over `Buffer.concat(snippets.map(s => Buffer.from(s, 'utf8')))` → lowercase hex string.
- [ ] T013 Create `ghosts/npc-agent/src/exam/exam.test.ts` — unit tests covering: (a) snippet serialization produces exact expected bytes for a known question; (b) hash is stable across two calls with same input; (c) prompt-only snippet has no `correct` field; (d) full snippet has `correct` field; (e) submission snippet has both `correct` and `answer` fields.
- [ ] T014 Run `pnpm test` in `ghosts/npc-agent` and confirm exam compiler tests pass.

**Checkpoint**: Foundation complete — WP-1 and WP-2 done. User story phases can now begin.

---

## Phase 3: User Story 3 — Quizmaster loads a gram-authored exam at startup (Priority: P3) 🎯 Foundation for all exam behavior

> Note: US3 is implemented before US1/US2 because the quizmaster character and startup exam loading are prerequisites for the full exam cycle. P3 here refers to spec priority; implementation order is P3 → P1 → P2.

**Goal**: A quizmaster character configured with `examPath` loads and compiles the gram file at spawn time, logs both artifact hashes, and is ready to conduct exams.

**Independent Test**: Start npc-agent with `quizmaster.character.gram` pointing to a valid `.exam.gram`. Confirm startup logs contain `artifactRef` and `disclosureRef` hex strings. Manually verify one compiled snippet matches the gram source.

- [ ] T015 [US3] Extend `CharacterDefinition` in `ghosts/npc-agent/src/types.ts` — add `"quizmaster" | "contestant"` to `behaviorKind` union; add optional `examPath: string` field (quizmaster only).
- [ ] T016 [US3] Update `ghosts/npc-agent/src/catalog/parse-character-gram.ts` — parse `examPath` property from quizmaster gram nodes; leave undefined for other behavior kinds.
- [ ] T017 [US3] Extend `EvalContractOpenArgs` in `ghosts/npc-agent/src/mcp-effect.ts` — add optional `artifactRef?: string` and `disclosureRef?: string` fields; pass through to MCP tool call.
- [ ] T018 [US3] Create `ghosts/npc-agent/catalog/quizmaster.character.gram` — quizmaster character with `behaviorKind: "Quizmaster"`, `examPath` pointing to a sample exam gram file, `stakeAmount: 5`, dialog tree with idle greeting "I have questions for you. Reply **accept** to take the exam."
- [ ] T019 [US3] Create a sample exam file `ghosts/npc-agent/catalog/bitcoin-basics.exam.gram` — three questions: one `multiple_choice` (ExactMatch), one `short_answer` (ExactMatch), one `numerical` (Numerical). Use Bitcoin consensus as the subject per RFC-0027 running example.
- [ ] T020 [US3] Create `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — implement `loadExam(examPath: string, catalogDir: string): Promise<ExamDefinition>` using the exam compiler from Phase 2; compute `artifactRef` and `disclosureRef`; log both on load.
- [ ] T021 [US3] Wire quizmaster spawn in `ghosts/npc-agent/src/executor.ts` — in `launchGhostLoop`, call `loadExam` for `behaviorKind === "quizmaster"` characters; store `ExamDefinition` in a per-ghostId map; add `"quizmaster"` case to `Match.exhaustive` tick dispatch (tick is no-op at this stage).
- [ ] T022 [US3] Add unit tests for `loadExam` in `ghosts/npc-agent/src/behavior/quizmaster-behavior.test.ts` — mock file system; confirm `ExamDefinition` has correct question count, `artifactRef` differs from `disclosureRef`, prompt-only snippets contain no `correct` fields.
- [ ] T023 [US3] Run `pnpm test` in `ghosts/npc-agent` and `pnpm run build` from root — both pass.

**Checkpoint**: Quizmaster loads exam at startup. US3 is independently verifiable.

---

## Phase 4: User Story 1 — Ghost takes a quizmaster exam and earns credits (Priority: P1) 🎯 MVP

**Goal**: Complete happy-path exam cycle: quizmaster offers contract → contestant accepts → questions delivered one-at-a-time → answers recorded → verdict posted → proportional credit payout.

**Independent Test**: Deploy quizmaster and contestant NPCs in a test session. Contestant automatically completes the exam and receives `ceil(verdict × stakeAmount)` credits — observable in ledger logs without manual intervention.

### Quizmaster conversation and contract flow

- [ ] T024 [US1] Implement quizmaster state machine in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — states: `idle | greeting | conducting | evaluating`; add `quizmasterTick(ghostId)` (inbox-driven advertising, same pattern as broker) and `quizmasterHandleAccept(ghostId, from)` (creates eval contract with `artifactRef`/`disclosureRef`, sends first question via `say()`).
- [ ] T025 [US1] Implement `quizmasterHandleAnswer(ghostId, from, text)` in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — records answer on `conducting` state; if more questions remain, sends next via `say()`; if last answer, assembles submission artifact (full snippets with `answer:` fields), calls `submitContract` with assembled text, then scores and calls `evalContractEvaluate` with computed verdict, then sends result message to contestant.
- [ ] T026 [US1] Implement verdict computation in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — `scoreAnswer(q: QuestionSnippet, answer: string): number` per rubric kind: `ExactMatch` → 1.0 if case-insensitive match, else 0.0; `Numerical` → 1.0 if `|answer - correct| ≤ tolerance`, else 0.0; `verdict = Σ(score × weight) / Σ(weight)`.
- [ ] T027 [US1] Implement `clearQuizmasterState(ghostId)` in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — remove per-ghost state and contract mapping (mirrors `clearBrokerState`).
- [ ] T028 [US1] Wire quizmaster message dispatch in `ghosts/npc-agent/src/executor.ts` — in `world.message.new` handler, add `behaviorKind === "quizmaster"` branch: `/^\s*accept\s*$/i` → `quizmasterHandleAccept`; any other text when in `conducting` phase → `quizmasterHandleAnswer`. Add `world.contract.submitted` routing for quizmaster (parallel to existing broker routing).
- [ ] T029 [US1] Wire quizmaster tick in `ghosts/npc-agent/src/executor.ts` — add `"quizmaster"` case to `Match.exhaustive` tick dispatch pointing to `quizmasterTick`.

### Contestant character and behavior

- [ ] T030 [US1] Create `ghosts/npc-agent/catalog/contestant.character.gram` — contestant character with `behaviorKind: "Contestant"`, `defaultAction: "go-random"`, dialog tree with idle greeting "Ready to be tested."
- [ ] T031 [US1] Create `ghosts/npc-agent/src/behavior/contestant-behavior.ts` — states: `idle | answering`; implement `contestantTick(ghostId)` (watches inbox for exam offers; replies `accept` to any offer); implement `contestantHandleQuestion(ghostId, from, text)` (parses question type from message text; generates answer: first option for `multiple_choice`, `"unknown"` for `short_answer`, `"0"` for `numerical`; sends via `say()`).
- [ ] T032 [US1] Wire contestant dispatch in `ghosts/npc-agent/src/executor.ts` — add `"contestant"` case to `Match.exhaustive` tick dispatch; add `world.message.new` branch for `behaviorKind === "contestant"` routing to `contestantHandleQuestion` when in `answering` phase.

### Tests

- [ ] T033 [US1] Add quizmaster state machine tests to `ghosts/npc-agent/src/behavior/quizmaster-behavior.test.ts` — cover: idle→conducting transition on accept; question sequencing (q1 sent, then q2 after answer); verdict computation for full-correct (1.0), partial (0.5 weighted), all-wrong (0.0); `submitContract` called before `evalContractEvaluate`.
- [ ] T034 [US1] Add contestant state machine tests to `ghosts/npc-agent/src/behavior/contestant-behavior.test.ts` — cover: idle→answering on question received; answer generation per question type; return to idle after last answer.
- [ ] T035 [US1] Run `pnpm test` in `ghosts/npc-agent` and `pnpm run build` from root — both pass.
- [ ] T036 [US1] Update `ghosts/npc-agent/README.md` — document `quizmaster` and `contestant` behavior kinds; describe the `.exam.gram` authoring workflow using `bitcoin-basics.exam.gram` as example; include end-to-end log trace showing the full exam cycle.

**Checkpoint**: Full exam cycle works end-to-end. US1 is independently verifiable. Note: FR-005 event log emission (T038) is implemented in Phase 5 — US1 acceptance scenario 3 (event log entries) is only fully verified after Phase 5.

---

## Phase 5: User Story 2 — Exam artifact is auditable after settlement (Priority: P2)

**Goal**: After a completed exam, any party can verify the quizmaster's verdict was honest: revealed full artifact hashes to `disclosureRef`; contestant answers in event log match quizmaster's submission record.

**Independent Test**: After a settled exam contract, run `sha256(submission text)` and confirm it matches the value derivable from the contract's `submission` field. Retrieve revealed full artifact and confirm `sha256` matches `disclosureRef`.

- [ ] T037 [US2] Verify `EvalContractServiceLive` persists and returns `artifactRef`/`disclosureRef` correctly by running `server/world-api` integration tests (or manual Neo4j inspection) against a completed quizmaster contract — confirm both fields survive a round-trip through Neo4j.
- [ ] T038 [US2] Add quizmaster event log emission in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — after each question-answer exchange, append a structured log entry (via existing logger) containing: `contractId`, `questionId`, `questionText`, `contestantAnswer`, `score`. This is the per-exchange event log record (RFC-0023 verifiable log).
- [ ] T039 [US2] Add post-verdict artifact reveal in `ghosts/npc-agent/src/behavior/quizmaster-behavior.ts` — after `evalContractEvaluate` succeeds, send the full artifact text (all full snippets concatenated) directly to the contractor via `say()`. This is the disclosure: the contractor (and any auditor with access to the conversation thread) can verify `sha256(bytes) === disclosureRef` on the contract. The bytes are NOT written to the ledger.
- [ ] T040 [US2] Document audit verification steps in `specs/031-exam-npcs/quickstart.md` — step-by-step: retrieve full artifact bytes from quizmaster's post-settlement `say()` message in the conversation thread; compute `sha256`; confirm it matches `disclosureRef` on the settled contract. Note that bytes travel via conversation, not the ledger. Include expected conversation snippet and `shasum` output.
- [ ] T041 [US2] Run end-to-end audit check per `quickstart.md` — start npc-agent, run one full exam cycle, extract full artifact bytes from the quizmaster's reveal `say()` message, compute `sha256`, confirm it matches `disclosureRef` on the settled contract. Document result.

**Checkpoint**: Audit trail is complete and verifiable with `sha256` + log inspection.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T042 [P] Run `pnpm run build` from repo root — clean compile across all packages.
- [ ] T043 [P] Run `pnpm test` across `server/world-api` and `ghosts/npc-agent` — all pass.
- [ ] T044 Update `docs/architecture.md` if the exam NPC pattern introduces any new boundary or service ownership worth recording.
- [ ] T045 Verify `proposals/rfc/0027-structured-exam-artifact.md` and `proposals/rfc/0022-eval-contract-protocol.md` cross-references are internally consistent after T001/T002 edits.
- [ ] T046 Run `/speckit-verify` or equivalent gate check — confirm GO verdict before opening PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. RFC updates do not block code.
- **Phase 2 (Foundational)**: WP-1 (T003–T009) and WP-2 (T010–T014) are independent of each other — run in parallel. Both must complete before Phase 3.
- **Phase 3 (US3)**: Depends on Phase 2 complete. Establishes quizmaster character and startup loading.
- **Phase 4 (US1)**: Depends on Phase 3. Adds conversation, contract, and contestant behavior.
- **Phase 5 (US2)**: Depends on Phase 4 (needs a working exam cycle to audit).
- **Phase 6 (Polish)**: Depends on all prior phases.

### Parallel Opportunities Within Phases

**Phase 2**:
- T003–T009 (WP-1) in parallel with T010–T014 (WP-2)

**Phase 3**:
- T015, T016, T017, T018, T019 are independent of each other (different files)

**Phase 4**:
- T030 (contestant gram) in parallel with T024–T029 (quizmaster behavior)
- T031–T032 (contestant behavior) can start once T030 is done

---

## Parallel Example: Phase 2

```bash
# WP-1 and WP-2 can run simultaneously:

# Stream A — EvalContract schema (T003–T009):
Task: "Add artifactRef/disclosureRef to shared/types/src/eval-contract.ts"
Task: "Extend openContract params in EvalContractService.ts"
Task: "Update EvalContractServiceInMemory.ts"
Task: "Update EvalContractServiceLive.ts"
Task: "Extend eval_contract_open MCP tool handler"
Task: "Add unit tests to EvalContractService.test.ts"

# Stream B — Exam compiler (T010–T014):
Task: "Create parse-exam-gram.ts"
Task: "Create snippet-compiler.ts"
Task: "Create hash-artifact.ts"
Task: "Create exam.test.ts"
```

---

## Implementation Strategy

### MVP Scope (US1 — Full exam cycle)

1. Complete Phase 1 (RFC updates)
2. Complete Phase 2 (foundational — WP-1 and WP-2 in parallel)
3. Complete Phase 3 (quizmaster startup loading)
4. Complete Phase 4 (full exam cycle with contestant)
5. **Validate**: Run npc-agent, observe complete exam cycle in logs
6. Phase 5 (audit trail) and Phase 6 (polish) follow

### Incremental Delivery

- After Phase 3: Quizmaster starts up, logs hashes, character is registered
- After Phase 4: Full exam cycle runs autonomously — credits transfer
- After Phase 5: Exam integrity is auditable by third parties
- Each phase is independently demonstrable

---

## Notes

- `[P]` tasks touch different files — no coordination needed
- Each user story phase is a complete, independently testable increment
- Quizmaster state machine mirrors broker pattern — read `broker-behavior.ts` first
- Settlement formula `ceil(verdict × stakeAmount)` is handled by existing `evaluateContract` — quizmaster only needs to pass the right `verdict` float
- Contestant answer quality is intentionally trivial for MVP — behavior correctness, not intelligence, is the goal
