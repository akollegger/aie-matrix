---
description: "Task list for Minimal PoC feature implementation"
---

# Tasks: Minimal PoC

**Input**: Design documents from `/Users/akollegger/Developer/akollegger/aie-matrix/specs/001-minimal-poc/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Automated tests are not mandated by the specification; verification follows [quickstart.md](./quickstart.md) smoke paths and `ghosts/tck/` as the compatibility driver (IC-006).

**Organization**: Tasks are grouped by user story so each increment can be implemented and verified independently where the contracts allow.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in the same batch)
- **[Story]**: User story label ([US1]–[US4]) for story phases only
- Every description includes an exact file or directory path

## Path Conventions

Monorepo layout per [plan.md](./plan.md): `server/`, `client/phaser/`, `shared/types/`, `ghosts/`, `maps/`, root `README.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository layout, toolchain pins, and **human-authored map assets** required before the world can validate movement.

- [ ] T001 Extend root `package.json` and `pnpm-workspace.yaml` with scripts, `dependencies`, and workspace `package.json` entries per `proposals/rfc/0001-minimal-poc.md` (pnpm is the package manager; commit `pnpm-lock.yaml`)
- [ ] T002 [P] Pin active Node LTS for contributors at `.nvmrc`
- [ ] T003 [P] Add `tsconfig.json` (and `src/` entry stubs) to each pnpm workspace package under `server/*/`, `client/phaser/`, `shared/types/`, `ghosts/ts-client/`, `ghosts/random-house/`, `ghosts/tck/`, and add `ghosts/python-client/pyproject.toml` (Python stub; **not** listed in `pnpm-workspace.yaml`)
- [ ] T004 **Human (Tiled)**: Design a small **flat-top** hex sandbox map in [Tiled](https://www.mapeditor.org/) meeting `specs/001-minimal-poc/contracts/sample-map.md` (tile ids, `tileClass` ∈ `hallway` \| `session-room` \| `vendor-booth`, capacity on `session-room`, explicit neighbors only); export `.tmj` / optional `.tsx` and referenced PNGs under `maps/` (e.g. `maps/sample-sandbox.tmj`, `maps/tilesets/`, `maps/assets/`)
- [ ] T005 [P] Link this feature to governing `proposals/rfc/0001-minimal-poc.md` and `proposals/adr/0001-mcp-ghost-wire-protocol.md` in `README.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts as code, auth stub, **strict map load**, and Colyseus room skeleton. No user-story features until this phase completes.

**⚠️ CRITICAL**: User story phases must not start until T006–T011 are done (map files from T004 must exist before T008).

- [ ] T006 Author canonical MCP tool names, payloads, and ghost credential shapes in TypeScript at `shared/types/` aligned to `specs/001-minimal-poc/contracts/ghost-mcp.md` and `specs/001-minimal-poc/contracts/registry-rest.md`
- [ ] T007 [P] Implement PoC-only JWT mint/verify using documented dev secret at `server/auth/` per `specs/001-minimal-poc/research.md`
- [ ] T008 Implement map ingestion that **hard-fails** on missing `tileClass`, capacity, or neighbor metadata with actionable errors at `server/colyseus/` (loader module next to room code) reading bundled files from `maps/*.tmj` per `specs/001-minimal-poc/contracts/sample-map.md`
- [ ] T009 Implement Colyseus room state: tile graph, occupant tracking, and patch broadcast hooks at `server/colyseus/src/` (exact entry file to match scaffold)
- [ ] T010 [P] Add machine-readable registry contract artifact (OpenAPI or JSON Schema) at `server/registry/schemas/registry.json` reflecting `specs/001-minimal-poc/contracts/registry-rest.md`
- [ ] T011 Implement in-process bridge from `server/world-api/` into Colyseus room mutators per `specs/001-minimal-poc/research.md` at `server/world-api/src/colyseus-bridge.ts` (path adjustable to match scaffold; keep single documented module)

**Checkpoint**: Server can boot, load `maps/`, and expose an internal API for room updates even before REST/MCP surfaces are complete.

---

## Phase 3: User Story 1 — Run a Ghost End to End (Priority: P1) 🎯 MVP

**Goal**: Register `ghosts/random-house/`, adopt a ghost for a caretaker, and navigate exclusively via MCP `world-api` with valid moves accepted and invalid moves rejected without position corruption.

**Independent Test**: Follow §1 of `specs/001-minimal-poc/quickstart.md`: start server, run adoption flow, start `ghosts/random-house/`, confirm one successful `move_ghost` and one structured rejection.

### Implementation for User Story 1

- [ ] T012 [US1] Implement GhostHouse provider registration HTTP handler at `server/registry/src/routes/register-house.ts` (or equivalent single route module created by scaffold)
- [ ] T013 [US1] Implement caretaker + adoption endpoints with IC-002 exclusivity errors at `server/registry/src/routes/adoption.ts` backed by in-memory models per `specs/001-minimal-poc/data-model.md`
- [ ] T014 [US1] Implement MCP `world-api` server registering `get_tile`, `get_neighbors`, `get_ghost_position`, `move_ghost` at `server/world-api/src/mcp-server.ts` using schemas from `shared/types/`
- [ ] T015 [US1] Enforce movement rules (capacity, adjacency, tile class) only in `server/world-api/src/movement.ts`, updating `server/colyseus/` state on success and returning structured `reason` on rejection per `specs/001-minimal-poc/contracts/ghost-mcp.md`
- [ ] T016 [P] [US1] Implement thin MCP HTTP client SDK at `ghosts/ts-client/src/client.ts` (transport per `specs/001-minimal-poc/research.md`)
- [ ] T017 [US1] Implement `ghosts/random-house/` process: scripted registration + adoption + spawn embedded walker using **only** `ghosts/ts-client/` at `ghosts/random-house/src/index.ts`
- [ ] T018 [US1] Document env vars, ports, and exact start command for the house at `ghosts/random-house/README.md`
- [ ] T019 [US1] Verify **two concurrent ghosts** (two caretakers / two adoptions) receive distinct credentials and move independently without Colyseus corruption at `server/registry/src/session-guard.ts` and `server/world-api/src/auth-context.ts` (split files acceptable if guard lives adjacent to registry)

**Checkpoint**: Reference house demonstrates FR-005/FR-006/FR-012 without reading internal server source.

---

## Phase 4: User Story 2 — Observe the World in a Browser (Priority: P1)

**Goal**: Phaser spectator renders `maps/` and shows ≤1s ghost position updates (SC-003) via Colyseus sync; no write controls.

**Independent Test**: Follow §2 of `specs/001-minimal-poc/quickstart.md` with zero, one, and two active ghosts.

### Implementation for User Story 2

- [ ] T020 [US2] Define and emit spectator room schema (`ghostId → tileId`, tile coordinates) from `server/colyseus/src/room-schema.ts` per `specs/001-minimal-poc/contracts/spectator-state.md`
- [ ] T021 [P] [US2] Implement Phaser scene that loads the same `maps/*.tmj` bindings (flat-top) at `client/phaser/src/scenes/WorldScene.ts`
- [ ] T022 [US2] Subscribe to Colyseus patches and render moving ghost sprites at `client/phaser/src/scenes/SpectatorView.ts`
- [ ] T023 [US2] Wire dev static/Vite (or documented) hosting for the Phaser build and document the spectator URL in `server/README.md` (create if missing) — **no** move RPC from browser

**Checkpoint**: Browser demo matches acceptance scenarios in `specs/001-minimal-poc/spec.md` for User Story 2.

---

## Phase 5: User Story 3 — Set Up the PoC Quickly (Priority: P2)

**Goal**: Clean clone → running demo ≤15 minutes on a prepared machine (SC-001); **manual** prerequisites (Tiled map, env) are obvious before debugging code.

**Independent Test**: Time-boxed execution of root `README.md` + `specs/001-minimal-poc/quickstart.md` including human map verification checklist.

### Implementation for User Story 3

- [ ] T024 [US3] Rewrite root onboarding: install, build, ports, **explicit human prerequisite** pointing to T004 + `maps/` artifact list at `README.md`
- [ ] T025 [P] [US3] Replace placeholders with exact commands, URLs, and timing notes at `specs/001-minimal-poc/quickstart.md`
- [ ] T026 [P] [US3] Document script-first adoption flow (`pnpm` script + `curl` or small CLI) at `server/registry/README.md` per `specs/001-minimal-poc/contracts/local-setup.md`
- [ ] T027 [US3] Record subsystem ownership (spectator vs movement vs registry vs contracts) for PoC shortcuts at `docs/architecture.md`
- [ ] T028 [US3] Perform a dry-run **15-minute** contributor walkthrough from a clean clone; log gaps and fixes only in `specs/001-minimal-poc/quickstart.md` (append a “Walkthrough log” subsection)

**Checkpoint**: A new contributor can follow docs without spelunking `server/` internals.

---

## Phase 6: User Story 4 — Validate Another Ghost Implementation (Priority: P3)

**Goal**: `ghosts/tck/` drives IC-006 steps against a live local stack with actionable pass/fail output.

**Independent Test**: Follow §4 of `specs/001-minimal-poc/quickstart.md`; intentionally fail a move in a scratch branch to confirm non-zero exit and clear stderr.

### Implementation for User Story 4

- [ ] T029 [US4] Scaffold TCK package entrypoint at `ghosts/tck/src/index.ts` invoking registry + MCP in order from `specs/001-minimal-poc/contracts/tck-scenarios.md`
- [ ] T030 [US4] Implement step runner with labeled stdout/stderr and non-zero exit on first failure at `ghosts/tck/src/runner.ts`
- [ ] T031 [P] [US4] Keep `ghosts/python-client/` minimal stub that can call `tools/list` + one tool for drift checking per `specs/001-minimal-poc/research.md` at `ghosts/python-client/src/stub_client.py`
- [ ] T032 [P] [US4] Document how to point TCK at alternate houses/ghosts when parameters exist at `ghosts/tck/README.md`

**Checkpoint**: TCK passes against `ghosts/random-house/` on a green build.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Namespace docs, RFC alignment, final smoke across all stories.

- [ ] T033 [P] Add flat-namespace overview for `ghosts/*` packages (no nested subtypes) at `ghosts/README.md` per FR-019 in `specs/001-minimal-poc/spec.md`
- [ ] T034 [P] Reconcile `proposals/rfc/0001-minimal-poc.md` with any scope adjustments discovered during implementation at `proposals/rfc/0001-minimal-poc.md`
- [ ] T035 [P] Update contributor commands or DCO notes if new workflows were introduced at `CONTRIBUTING.md`
- [ ] T036 Run full smoke sequence §§1–4 in `specs/001-minimal-poc/quickstart.md` on a clean workspace and fix any doc drift in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2**: T004 (human map files) must exist before T008 runs successfully.
- **Phase 2** → **Phase 3+**: T006–T011 block all user stories.
- **User Stories**: US1 (Phase 3) and US2 (Phase 4) are both P1; US2 benefits from US1 for multi-ghost motion tests but empty-map spectator tests can begin after Phase 2 using T020–T021.
- **Phase 5 (US3)**: Depends on runnable commands from Phases 3–4 (docs must reflect reality).
- **Phase 6 (US4)**: Depends on registry + MCP + adoption stability from Phase 3.
- **Phase 7**: After the stories you intend to ship (minimum MVP: through Phase 3 + partial Phase 4 for visibility).

### User Story Dependencies

| Story | Depends on | Notes |
|-------|------------|--------|
| US1 | Phase 2 | Core ghost + registry + MCP |
| US2 | Phase 2; integrates US1 for motion | Map-only milestone after T020–T021 |
| US3 | US1 + US2 commands stable | Documentation + timed walkthrough |
| US4 | US1 flows stable | TCK assumes live stack |

### Within Each User Story

- Registry routes before house package integration (US1).
- Colyseus schema before Phaser sync (US2).
- TCK scaffold before runner edge cases (US4).

### Parallel Opportunities

- **Phase 1**: T002, T003, T005 in parallel after T001.
- **Phase 2**: T007, T010 parallel to T006 once paths settled; T008–T009 sequential after map exists.
- **Phase 3**: T016 parallel to server route work once types stable.
- **Phase 4**: T021 parallel to T020 after room schema types exported.
- **Phase 5**: T025, T026 parallel after T024 outline exists.
- **Phase 6**: T031–T032 parallel to T029–T030 once MCP base URL constants known.

---

## Parallel Example: User Story 1

```bash
# After T006 completes, parallel implementation tracks:
Task: "T016 ghosts/ts-client/src/client.ts"
Task: "T012 server/registry/src/routes/register-house.ts"

# After T014 completes, parallel docs + hardening:
Task: "T018 ghosts/random-house/README.md"
Task: "T019 server/world-api/src/auth-context.ts"
```

---

## Parallel Example: User Story 2

```bash
# After T020 defines shared types / room payload:
Task: "T021 client/phaser/src/scenes/WorldScene.ts"
Task: "T022 client/phaser/src/scenes/SpectatorView.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 + visible map)

1. Complete Phase 1–2 (including **Tiled** export in T004).
2. Complete Phase 3 (US1) through T019.
3. **STOP and VALIDATE** quickstart §1.
4. Add Phase 4 minimal Phaser render (T020–T023) for demo visibility.

### Incremental Delivery

1. Setup + Foundational → deterministic boot with `maps/`.
2. US1 → MCP-only ghost motion proven.
3. US2 → contributor-visible demo.
4. US3 → 15-minute onboarding credible.
5. US4 → external ghost confidence.

### Parallel Team Strategy

- Developer A: `server/registry/`, `server/auth/`
- Developer B: `server/world-api/`, `server/colyseus/`
- Developer C: `ghosts/random-house/`, `ghosts/ts-client/`
- Designer / level author: **T004** in Tiled (`maps/`) ahead of server sprint
- After room schema stable: Developer D: `client/phaser/`

---

## Notes

- **Human work**: T004 is intentionally not automatable; keep screenshots or checksum list of exported files in `maps/README.md` if that helps handoff (optional file — only add if created).
- Re-run T028 after any port or script rename.
- `[P]` tasks touch different files; still avoid merge conflicts on shared `pnpm-lock.yaml` by serializing lockfile updates when needed.
