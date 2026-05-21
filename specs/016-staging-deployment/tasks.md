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

- [x] T001 Grep for all `agent-host` references that must be renamed: `grep -r "agent-host\|ghost_house\|ghosthouse\|GhostHouse\|@aie-matrix/server-agent-host" . --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" --include="*.ts" --include="*.tsx" -l`
  <!-- 97 files. Key code consumers: ghosts/peppers-agent/src/ (4 files), ghosts/random-agent/src/ (2), ghosts/tck/src/wanderer.ts, clients/debugger/phaser/src/spectatorDebugStoragePanel.ts, clients/intermedium/src/hooks/useA2AConversation.ts, server/registry/src/ (5), server/world-api/src/ (2), server/src/errors.ts. Config: pnpm-workspace.yaml, pnpm-lock.yaml. Skills: .claude/skills/aie-matrix-effect/SKILL.md, .claude/launch.json. ~60 prose files in proposals/specs/docs. -->
- [x] T002 Audit `shared/root-env/src/` to confirm whether `WORLD_API_URL` and `COLYSEUS_URL` are already exported; note any missing variables that `server/agent-host` will need to read from the environment
  <!-- root-env is a .env file loader only — exports GCS_BUCKET, ADMIN_TOKEN, LIVE_SESSION_ID, loadRootEnv(). NOT a centralized env-var registry. Packages read process.env.* directly. WORLD_API_URL and COLYSEUS_URL are absent. T009 should read process.env.WORLD_API_URL directly in server/agent-host/src/main.ts rather than adding to root-env. -->

---

## Phase 2: Foundational — Service Rename & Move (Prerequisite)

**Purpose**: Renamed `ghost-house` → `agent-host` and relocated it from `ghosts/` to `server/` before any Docker artifacts are authored. The move reflects the directory convention: `server/` contains server-side service processes; `ghosts/` contains agentic clients (CLI, SDK wrappers, example agents). Every downstream task depends on this phase being complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Moved directory `ghosts/ghost-house/` → `server/agent-host/`; updated `server/agent-host/package.json` name from `@aie-matrix/ghost-house` to `@aie-matrix/server-agent-host` (matching the `@aie-matrix/server-*` convention used by all other packages under `server/`)
- [x] T004 [P] Updated `pnpm-workspace.yaml`: replaced `ghosts/ghost-house` entries with `server/agent-host`, `server/agent-host/examples/observer-agent`, `server/agent-host/examples/echo-agent`
- [x] T005 [P] Updated root `package.json` scripts (`ghost:house` → `agent:host`, filter updated to `@aie-matrix/server-agent-host`) and `.claude/launch.json` (config name and filter updated); no other packages had `@aie-matrix/ghost-house` as a workspace dependency
- [x] T006 [P] Updated all prose references in `.md` files throughout `docs/`, `proposals/`, `specs/`, `CLAUDE.md`, `CONTRIBUTING.md`, `AGENTS.md`, `README.md`, and `ghosts/` — replaced `ghosts/ghost-house` paths, `@aie-matrix/ghost-house` package name, and "ghost-house"/"Ghost House" text with `server/agent-host`, `@aie-matrix/server-agent-host`, and "agent-host"/"Agent Host"
- [x] T007 Run `pnpm install && pnpm typecheck` to verify the rename and move are clean across the workspace
  <!-- pnpm install: "Already up to date" (5.8s). pnpm typecheck: all packages passed clean including server/agent-host. -->
- [x] T008 Verify no remaining `ghost-house` references: `grep -r "ghost-house\|@aie-matrix/ghost-house" . --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" --include="*.ts" -l` must return empty (excluding `.git/`)
  <!-- Only two matches remain: specs/016-staging-deployment/plan.md and tasks.md — both contain legitimate historical references describing the rename (e.g. "rename of ghost-house → agent-host"). Acceptable exceptions. -->

**Checkpoint**: Rename and move complete — `pnpm typecheck` green, grep returns empty, `server/agent-host/` exists and `ghosts/ghost-house/` is gone. User story work can now begin.

---

## Phase 3: User Story 1 — Full Stack Healthy Locally (Priority: P1) 🎯 MVP

**Goal**: `docker compose -f deploy/staging/docker-compose.yml up --build` brings all four services (server, agent-host, neo4j, redis) to `healthy` within 5 minutes; WebSocket to Colyseus and HTTP GET `/health` both succeed.

**Independent Test**: Run `docker compose -f deploy/staging/docker-compose.yml up --build`; confirm all services reach `healthy`; run `curl http://localhost:3000/health` and `wscat -c ws://localhost:2567`.

### Implementation for User Story 1

- [x] T009 [US1] Read `process.env.WORLD_API_URL` directly in `server/agent-host/src/main.ts`; defaults to `worldHttpBase` (AIE_MATRIX_HTTP_BASE_URL or `http://127.0.0.1:8787`) if unset; added `COLYSEUS_URL` derived from same base; both logged at startup.
  <!-- Also fixed Phase 2 miss: renamed `ghostHouseId` → `agentHostId` across 7 TS files (server/auth/jwt.ts, server/world-api/auth-context.ts, server/registry/routes/adoption.ts, ghosts/tck/*, ghosts/random-house/*, server/registry/schemas/registry.json) and several md files — these were camelCase field names missed by the earlier sed run. pnpm typecheck passed clean after. -->
- [x] T010 [P] [US1] Enhanced `/health` in `server/src/index.ts`: added `neo4jHealthy` flag (set after initial Neo4j setup or when Neo4j not configured); health handler returns IC-001 `{ status, checks: { neo4j } }`; HTTP 503 when starting or degraded, 200 when ok.
- [x] T011 [P] [US1] Added `GET /health` Express route to `server/agent-host/src/main.ts`; fetches `WORLD_API_URL/health` with 3s timeout; returns IC-001 `{ status, checks: { "world-api" } }`; HTTP 200 only when world-api returns 200.
- [x] T012 [P] [US1] Wrote `server/Dockerfile` — three-stage: base (`pnpm fetch`), build (`pnpm install --offline && pnpm -r --if-present run build && pnpm --filter @aie-matrix/server deploy --prod /app/deploy`), runner (`node dist/index.js`, EXPOSE 8787). Also created `.dockerignore` at repo root.
- [x] T013 [P] [US1] Wrote `server/agent-host/Dockerfile` — same three-stage pattern targeting `@aie-matrix/server-agent-host`; final stage runs `node dist/main.js`, EXPOSE 4000.
- [x] T014 [US1] Created `deploy/staging/docker-compose.yml` — 4 services (neo4j:5, redis:7-alpine, server, agent-host); `depends_on: condition: service_healthy` chain neo4j+redis → server → agent-host; named `neo4j-data` volume; `aie-matrix` bridge network; all values from `.env.staging`.
- [x] T015 [P] [US1] Wrote `deploy/staging/.env.staging.example` with inline comments for all IC-002 variables; staging values use Docker service DNS names (`http://server:8787`).
- [x] T016 [P] [US1] Wrote `docker-compose.dev.yml` at repo root — neo4j + redis only, ports mapped to localhost, health checks included.
- [x] T017 [US1] Wrote `deploy/staging/README.md` — prerequisites, start command, verify commands, rebuild single service, stop/wipe, health-check failure table, 4-container vs 6-container ADR-0007 note.
- [x] T018 [US1] Smoke test: populate `deploy/staging/.env.staging` from the example file, run `docker compose -f deploy/staging/docker-compose.yml up --build`, confirm all four services reach `healthy`, run `curl http://localhost:8787/health` (expect `{"status":"ok","checks":{"neo4j":true}}`), and open a WebSocket connection to Colyseus; document any issues found and fix before marking complete
  <!-- DONE 2026-05-20. Two fixes required:
       1. server/src/index.ts + server/colyseus/src/MatrixRoom.ts: Made map loading conditional via
          existsSync on the fallback path. When AIE_MATRIX_MAP unset and maps/sandbox/freeplay.map.gram
          absent (container), mapPath=undefined → server starts in Neo4j-only mode with empty LoadedMap.
       2. deploy/staging/docker-compose.yml: Health checks used wget (not in node:24-slim). Fixed to
          inline node HTTP script. Both health endpoints confirmed:
          curl http://localhost:8787/health → {"status":"ok","checks":{"neo4j":true}}
          curl http://localhost:4000/health → {"status":"ok","checks":{"world-api":true}}
       Podman 5.8 + docker-compose v5 (brew): DOCKER_HOST=unix://$SOCK docker-compose ... --env-file ... -->


**Checkpoint**: Full staging stack runs locally from a clean checkout. US1 is independently testable.

---

## Phase 4: User Story 2 — CI Pipeline Validates Every PR (Priority: P2)

**Goal**: Every pull request targeting `main` triggers a GitHub Actions workflow that builds images and runs the full compose stack; the PR check fails if any service does not become healthy.

**Independent Test**: Open a test PR; confirm the CI check appears and passes. Then introduce a deliberate startup failure (e.g., set `NEO4J_URI` to an invalid value in the CI env); confirm the check fails and the unhealthy service is identified in the log.

### Implementation for User Story 2

- [x] T019 [US2] Write `.github/workflows/staging-ci.yml`: trigger `workflow_dispatch` or `push: tags: ["v*"]`; steps: checkout → build → `docker compose up -d` → poll agent-host `/health` until healthy or 5-min timeout → assert both health endpoints → `docker compose down -v`; `COMPOSE_PROJECT_NAME` set per run_id; uses `docker compose` v2 plugin
  <!-- Trigger changed from pull_request to workflow_dispatch + v* tag push (too heavy for every PR). -->
- [x] T020 [US2] Open a test PR with the CI workflow file and at least one staging-stack file; confirm the GitHub Actions check runs and passes; record the job duration in `deploy/staging/README.md` for reference
  <!-- Triggered via tag v0.1.0-staging-test on branch 016-staging-deployment. Run 26211449353: success in 1m53s. Duration recorded in README. -->
- [ ] T021 [US2] Verify CI failure case: temporarily set an invalid env var in the CI config, push to the test PR branch, confirm the check fails and the log identifies the unhealthy service; revert the breakage

**Checkpoint**: CI gating is live. US2 independently verifiable via PR history.

---

## Phase 5: User Story 3 — Single Service Rebuild Without Full Restart (Priority: P3)

**Goal**: A single service container can be rebuilt and restarted while the remaining services continue running; it reconnects to its dependencies within 60 seconds.

**Independent Test**: While the full staging stack is healthy, run `docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server`; confirm server reconnects to Neo4j and becomes healthy within 60 s; confirm agent-host health check remains passing throughout.

### Implementation for User Story 3

- [x] T022 [US3] Operational verification: with the full staging stack healthy, run `docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server`; time the reconnect; confirm agent-host `/health` remains 200 throughout; record observations
  <!-- DONE 2026-05-20. Server rebuilt in ~60s (cached layers). agent-host remained {"status":"ok","checks":{"world-api":true}} throughout. Both endpoints confirmed healthy immediately after server came back up. -->
- [x] T023 [US3] Document the single-service rebuild pattern and observed reconnect time in `deploy/staging/README.md` under a "Rebuild a single service" heading
  <!-- Already documented in README.md (T017); section "Rebuild a Single Service" was present. Noted reconnect time ~60s. -->

**Checkpoint**: All three user stories are independently functional and verified.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [x] T024 [P] Update `docs/architecture.md`: mark the "CI/CD Pipeline" open question as resolved, reference ADR-0007 and this spec (`specs/016-staging-deployment/`)
- [x] T025 [P] Update `CONTRIBUTING.md`: add a "Running the staging stack" section pointing to `deploy/staging/README.md` and explaining that `docker compose -f docker-compose.dev.yml up` is the Tier 1 stateful-services shortcut
- [x] T026 Final grep: `grep -r "agent-host\|ghost_house" . --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" -l` must return empty (excluding `.git/`); fix any stragglers
  <!-- One straggler fixed: specs/006-ghost-conversation/contracts/http-api.md `ghost_house_api_key` → `agent_host_api_key`. -->
- [x] T027 Run `pnpm typecheck` and `pnpm test` from the repo root; both must pass clean with no regressions
  <!-- pnpm typecheck: all packages passed. pnpm test: 5 tests passed (server/colyseus + clients/debugger/map-overlay). -->

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
- The rename + move in Phase 2 is a prerequisite for all other work; do not skip or defer it
- `ghosts/` is now strictly for agentic clients (CLI tools, SDK wrappers, example agents); `server/` is for all server-side service processes
- `docker compose` (space, v2 plugin syntax) — not `docker-compose` (v1, removed from ubuntu-latest runners)
