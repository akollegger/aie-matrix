# Tasks: A2A Ghost House Proof-of-Concept Spike

**Input**: Design documents from `specs/008-a2a-ghost-house-spike/`  
**Branch**: `008-a2a-ghost-house-spike`  
**Spike sandbox**: `spikes/a2a-ghost-agent-protocol/` (isolated; not in pnpm workspace)  
**Charter / ADR / RFC**: `proposals/spikes/spike-a2a-ghost-house-poc.md`, `proposals/adr/0004-a2a-ghost-agent-protocol.md`, `proposals/rfc/0007-ghost-house-architecture.md`

**Tests**: No TDD requested. Each user story includes **smoke** verification via npm scripts and README runbooks per `plan.md`. Optional HTTP assertion scripts may be added under each sub-project’s `src/` if useful.

**Organization**: Phases follow spec user stories — **US1** (SDK maturity), **US2** (contribution model), **US3** (gating docs). Runnable code **only** under `spikes/a2a-ghost-agent-protocol/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: `US1`, `US2`, `US3` from `spec.md` user stories
- Every task includes at least one concrete file or directory path

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create isolated sub-project shells; no imports from `packages/` or `server/`.

- [x] T001 [P] Create `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/package.json` with `"type": "module"`, Node 24–compatible ESM fields, `typescript` devDependency, and `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/tsconfig.json` targeting `src/`
- [x] T002 [P] Create `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/package.json` and `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/tsconfig.json` with `src/` entry layout
- [x] T003 [P] Create `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/package.json` and `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/tsconfig.json` with `src/` entry layout
- [x] T004 Add `@a2a-js/sdk` runtime dependency (pin version in lockfile) to `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/package.json`, `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/package.json`, and `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/package.json` where each sub-project needs the SDK
- [x] T005 Verify `spikes/a2a-ghost-agent-protocol/README.md` links to `specs/008-a2a-ghost-house-spike/spec.md`, `specs/008-a2a-ghost-house-spike/quickstart.md`, and the three proposal paths; add any missing anchors

**Checkpoint**: Each sub-project runs `npm install` locally without touching repo-root `pnpm-workspace.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Scripts and report stubs so user-story work has a consistent entry point. **No user story implementation before this phase completes.**

**⚠️ CRITICAL**: Do not begin US1–US3 feature logic until T010 is done.

- [x] T006 Add `build` and `smoke` npm scripts to `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/package.json` (`smoke` may call a stub until US1 completes)
- [x] T007 [P] Add `dev`, `build`, and `start` npm scripts to `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/package.json` per README needs
- [x] T008 [P] Add `dev`, `build`, and `start` npm scripts to `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/package.json` per README needs
- [x] T009 [P] Insert FR-008 section heading scaffold into `spikes/a2a-ghost-agent-protocol/reports/spike-a-sdk-maturity.md` (*What worked*, *What didn’t*, *What we learned*, *Recommendation*)
- [x] T010 [P] Insert FR-008 section heading scaffold into `spikes/a2a-ghost-agent-protocol/reports/spike-b-contribution-model.md`

**Checkpoint**: `npm run build` (or documented equivalent) succeeds in each sub-project with stub `src/` entrypoints

---

## Phase 3: User Story 1 — Core Team Validates SDK Readiness (Priority: P1) 🎯 MVP

**Goal**: Spike A exercises `@a2a-js/sdk` for sync task, streaming task, push notification, and agent-card publish/discover (`spec.md` FR-001–FR-004).

**Independent Test**: `npm run smoke` in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/` completes with evidence captured in `spikes/a2a-ghost-agent-protocol/reports/spike-a-sdk-maturity.md`.

### Implementation for User Story 1

- [x] T011 [US1] Implement synchronous host→agent task round-trip per `spec.md` FR-001 in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/src/`
- [x] T012 [US1] Implement streaming task with multiple agent-side updates per `spec.md` FR-002 in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/src/`
- [x] T013 [US1] Implement host push to agent webhook (or SDK-equivalent push surface) per `spec.md` FR-003 in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/src/`
- [x] T014 [US1] Implement agent card publication and host-side discovery per `spec.md` FR-004 in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/src/`
- [x] T015 [US1] Wire `npm run smoke` in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/package.json` to run all four exercises sequentially with non-zero exit on failure
- [x] T016 [US1] Document ports, start order, and log capture for Spike A in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/README.md`
- [x] T017 [US1] Complete `spikes/a2a-ghost-agent-protocol/reports/spike-a-sdk-maturity.md` with pass/fail per pattern, operator-error vs SDK-defect labels, and ADR-0004 escalation notes per `spec.md` FR-008 and edge cases

**Checkpoint**: Spike A time box satisfied or explicitly escalated with written evidence (`spec.md` SC-001)

---

## Phase 4: User Story 2 — Simulated Third Party Validates Contribution Friction (Priority: P2)

**Goal**: Skeleton house + sample agent; single registration path; spawn; one synthetic event and response; contributor timing (`spec.md` FR-005–FR-007, SC-003).

**Independent Test**: Cold contributor follows `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/README.md` + `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/README.md` only; wall-clock recorded in `spikes/a2a-ghost-agent-protocol/reports/spike-b-contribution-model.md`.

### Implementation for User Story 2

- [x] T018 [US2] Implement catalog and **one** primary registration entry path per `spec.md` FR-005 in `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/src/`
- [x] T019 [US2] Implement spawn/session start distinguishable in logs per `spec.md` FR-006 in `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/src/`
- [x] T020 [US2] Emit synthetic world event payload conforming to `specs/008-a2a-ghost-house-spike/contracts/ic-008-spike-synthetic-world-event.md` from `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/src/` per `spec.md` FR-007
- [x] T021 [US2] Implement minimal contributed agent (card + handlers) in `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/src/` that receives the synthetic event and returns a capturable response
- [x] T022 [US2] Author operator runbook for the house in `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/README.md` (registration path highlighted first)
- [x] T023 [US2] Author contributor-facing steps and wall-clock worksheet in `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/README.md`
- [x] T024 [US2] Fill `spikes/a2a-ghost-agent-protocol/reports/spike-b-contribution-model.md` with FR-008 sections, SC-003 timing result, infrastructure prerequisites, and filled field matrix per `specs/008-a2a-ghost-house-spike/contracts/ic-009-rfc-0007-agent-card-field-matrix.md`

**Checkpoint**: Spike B time box satisfied or escalated in writing (`spec.md` SC-002)

---

## Phase 5: User Story 3 — Architecture Owners Receive Gating Recommendations (Priority: P3)

**Goal**: Executives can decide proceed / proceed with changes / reconsider without reading throwaway code (`spec.md` User Story 3, FR-009).

**Independent Test**: A reader opens only the executive summaries in `spikes/a2a-ghost-agent-protocol/reports/*.md` plus `spikes/a2a-ghost-agent-protocol/reports/adr-0004-appendix-draft.md` and sees explicit recommendations with citations.

### Implementation for User Story 3

- [x] T025 [US3] Add executive summary (≤12 lines) to top of `spikes/a2a-ghost-agent-protocol/reports/spike-a-sdk-maturity.md` and `spikes/a2a-ghost-agent-protocol/reports/spike-b-contribution-model.md`
- [x] T026 [US3] Create merge-ready appendix body in `spikes/a2a-ghost-agent-protocol/reports/adr-0004-appendix-draft.md` citing both spike reports for `proposals/adr/0004-a2a-ghost-agent-protocol.md`
- [x] T027 [US3] Create `spikes/a2a-ghost-agent-protocol/reports/rfc-0007-open-questions-delta.md` listing RFC section ids/headings to edit with one-line rationale each for `proposals/rfc/0007-ghost-house-architecture.md`

**Checkpoint**: `spec.md` SC-004 documentation action items are enumerated as PR-ready bullets

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Quickstart truth, index hygiene, optional charter status.

- [x] T028 Run flows from `specs/008-a2a-ghost-house-spike/quickstart.md` against finished spike code; fix command drift in `spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/README.md`, `spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/README.md`, and `spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/README.md`, and update `specs/008-a2a-ghost-house-spike/quickstart.md` if paths or script names changed
- [x] T029 Finalize index links in `spikes/a2a-ghost-agent-protocol/reports/README.md` pointing to completed `spike-a-sdk-maturity.md`, `spike-b-contribution-model.md`, `adr-0004-appendix-draft.md`, and `rfc-0007-open-questions-delta.md`
- [x] T030 [P] Optional: set **Status** field in `proposals/spikes/spike-a2a-ghost-house-poc.md` to completed when reports are final

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 → Phase 2**: Directory + package metadata must exist before scripts and report stubs.
- **Phase 2 → Phase 3+**: US1–US3 assume `npm run smoke` / `dev` entrypoints exist.
- **Phase 3 (US1) → Phase 4 (US2)**: **Recommended** sequential for a single developer (reuse learnings); two developers may parallelize after Phase 2 only if house work does not depend on unresolved SDK unknowns.
- **Phase 4 (US2) → Phase 5 (US3)**: Report bodies (T017, T024) should exist before appendix polish.
- **Phase 6**: After US3 tasks or concurrently once T024/T017 content is stable.

### User Story Dependencies

- **US1**: Depends on Phase 2 only.
- **US2**: Depends on Phase 2; soft dependency on US1 for SDK familiarity (not a file dependency).
- **US3**: Depends on T017 and T024 content.

### Parallel Opportunities

- **Phase 1**: T001, T002, T003 may run in parallel; T004 follows once `package.json` files exist (single task touching three files).
- **Phase 2**: T007, T008, T009, T010 parallel after T006 or include T006 first then parallelize the rest.
- **Phase 3**: T011–T014 may be parallelized across different `src/` modules **if** shared bootstrap file conflicts are avoided (otherwise sequential).
- **Phase 4**: T022 and T023 parallel while T018–T021 land.
- **Phase 6**: T030 parallel with T028–T029 if non-conflicting.

### Parallel Example: Phase 1

```bash
# After shared agreement on Node/tsconfig baseline:
Task T001 → spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise/
Task T002 → spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house/
Task T003 → spikes/a2a-ghost-agent-protocol/spike-b-sample-agent/
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 and Phase 2.  
2. Complete Phase 3 (US1) through T017.  
3. **STOP**: Spike A report stands alone as a decision input.

### Incremental Delivery

1. Phase 1–2 foundation.  
2. Phase 3 (US1) + report.  
3. Phase 4 (US2) + report.  
4. Phase 5 (US3) appendix + RFC delta.  
5. Phase 6 quickstart/index polish.

### Parallel Team Strategy

- Developer A: Phase 3 (`spike-a-sdk-exercise/`)  
- Developer B: Phase 2 scaffolding for house/agent while A spikes SDK (coordinate on ports)  
- Tech writer: T025–T027 as drafts once T017/T024 have bullet notes

---

## Notes

- Do **not** add `spikes/` paths to repo-root `pnpm-workspace.yaml`.  
- Do **not** import from `packages/*` or `server/*`.  
- Keep authentication explicitly listed as an open question in both reports.  
- Commit after each phase or logical task group with `git commit -s`.
