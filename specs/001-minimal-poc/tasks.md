---
description: "Task list for Minimal PoC feature implementation"
---

# Tasks: Minimal PoC

**Input**: Design documents from `/Users/akollegger/Developer/akollegger/aie-matrix/specs/001-minimal-poc/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Automated tests are not mandated by the specification; verification follows [quickstart.md](./quickstart.md) smoke paths, root Playwright `pnpm run test:e2e:autostart`, and—when implemented—a **minimal** `ghosts/tck/` smoke (IC-006 PoC subset only).

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

- [x] T001 Extend root `package.json` and `pnpm-workspace.yaml` with scripts, `dependencies`, and workspace `package.json` entries per `proposals/rfc/0001-minimal-poc.md` (pnpm is the package manager; commit `pnpm-lock.yaml`)
- [x] T002 [P] Pin active Node LTS for contributors at `.nvmrc`
- [x] T003 [P] Add `tsconfig.json` (and `src/` entry stubs) to each pnpm workspace package under `server/*/`, `client/phaser/`, `shared/types/`, `ghosts/ts-client/`, `ghosts/random-house/`, `ghosts/tck/`, and add `ghosts/python-client/pyproject.toml` (Python stub; **not** listed in `pnpm-workspace.yaml`)
- [x] T004 **Human (Tiled)**: Design or extend a **flat-top** hex sandbox map in [Tiled](https://www.mapeditor.org/) meeting `specs/001-minimal-poc/contracts/sample-map.md` (Tiled **`type`** as class string per tile, navigable layer; other custom properties optional); export `.tmj` / `.tsx` and referenced PNGs under `maps/` (e.g. `maps/sandbox/freeplay.tmj`)
- [x] T005 [P] Link this feature to governing `proposals/rfc/0001-minimal-poc.md` and `proposals/adr/0001-mcp-ghost-wire-protocol.md` in `README.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts as code, auth stub, **strict map load**, and Colyseus room skeleton. No user-story features until this phase completes.

**⚠️ CRITICAL**: User story phases must not start until T006–T011 are done (map files from T004 must exist before T008).

- [x] T006 Author canonical MCP tool names, payloads, and ghost credential shapes in TypeScript at `shared/types/` aligned to `specs/001-minimal-poc/contracts/ghost-mcp.md` and `specs/001-minimal-poc/contracts/registry-rest.md`
- [x] T007 [P] Implement PoC-only JWT mint/verify using documented dev secret at `server/auth/` per `specs/001-minimal-poc/research.md`
- [x] T008 Implement map ingestion that **hard-fails** on missing per-tile **`type`** (class) for tiles used on navigable layers, with actionable errors at `server/colyseus/` (loader module next to room code) reading bundled files from `maps/**/*.tmj` per `specs/001-minimal-poc/contracts/sample-map.md` — build a **derived** hex topology from the Tiled staggered grid (not hand-authored edge lists in the map file; **do not require `capacity` or other custom properties for PoC**)
- [x] T009 Implement Colyseus room state at `server/colyseus/src/`: an **in-memory graph-like model** (per-cell records with **compass-labeled** neighbor links `n`/`s`/`ne`/`nw`/`se`/`sw` aligned to `server/world-api/README.md`), populated from the T008 loader output, plus occupant tracking and patch broadcast hooks — this is the PoC stand-in for a later **Neo4j** graph with explicit directional relationships
- [x] T010 [P] Add machine-readable registry contract artifact (OpenAPI or JSON Schema) at `server/registry/schemas/registry.json` reflecting `specs/001-minimal-poc/contracts/registry-rest.md`
- [x] T011 Implement in-process bridge from `server/world-api/` into Colyseus room mutators per `specs/001-minimal-poc/research.md` at `server/world-api/src/colyseus-bridge.ts` (path adjustable to match scaffold; keep single documented module)

**Checkpoint**: Server can boot, load `maps/`, and expose an internal API for room updates even before REST/MCP surfaces are complete.

---

## Phase 3: User Story 1 — Run a Ghost End to End (Priority: P1) 🎯 MVP

**Goal**: Register `ghosts/random-house/`, adopt a ghost for a caretaker, and navigate exclusively via MCP `world-api` with valid moves accepted and invalid moves rejected without position corruption.

**Independent Test**: Follow §1 of `specs/001-minimal-poc/quickstart.md`: start server, run adoption flow, start `ghosts/random-house/`, confirm one successful `go` and one structured rejection.

### Implementation for User Story 1

- [x] T012 [US1] Implement GhostHouse provider registration HTTP handler at `server/registry/src/routes/register-house.ts` (or equivalent single route module created by scaffold)
- [x] T013 [US1] Implement caretaker + adoption endpoints with IC-002 exclusivity errors at `server/registry/src/routes/adoption.ts` backed by in-memory models per `specs/001-minimal-poc/data-model.md`
- [x] T014 [US1] Implement MCP `world-api` server registering `whoami`, `whereami`, `look`, `exits`, and `go` at `server/world-api/src/mcp-server.ts` using schemas from `shared/types/` (local-only spatial args: `here` / `around` / `n`…`sw`; **no arbitrary tile-id parameters**; document compass deltas in `server/world-api/README.md` per `specs/001-minimal-poc/contracts/ghost-mcp.md` and `specs/001-minimal-poc/research.md`)
- [x] T015 [US1] Implement `server/world-api/src/movement.ts`: hex **adjacency** and a **separate permissive ruleset** (PoC no-op allowing class transitions) per `proposals/rfc/0001-minimal-poc.md` — **defer `capacity` / occupancy limits**; update `server/colyseus/` on success and return structured `reason` on rejection per `specs/001-minimal-poc/contracts/ghost-mcp.md`
- [x] T016 [P] [US1] Implement thin MCP HTTP client SDK at `ghosts/ts-client/src/client.ts` (transport per `specs/001-minimal-poc/research.md`)
- [x] T017 [US1] Implement `ghosts/random-house/` process: scripted registration + adoption + spawn embedded walker using **only** `ghosts/ts-client/` at `ghosts/random-house/src/index.ts`
- [x] T018 [US1] Document env vars, ports, and exact start command for the house at `ghosts/random-house/README.md`
- [x] T019 [US1] Verify **two concurrent ghosts** (two caretakers / two adoptions) receive distinct credentials and move independently without Colyseus corruption at `server/registry/src/session-guard.ts` and `server/world-api/src/auth-context.ts` (split files acceptable if guard lives adjacent to registry)

**Checkpoint**: Reference house demonstrates FR-005/FR-006/FR-012 without reading internal server source.

---

## Phase 4: User Story 2 — Observe the World in a Browser (Priority: P1)

**Goal**: Phaser spectator renders `maps/` and shows ≤1s ghost position updates (SC-003) via Colyseus sync; no write controls.

**Independent Test**: Follow §2 of `specs/001-minimal-poc/quickstart.md` with zero, one, and two active ghosts.

### Implementation for User Story 2

- [x] T020 [US2] Define and emit spectator room schema (`ghostId → tileId`, tile coordinates) from `server/colyseus/src/room-schema.ts` per `specs/001-minimal-poc/contracts/spectator-state.md`
- [x] T021 [P] [US2] Implement Phaser scene that loads the same `maps/*.tmj` bindings (flat-top) at `client/phaser/src/scenes/WorldScene.ts`
- [x] T022 [US2] Subscribe to Colyseus patches and render moving ghost sprites at `client/phaser/src/scenes/SpectatorView.ts`
- [x] T023 [US2] Wire dev static/Vite (or documented) hosting for the Phaser build and document the spectator URL in `server/README.md` (create if missing) — **no** move RPC from browser

**Checkpoint**: Browser demo matches acceptance scenarios in `specs/001-minimal-poc/spec.md` for User Story 2.

---

## Phase 5: User Story 3 — Set Up the PoC Quickly (Priority: P2)

**Goal**: Clean clone → running demo ≤15 minutes on a prepared machine (SC-001); **manual** prerequisites (Tiled map, env) are obvious before debugging code.

**Independent Test**: Time-boxed execution of root `README.md` + `specs/001-minimal-poc/quickstart.md` including human map verification checklist.

### Implementation for User Story 3

- [x] T024 [US3] Rewrite root onboarding: install, build, ports, **explicit human prerequisite** pointing to T004 + `maps/` artifact list at `README.md`
- [x] T025 [P] [US3] Replace placeholders with exact commands, URLs, and timing notes at `specs/001-minimal-poc/quickstart.md`
- [x] T026 [P] [US3] Document script-first adoption flow (`pnpm` script + `curl` or small CLI) at `server/registry/README.md` per `specs/001-minimal-poc/contracts/local-setup.md`
- [x] T027 [US3] Record subsystem ownership (spectator vs movement vs registry vs contracts) for PoC shortcuts at `docs/architecture.md`
- [x] T028 [US3] Perform a dry-run **15-minute** contributor walkthrough from a clean clone; log gaps and fixes only in `specs/001-minimal-poc/quickstart.md` (append a “Walkthrough log” subsection)

**Checkpoint**: A new contributor can follow docs without spelunking `server/` internals.

---

## Phase 6: User Story 4 — Minimal compatibility smoke (Priority: P3)

**Goal**: Smallest useful **`ghosts/tck/`** check: prove a live stack accepts **registry adopt → MCP `whereami`** (IC-006 **PoC subset** in [contracts/tck-scenarios.md](./contracts/tck-scenarios.md)). **Not** a full GhostHouse product matrix, multi-house discovery, user auth, or cross-language drift tooling.

**Independent Test**: Follow §4 of [quickstart.md](./quickstart.md) with the server running; minimal TCK exits `0`. Optional: break MCP URL in a scratch branch → non-zero exit.

### Implementation for User Story 4

- [x] T029 [US4] Single-file minimal runner at `ghosts/tck/src/index.ts`: sequential steps only (no separate `runner.ts` unless this file grows unwieldy); labeled stderr (or stdout) per step; **non-zero exit** on first failure; wire `pnpm --filter @aie-matrix/ghost-tck test` in `ghosts/tck/package.json`.
- [x] T030 [P] [US4] `ghosts/tck/README.md` — prerequisites (`pnpm run demo` or `pnpm run poc:server`), exact `pnpm`/`node` command, env vars (`AIE_MATRIX_REGISTRY_BASE` default), and an explicit **“out of scope for PoC”** list (invalid-move suite, python drift client, multi-house / user-journey TCK, alternate-house CLI flags).

**Deferred (no tasks in Phase 6)**: `ghosts/python-client` MCP drift script; rich step runner module; catalog/auth/user-initiated adoption automation—pick up in a later RFC or Phase 7+ when surfaces exist.

**Checkpoint**: `pnpm --filter @aie-matrix/ghost-tck test` exits `0` against a local stack that already passes quickstart §1 (registry + MCP alive).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Namespace docs, RFC alignment, final smoke across all stories.

- [ ] T033 [P] Add flat-namespace overview for `ghosts/*` packages (no nested subtypes) at `ghosts/README.md` per FR-019 in `specs/001-minimal-poc/spec.md`
- [ ] T034 [P] Reconcile `proposals/rfc/0001-minimal-poc.md` with any scope adjustments discovered during implementation at `proposals/rfc/0001-minimal-poc.md`
- [ ] T035 [P] Update contributor commands or DCO notes if new workflows were introduced at `CONTRIBUTING.md`
- [ ] T036 Run quickstart §§1–3 on a clean workspace (§4 minimal TCK when T029 lands); fix any doc drift in `README.md`

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
- Minimal TCK stays in one file until a future RFC justifies a runner split (US4).

### Parallel Opportunities

- **Phase 1**: T002, T003, T005 in parallel after T001.
- **Phase 2**: T007, T010 parallel to T006 once paths settled; T008–T009 sequential after map exists.
- **Phase 3**: T016 parallel to server route work once types stable.
- **Phase 4**: T021 parallel to T020 after room schema types exported.
- **Phase 5**: T025, T026 parallel after T024 outline exists.
- **Phase 6**: T030 can proceed in parallel with T029 after step labels are agreed (single-file TCK).

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
5. US4 → **minimal** `ghosts/tck/` smoke (registry + `whereami`); broader “alternate GhostHouse” confidence deferred.

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
