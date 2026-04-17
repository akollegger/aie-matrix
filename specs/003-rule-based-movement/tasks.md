# Tasks: Rule-Based Movement (Gram + @relateby/pattern)

**Input**: Design documents from `specs/003-rule-based-movement/`  
**Branch**: `003-rule-based-movement`  
**RFC**: `proposals/rfc/0002-rule-based-movement.md`  
**Plan**: [plan.md](./plan.md)

**Tests**: Required by repo constitution and [plan.md](./plan.md): add `node:test` (or equivalent) under `server/world-api` plus fixtures; document commands in [quickstart.md](./quickstart.md) as they are implemented.

**Organization**: Phases follow user stories P1→P3 from [spec.md](./spec.md). Foundational work blocks all stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel-safe (different files, no dependency on incomplete sibling tasks)
- **[Story]**: `US1` / `US2` / `US3` only on user-story phases
- Paths are repo-root absolute style (package-relative paths inside `server/world-api/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependency, directories, and traceability to the governing RFC/spec.

- [X] T001 Add `@relateby/pattern` to `server/world-api/package.json` and run `pnpm install` from repository root
- [X] T002 [P] Create directory `server/world-api/src/rules/` and `server/world-api/src/rules/fixtures/` with a minimal valid starter `server/world-api/src/rules/fixtures/sandbox.rules.gram` (parseable by `Gram.parse`)
- [X] T003 Link `proposals/rfc/0002-rule-based-movement.md` and `specs/003-rule-based-movement/plan.md` from `server/world-api/README.md`

**Checkpoint**: Dependency installed, fixture path exists, docs point to proposals.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Parsing, matching primitives, and movement integration surface — **must** finish before user-story wiring.

**⚠️ CRITICAL**: No user story phase work until this checkpoint passes.

- [X] T004 Add `test` script (Node.js built-in test runner + TypeScript execution via `tsx` or documented equivalent) to `server/world-api/package.json`; add `tsx` to `server/world-api/package.json` `devDependencies` if not already available to that package
- [X] T005 Create `MovementRulesService` `Context.Tag` and `ParsedRuleset` / mode types in `server/world-api/src/rules/movement-rules-service.ts`
- [X] T006 Implement multi-label helper for map `tileClass` strings in `server/world-api/src/rules/tile-labels.ts` (colon-separated token convention until map schema grows explicit arrays)
- [X] T007 Implement `server/world-api/src/rules/gram-rules.ts` — read UTF-8 rules file from disk and `Gram.parse` via `@relateby/pattern` into `Effect` (surface `GramParseError` per package API)
- [X] T008 Implement allow-list `GO` matcher in `server/world-api/src/rules/match-go.ts` using parsed `Pattern<Subject>` data (direction + origin/destination label overlap + optional ghost constraints as design permits in v1)
- [X] T009 Extend `server/world-api/src/movement.ts` `evaluateGo` to accept rules configuration (permissive vs authored) and invoke matcher; return `GoFailure` with non-empty `code` and `reason` when no rule permits, per `specs/003-rule-based-movement/contracts/ic-003-go-evaluation.md`
- [X] T010 Export rule-loading utilities and types needed by orchestration from `server/world-api/src/index.ts`

**Checkpoint**: `pnpm --filter @aie-matrix/server-world-api typecheck` passes; matcher unit-testable in isolation.

---

## Phase 3: User Story 1 — Movement Follows Authored Rules (Priority: P1) 🎯 MVP

**Goal**: Ghost `go` respects Gram-authored allow-list rules; permissive mode preserves current behavior.

**Independent Test**: In-memory `LoadedMap` with two tile classes + authored rules: matching step succeeds; non-matching step returns denial with `code` + `reason`; permissive mode allows valid geometry.

- [X] T011 [US1] Extend `ToolServices` in `server/world-api/src/mcp-server.ts` to include `MovementRulesService`; merge `Layer.succeed(MovementRulesService, snapshot)` in the `servicesLayer` built inside `handleGhostMcpEffect` (alongside `WorldBridgeService` and `RegistryStoreService`)
- [X] T012 [US1] Update `goEffect` in `server/world-api/src/mcp-server.ts` to `yield* MovementRulesService` and pass rules snapshot + ghost context fields available from `RegistryStoreService` into `evaluateGo` (or thin wrapper), preserving geometry-first ordering from `contracts/ic-003-go-evaluation.md`
- [X] T013 [US1] In `server/src/index.ts`, load rules at startup with `Effect.runPromise` (from exports in T010), read `process.env` for mode + rules path (exact names documented in T018), compose `makeMovementRulesLayer` into `ManagedRuntime.make(Layer.mergeAll(...))`, fail fast on `GramParseError` when mode is authored per `contracts/ic-003-gram-ruleset.md`
- [X] T014 [P] [US1] Add `server/world-api/src/rules/gram-rules.test.ts` asserting `Gram.parse` succeeds for `server/world-api/src/rules/fixtures/sandbox.rules.gram`
- [X] T015 [US1] Add `server/world-api/src/movement_go_rules.test.ts` with a minimal `LoadedMap` fixture proving an allowed class transition succeeds and a disallowed transition returns `ok: false` with populated `code` and `reason`
- [X] T016 [US1] Extend tests in `server/world-api/src/movement_go_rules.test.ts` to cover **permissive** mode: no `RULESET_DENY` (or equivalent) for geometrically valid neighbor steps

**Checkpoint**: US1 done — MCP `go` uses rules service; automated tests green for authored + permissive paths.

---

## Phase 4: User Story 2 — Policy Independent of Map Geometry (Priority: P2)

**Goal**: Operators swap rules artifacts via configuration only; same map geometry, different outcomes.

**Independent Test**: Two env configurations (different `AIE_MATRIX_RULES_PATH` or mode) over the same `LoadedMap` fixture yield different permit/deny for at least one step.

- [X] T017 [US2] Add `server/world-api/src/rules/fixtures/restrictive.rules.gram` with a different allow-list than `server/world-api/src/rules/fixtures/sandbox.rules.gram` (both valid Gram)
- [X] T018 [US2] Document `AIE_MATRIX_RULES_PATH` and `AIE_MATRIX_RULES_MODE` (`authored` | `permissive`) in `server/world-api/README.md` and `.env.example` at repository root
- [X] T019 [P] [US2] Add `server/world-api/src/rules_mode_switch.test.ts` demonstrating identical map + direction is permitted under one loaded rules file and denied under the other (no map mutation between assertions)

**Checkpoint**: US2 done — configuration-driven policy swap is tested and documented.

---

## Phase 5: User Story 3 — Asymmetric Spaces Demonstrated (Priority: P3)

**Goal**: RFC-style **A→B**, **B→B**, deny **B→A** reachable in automated tests; optional live map alignment for demos.

**Independent Test**: Scripted sequence A→B, B→B succeeds; B→A denied with structured feedback.

- [X] T020 [P] [US3] Author `server/world-api/src/rules/fixtures/demo-asymmetric.rules.gram` encoding asymmetric transitions consistent with [spec.md](./spec.md) User Story 3
- [X] T021 [US3] Add `server/world-api/src/movement_asymmetric.test.ts` implementing the full A/B/B then blocked B→A sequence against `demo-asymmetric.rules.gram`
- [X] T022 [US3] Align PoC map tile classes with the demo rules by editing `client/phaser/public/maps/sandbox/color-set.tsx` and `client/phaser/public/maps/sandbox/freeplay.tmj` (then run `client/phaser/scripts/copy-map-assets.mjs` if your workflow requires syncing built assets)

**Checkpoint**: US3 done — asymmetric demo is reproducible in tests; manual Phaser path possible when map edits land.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Contract completeness, architecture notes, quickstart accuracy, regression gates.

- [X] T023 Extend `WorldApiMovementBlocked` in `server/world-api/src/world-api-errors.ts` with optional stable `code?: string`; update `worldApiErrorToToolPayload` in `server/world-api/src/mcp-server.ts` and `errorToResponse` in `server/src/errors.ts` using `Match.exhaustive` so MCP/HTTP clients receive machine-readable movement denial codes per IC-001
- [X] T024 [P] Document enumerable `go` denial codes (including `RULESET_DENY` and any new subcodes) in `shared/types/src/ghostMcp.ts` comments or exported constants per `contracts/ic-003-go-evaluation.md`
- [X] T025 [P] Add a short subsection on ruleset vs map geometry to `docs/architecture.md` referencing `server/world-api/src/rules/`
- [X] T026 Update `specs/003-rule-based-movement/quickstart.md` with final env var names and the exact `pnpm --filter @aie-matrix/server-world-api test` command once scripts exist
- [X] T027 Run `pnpm typecheck` and `pnpm --filter @aie-matrix/server-world-api test` from repository root; fix all failures before merge

**Checkpoint**: Feature branch merge-ready — types, tests, and cross-package error mapping consistent.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** → no prerequisites
- **Phase 2** → depends on Phase 1 (dependency + dirs)
- **Phase 3 (US1)** → depends on Phase 2 completion
- **Phase 4 (US2)** → depends on Phase 2; practically after US1 **or** in parallel once T009–T010 exist (tests T019 need matcher + movement integration)
- **Phase 5 (US3)** → depends on Phase 2; **T021** depends on **T020** fixture content
- **Phase 6** → after all desired user-story tasks

### User story dependencies

- **US1**: First vertical slice; blocks meaningful manual MCP validation.
- **US2**: Independent tests (T019) rely on US1 wiring (**T011–T013**) and foundational matcher.
- **US3**: **T021** depends on **T020**; **T022** is optional for automated tests but supports manual demo.

### Within each user story

- Wire services (**T011–T013**) before relying on MCP in broader smoke tests.
- Author fixtures before story-specific tests that import them (**T020** before **T021**).

---

## Parallel Opportunities

- **Phase 1**: **T002** can run in parallel with **T001** after `package.json` edit is staged (different concerns); safest parallel is **T002** with **T003** once T001 merged.
- **Phase 2**: **T006** vs **T007** can proceed in parallel (different modules) once **T005** types exist.
- **Phase 3**: **T014** parallel with **T015** once **T007** and fixtures exist.
- **Phase 4**: **T019** parallelizable only after restrictive fixture and movement wiring exist.
- **Phase 6**: **T024** and **T025** in parallel.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 complete, a contributor can split:
Task T014 → implement server/world-api/src/rules/gram-rules.test.ts
Task T015 → implement server/world-api/src/movement_go_rules.test.ts
# While another wires T011–T013 (same phase, shared files — coordinate or sequence T011→T012→T013).
```

---

## Parallel Example: User Story 2

```bash
# After restrictive fixture exists:
Task T017 → add server/world-api/src/rules/fixtures/restrictive.rules.gram
Task T018 → document env in server/world-api/README.md and .env.example (can parallel with T017 if coordinated)
Task T019 → server/world-api/src/rules_mode_switch.test.ts once T013 + T017 done
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) including **T014–T016**.
3. Stop and validate with `pnpm typecheck` and `pnpm --filter @aie-matrix/server-world-api test`, plus manual `go` via existing PoC.

### Incremental delivery

1. Add **US2** (config swap tests) — operators can tune policy without map edits.
2. Add **US3** (asymmetric fixture + map alignment) — conference demo readiness.
3. Finish **Phase 6** (codes surfaced to clients, docs, quickstart).

### Parallel team strategy

- Developer A: Phase 2 matcher + movement (**T008–T009**).
- Developer B: Gram fixtures + tests (**T002**, **T014**, **T020–T021**).
- Developer C: Effect wiring in `mcp-server.ts` + `server/src/index.ts` (**T011–T013**).

---

## Task counts

| Scope | Count |
|-------|------:|
| Phase 1 (Setup) | 3 |
| Phase 2 (Foundational) | 7 |
| Phase 3 (US1) | 6 |
| Phase 4 (US2) | 3 |
| Phase 5 (US3) | 3 |
| Phase 6 (Polish) | 5 |
| **Total** | **27** |

**Suggested MVP scope**: Phase 1 + Phase 2 + Phase 3 (through **T016**).

**Format validation**: Every task line uses `- [ ]`, a sequential `Tnnn` id, optional `[P]` only where listed, `[USn]` only on user-story phases, and embeds at least one concrete file path in the description.

---

## Notes

- Colyseus room internals (`server/colyseus/src/MatrixRoom.ts`, etc.) remain off-limits per `AGENTS.md`; map **assets** under `client/phaser/public/maps/` are fair game for tile class labels.
- If `Match.exhaustive` fails after **T023**, add the new `WorldApiMovementBlocked` shape to every `Match` chain in the same PR.
- Prefer smallest public export surface from `server/world-api/src/index.ts` (only what `server/src/index.ts` needs for startup).
