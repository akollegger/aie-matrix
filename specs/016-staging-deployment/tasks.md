# Tasks: Staging Deployment (Tier 2)

**Input**: Design documents from `specs/016-staging-deployment/`  
**Branch**: `016-staging-deployment`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Tests**: Smoke-test tasks are included at the end of each story phase. No unit-test tasks are added; the verification path is `docker compose up --build` + health-endpoint assertions, per spec acceptance scenarios.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. A foundational rename phase blocks all user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup (Audit & Preparation)

**Purpose**: Confirm scope before making changes; identify missing env-var wiring.

- [ ] T001 Grep for all `ghost-house` references that must be renamed: `grep -r "ghost-house\|ghost_house\|ghosthouse\|GhostHouse\|@aie-matrix/ghost-house" . --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" --include="*.ts" --include="*.tsx" -l`
- [ ] T002 Audit `shared/root-env/src/` to confirm whether `WORLD_API_URL` and `COLYSEUS_URL` are already exported; note any missing variables that `ghosts/agent-host` will need to read from the environment

---

## Phase 2: Foundational — Service Rename (Prerequisite)

**Purpose**: Rename `ghost-house` → `agent-host` everywhere before any Docker artifacts are authored. Every downstream task depends on this phase being complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Rename directory `ghosts/ghost-house/` → `ghosts/agent-host/`; update `ghosts/agent-host/package.json` name field from `@aie-matrix/ghost-house` to `@aie-matrix/agent-host`
- [ ] T004 [P] Update `pnpm-workspace.yaml`: replace `ghosts/ghost-house` with `ghosts/agent-host` and `ghosts/ghost-house/examples/observer-agent` / `ghosts/ghost-house/examples/echo-agent` with their `agent-host` equivalents
- [ ] T005 [P] Update all `workspace:*` dependencies in any package that references `@aie-matrix/ghost-house` (check `ghosts/ts-client/package.json`, `ghosts/tck/package.json`, and any server or client package that imports ghost-house)
- [ ] T006 [P] Update all prose references to "ghost-house" or "ghost house" in `docs/`, `proposals/`, `specs/`, `CLAUDE.md`, `CONTRIBUTING.md`, `AGENTS.md`, `README.md`, and any `*.md` under `ghosts/`
- [ ] T007 Run `pnpm install && pnpm typecheck` to verify the rename is clean across the workspace
- [ ] T008 Verify no remaining references: `grep -r "ghost-house\|@aie-matrix/ghost-house" . --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" --include="*.ts" -l` must return empty (excluding `.git/`)

**Checkpoint**: Rename complete — `pnpm typecheck` green, grep returns empty. User story work can now begin.

---

## Phase 3: User Story 1 — Full Stack Healthy Locally (Priority: P1) 🎯 MVP

**Goal**: `docker compose -f deploy/staging/docker-compose.yml up --build` brings all four services (server, agent-host, neo4j, redis) to `healthy` within 5 minutes; WebSocket to Colyseus and HTTP GET `/health` both succeed.

**Independent Test**: Run `docker compose -f deploy/staging/docker-compose.yml up --build`; confirm all services reach `healthy`; run `curl http://localhost:3000/health` and `wscat -c ws://localhost:2567`.

### Implementation for User Story 1

- [ ] T009 [US1] Add `WORLD_API_URL` to `shared/root-env/src/index.ts` (or equivalent export file) so `ghosts/agent-host` can read the world-api base URL from the environment; default to `http://localhost:3000`
- [ ] T010 [P] [US1] Enhance the existing `/health` handler in `server/src/index.ts` (lines ~164–172): keep the `spectatorMetaReady` gate, add a Neo4j connectivity check, and return the IC-001 shape `{ "status": "ok"|"starting"|"degraded", "checks": { "neo4j": true|false } }`; return HTTP 503 until Neo4j check passes
- [ ] T011 [P] [US1] Add a `/health` HTTP route to `ghosts/agent-host/src/main.ts` using the same raw Node.js `prependListener` pattern; check reachability of `WORLD_API_URL/health`; return IC-001 `{ "status": "ok"|"degraded", "checks": { "world-api": true|false } }`; HTTP 200 only when check passes
- [ ] T012 [P] [US1] Write `server/Dockerfile` using the three-stage pnpm pattern from `research.md`: stage `base` (`pnpm fetch --prod` from lockfile only), stage `build` (`pnpm install --offline && pnpm --filter @aie-matrix/server build && pnpm --filter @aie-matrix/server deploy /app/deploy`), stage `runner` (copies `/app/deploy`, runs `node dist/index.js`)
- [ ] T013 [P] [US1] Write `ghosts/agent-host/Dockerfile` using the same three-stage pattern targeting `@aie-matrix/agent-host`; final stage runs `node dist/main.js`
- [ ] T014 [US1] Create `deploy/staging/` directory and write `deploy/staging/docker-compose.yml` defining four services (`neo4j:5`, `redis:7`, `server`, `agent-host`) with `depends_on: condition: service_healthy` enforcing the chain neo4j → server → agent-host; `aie-matrix` bridge network; named `neo4j-data` volume; all values read from environment / `.env.staging`
- [ ] T015 [P] [US1] Write `deploy/staging/.env.staging.example` documenting every variable from `contracts/env-contract.md` with placeholder values and inline comments explaining each; this file is committed and gitignored entries use `.env.staging`
- [ ] T016 [P] [US1] Write `docker-compose.dev.yml` at the repo root defining only `neo4j` and `redis` services (matching the versions in the staging compose file) so Tier 1 developers can run `docker compose -f docker-compose.dev.yml up` to get stateful services without running application containers
- [ ] T017 [US1] Write `deploy/staging/README.md` operator runbook covering: prerequisites, start command, verify commands, rebuild single service, stop/wipe instructions, health-check failure diagnosis, and a note on the 4-container vs 6-container ADR-0007 vision
- [ ] T018 [US1] Smoke test: populate `deploy/staging/.env.staging` from the example file, run `docker compose -f deploy/staging/docker-compose.yml up --build`, confirm all four services reach `healthy`, run `curl http://localhost:3000/health` (expect `{"status":"ok","checks":{"neo4j":true}}`), and open a WebSocket connection to Colyseus; document any issues found and fix before marking complete

**Checkpoint**: Full staging stack runs locally from a clean checkout. US1 is independently testable.

---

## Phase 4: User Story 2 — CI Pipeline Validates Every PR (Priority: P2)

**Goal**: Every pull request targeting `main` triggers a GitHub Actions workflow that builds images and runs the full compose stack; the PR check fails if any service does not become healthy.

**Independent Test**: Open a test PR; confirm the CI check appears and passes. Then introduce a deliberate startup failure (e.g., set `NEO4J_URI` to an invalid value in the CI env); confirm the check fails and the unhealthy service is identified in the log.

### Implementation for User Story 2

- [ ] T019 [US2] Write `.github/workflows/staging-ci.yml`: trigger `pull_request` targeting `main`; steps: checkout → `docker compose -f deploy/staging/docker-compose.yml build` → `docker compose up -d` → poll `/health` endpoints until healthy or timeout (5 min) → assert HTTP 200 → `docker compose down -v`; set `COMPOSE_PROJECT_NAME` to avoid conflicts; use `docker compose` (v2 plugin, not `docker-compose`)
- [ ] T020 [US2] Open a test PR with the CI workflow file and at least one staging-stack file; confirm the GitHub Actions check runs and passes; record the job duration in `deploy/staging/README.md` for reference
- [ ] T021 [US2] Verify CI failure case: temporarily set an invalid env var in the CI config, push to the test PR branch, confirm the check fails and the log identifies the unhealthy service; revert the breakage

**Checkpoint**: CI gating is live. US2 independently verifiable via PR history.

---

## Phase 5: User Story 3 — Single Service Rebuild Without Full Restart (Priority: P3)

**Goal**: A single service container can be rebuilt and restarted while the remaining services continue running; it reconnects to its dependencies within 60 seconds.

**Independent Test**: While the full staging stack is healthy, run `docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server`; confirm server reconnects to Neo4j and becomes healthy within 60 s; confirm agent-host health check remains passing throughout.

### Implementation for User Story 3

- [ ] T022 [US3] Operational verification: with the full staging stack healthy, run `docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server`; time the reconnect; confirm agent-host `/health` remains 200 throughout; record observations
- [ ] T023 [US3] Document the single-service rebuild pattern and observed reconnect time in `deploy/staging/README.md` under a "Rebuild a single service" heading

**Checkpoint**: All three user stories are independently functional and verified.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T024 [P] Update `docs/architecture.md`: mark the "CI/CD Pipeline" open question as resolved, reference ADR-0007 and this spec (`specs/016-staging-deployment/`)
- [ ] T025 [P] Update `CONTRIBUTING.md`: add a "Running the staging stack" section pointing to `deploy/staging/README.md` and explaining that `docker compose -f docker-compose.dev.yml up` is the Tier 1 stateful-services shortcut
- [ ] T026 Final grep: `grep -r "ghost-house\|ghost_house" . --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" -l` must return empty (excluding `.git/`); fix any stragglers
- [ ] T027 Run `pnpm typecheck` and `pnpm test` from the repo root; both must pass clean with no regressions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 audit findings — **blocks all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2 complete; no dependency on US2 or US3
- **User Story 2 (Phase 4)**: Depends on Phase 3 complete (needs working compose file and Dockerfiles)
- **User Story 3 (Phase 5)**: Depends on Phase 3 complete (needs running stack); independent of US2
- **Polish (Final Phase)**: Depends on all desired user stories complete

### User Story Dependencies

- **US1 (P1)**: Unblocked after Foundational rename — no dependency on other stories
- **US2 (P2)**: Depends on US1 (needs `docker-compose.yml` and working images)
- **US3 (P3)**: Depends on US1 (needs running stack); independent of US2

### Within Each Story

- T009 before T011 (agent-host health needs `WORLD_API_URL` from root-env)
- T010, T011, T012, T013 can run in parallel (different files)
- T014 after T010 and T011 (compose depends_on only works if health endpoints are implemented)
- T015, T016, T017 can run in parallel with T014 (different files)
- T018 (smoke test) after all other Phase 3 tasks

### Parallel Opportunities

All [P]-marked tasks within a phase can run simultaneously. Cross-phase parallelism is not safe.

---

## Parallel Example: User Story 1

```text
# After T009 (root-env update) completes, launch these in parallel:
T010  Enhance /health in server/src/index.ts
T011  Add /health to ghosts/agent-host/src/main.ts
T012  Write server/Dockerfile
T013  Write ghosts/agent-host/Dockerfile
T015  Write deploy/staging/.env.staging.example
T016  Write docker-compose.dev.yml

# After T010, T011, T012, T013 all complete:
T014  Write deploy/staging/docker-compose.yml

# After T014, T015, T016, T017 all complete:
T018  Smoke test
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (audit — ~30 min)
2. Complete Phase 2: Foundational rename (~2 h)
3. Complete Phase 3: User Story 1 (~4 h)
4. **STOP and VALIDATE**: `docker compose up --build`; four services healthy
5. The staging environment is usable for manual validation — ship if needed

### Incremental Delivery

1. Setup + Foundational → rename complete
2. US1 → staging stack runs locally (MVP)
3. US2 → CI gates every PR (conference-critical)
4. US3 → single-service rebuild documented (operational polish)

### Parallel Team Strategy

With two developers after Phase 2 completes:
- **Developer A**: US1 (Dockerfiles + compose + health endpoints)
- **Developer B**: US2 (CI workflow) — note: depends on US1 Dockerfiles existing, so Developer B starts with drafting the workflow YAML and lands it once Developer A's images build successfully

---

## Notes

- [P] tasks = different files, no incomplete-task dependencies — safe to launch simultaneously
- [Story] label maps each task to its user story for traceability
- No unit-test tasks generated (not requested in spec); verification is integration-level via `docker compose up`
- Commit after each checkpoint (T008, T018, T021, T023)
- The rename in Phase 2 is a prerequisite for all other work; do not skip or defer it
- `docker compose` (space, v2 plugin syntax) — not `docker-compose` (v1, removed from ubuntu-latest runners)
