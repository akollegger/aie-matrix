# Tasks: Ghost House A2A Coordination

**Input**: Design documents from `/specs/009-ghost-house-a2a/`  
**Branch**: `009-ghost-house-a2a`  
**User Stories**: US1 (P1) Wanderer contribution · US2 (P2) Event delivery · US3 (P3) Social speech · US4 (P2) Operational reliability

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the two new workspace packages and wire them into the monorepo.

- [ ] T001 Create `ghosts/ghost-house/` package — `src/`, `tests/unit/`, `tests/integration/`, `package.json` (`@aie-matrix/ghost-house`), `tsconfig.json`, `.env.example`, `README.md`
- [ ] T002 Create `ghosts/random-agent/` package — `src/`, `tests/`, `package.json` (`@aie-matrix/random-agent`), `tsconfig.json`, `.env.example`, `README.md`
- [ ] T003 Add `ghosts/ghost-house` and `ghosts/random-agent` to `pnpm-workspace.yaml`
- [ ] T004 [P] Configure `vitest` for `ghosts/ghost-house` in `ghosts/ghost-house/package.json` (scripts: `test`, `test:unit`, `test:integration`)
- [ ] T005 [P] Configure `vitest` for `ghosts/random-agent` in `ghosts/random-agent/package.json` (script: `test`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, error taxonomy, and Effect-ts scaffold that every service depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 Define shared runtime types in `ghosts/ghost-house/src/types.ts` — `CatalogEntry`, `AgentSession`, `AgentSessionStatus`, `WorldEvent`, `WorldEventKind`, `SpawnContext` (from data-model.md)
- [ ] T007 Define `Data.TaggedError` subtypes in `ghosts/ghost-house/src/errors.ts` — `AgentCardInvalid`, `AgentAlreadyRegistered`, `AgentCardFetchFailed`, `AgentNotFound`, `SpawnFailed`, `SpawnTimeout`, `HealthCheckTimeout`, `RetryLimitExceeded`, `CapabilityUnmet`
- [ ] T008 [P] Add production deps to `ghosts/ghost-house/package.json`: `@a2a-js/sdk`, `@modelcontextprotocol/sdk`, `@colyseus/core`, `effect`, `zod`, `ulid`, `@aie-matrix/root-env`
- [ ] T009 [P] Add production deps to `ghosts/random-agent/package.json`: `@a2a-js/sdk`, `@modelcontextprotocol/sdk`, `@aie-matrix/root-env`
- [ ] T010 Create Effect `ManagedRuntime` scaffold in `ghosts/ghost-house/src/main.ts` (empty service stubs composed into a runtime; HTTP server start on `GHOST_HOUSE_PORT`)
- [ ] T011 Verify A2A SDK types resolve and imports compile in both packages (`pnpm typecheck` on ghost-house and random-agent)

**Checkpoint**: Package structure compiles — user story implementation can begin.

---

## Phase 3: User Story 1 — Contributor Ships a Wanderer Agent (Priority: P1) 🎯 MVP

**Goal**: A third-party contributor registers a Wanderer-tier agent, sees it running as a live ghost in the world, and the TCK Wanderer suite passes.

**Independent Test**: Register `random-agent`, spawn it for a ghost, run `pnpm --filter @aie-matrix/tck run tck:wanderer`. Pass = MVP.

### Implementation

- [ ] T012 [P] [US1] Implement `CatalogService` in `ghosts/ghost-house/src/catalog/CatalogService.ts` — `register`, `list`, `get`, `deregister` methods; file-backed JSON persistence (`CATALOG_FILE_PATH`); IC-001 validation (tier, required tools, matrix schema version)
- [ ] T013 [P] [US1] Implement `ghosts/ghost-house/src/catalog/catalog.layer.ts` — `Layer` that provides `CatalogService` backed by the catalog JSON file
- [ ] T014 [US1] Implement `A2AHostService` in `ghosts/ghost-house/src/a2a-host/A2AHostService.ts` — wrap `@a2a-js/sdk` server; expose streaming + non-blocking send; IC-002 protocol version header; `GHOST_HOUSE_DEV_TOKEN` bearer auth
- [ ] T015 [US1] Implement `ghosts/ghost-house/src/a2a-host/a2a-host.layer.ts` — `Layer` providing `A2AHostService`
- [ ] T016 [US1] Implement `MCPProxyService` in `ghosts/ghost-house/src/mcp-proxy/MCPProxyService.ts` — forward MCP tool calls to world server (`WORLD_API_BASE_URL`) using ghost-scoped token; validate caller's `requiredTools` against IC-003; reject calls to undeclared tools
- [ ] T017 [US1] Implement `ghosts/ghost-house/src/mcp-proxy/mcp-proxy.layer.ts`
- [ ] T018 [US1] Implement `AgentSupervisor` (spawn + shutdown only) in `ghosts/ghost-house/src/supervisor/SupervisorService.ts` — spawn: resolve catalog entry, mint token, send IC-006 spawn context as first A2A task, await ack, transition session to `running`; shutdown: graceful cancel via A2A then hard-kill after 10 s
- [ ] T019 [US1] Implement `ghosts/ghost-house/src/supervisor/supervisor.layer.ts`
- [ ] T020 [US1] Wire catalog + session HTTP routes in `ghosts/ghost-house/src/main.ts` per IC-005 — `POST /v1/catalog/register`, `GET /v1/catalog`, `GET /v1/catalog/:agentId`, `DELETE /v1/catalog/:agentId`, `POST /v1/sessions/spawn/:agentId`, `DELETE /v1/sessions/:sessionId`, `GET /.well-known/agent-card.json`
- [ ] T021 [P] [US1] Implement `ghosts/random-agent/src/buildAgentCard.ts` — IC-001 compliant Wanderer agent card (`tier: "wanderer"`, `requiredTools: ["whereami","exits","go"]`, `capabilities.streaming: true`, `capabilities.pushNotifications: false`, `matrix.schemaVersion: 1`)
- [ ] T022 [US1] Implement MCP movement executor in `ghosts/random-agent/src/executor.ts` — connect to `houseEndpoints.mcp` from spawn context; call `whereami`, `exits`, `go` (random adjacent step); movement loop at configurable interval
- [ ] T023 [US1] Implement `ghosts/random-agent/src/agent.ts` — A2A endpoint served by `@a2a-js/sdk`; spawn task handler (parse IC-006 context, start movement loop, return ack); health-check ping responder; shutdown handler (stop movement loop)
- [ ] T024 [US1] Add Wanderer TCK suite in `ghosts/tck/src/wanderer.ts` — tests: agent card at `/.well-known/agent-card.json` passes IC-001 validation; spawn context delivered and acked within 30 s (IC-006); agent calls `whereami` returning H3 res-15 (IC-003); agent calls `go` successfully for 10 steps; agent card tier matches capabilities (IC-002)
- [ ] T025 [P] [US1] Add `tck:wanderer` script to `ghosts/tck/package.json` pointing at `wanderer.ts`
- [ ] T026 [US1] Run `quickstart.md` end-to-end on a clean shell — start house, start random-agent, register, spawn, run `tck:wanderer`; confirm all steps succeed and document any deviations from `quickstart.md` in the file

**Checkpoint**: `pnpm --filter @aie-matrix/tck run tck:wanderer` passes. Quickstart verified. US1 is independently deliverable.

---

## Phase 4: User Story 4 — Core Team Operates Ghost House Reliably (Priority: P2)

**Goal**: The ghost house detects crashed agents, restarts them per policy, and shuts sessions down cleanly — without human intervention.

**Independent Test**: Start ghost house with one agent registered. Kill the agent process. Confirm the supervisor logs a health-check failure, attempts restart with backoff, and other sessions are unaffected.

### Implementation

- [ ] T027 [US4] Add health-check fiber to `SupervisorService` in `ghosts/ghost-house/src/supervisor/SupervisorService.ts` — `Effect.forkScoped` per session; A2A ping on configurable interval (default 30 s timeout); on timeout: transition session to `unhealthy`, emit health-check failure log
- [ ] T028 [US4] Add restart policy to `SupervisorService` — exponential backoff (start 5 s, double each retry); cap at 5 restarts per hour; on cap exceeded: transition to `failed`, emit permanent-failure log; restart resets on successful health check
- [ ] T029 [US4] Add per-agent action rate limiting in `SupervisorService` — configurable max actions/minute per session; log and drop excess actions without crashing the session
- [ ] T030 [US4] Unit tests for `SupervisorService` failure paths in `ghosts/ghost-house/tests/unit/supervisor.test.ts` — mock A2A ping; verify `unhealthy` → `restarting` → `running` transitions; verify `failed` state after retry limit; verify hard-kill timeout fires
- [ ] T031 [US4] Integration test: crash + restart in `ghosts/ghost-house/tests/integration/supervisor-crash.test.ts` — start house + agent; interrupt agent; verify supervisor restarts; verify parallel session unaffected

**Checkpoint**: Supervisor health-check and retry loop verified by unit + integration tests. US4 independently testable.

---

## Phase 5: User Story 2 — Ghost Receives World Events (Priority: P2)

**Goal**: A Listener-tier agent receives translated Colyseus events (message, proximity, quest, session) as A2A push notifications per IC-004.

**Independent Test**: Deploy an `observer-agent` (Listener) that logs received events. Trigger a `message.new` event in the world. Confirm the agent log shows the IC-004 envelope. Run `tck:listener` to verify non-speech property.

### Implementation

- [ ] T032 [US2] Implement `ColyseusService` in `ghosts/ghost-house/src/colyseus-bridge/Colyseusbridge.ts` — subscribe to Colyseus world room as ghost house; receive Colyseus event fanouts for adopted ghosts
- [ ] T033 [US2] Implement `ghosts/ghost-house/src/colyseus-bridge/colyseus-bridge.layer.ts`
- [ ] T034 [US2] Translate `message.new` Colyseus events → `world.message.new` IC-004 envelopes in `Colyseusbridge.ts` (include `from`, `role`, `priority`, `text` in payload)
- [ ] T035 [P] [US2] Translate proximity events → `world.proximity.enter` / `world.proximity.exit` IC-004 envelopes in `Colyseusbridge.ts`
- [ ] T036 [P] [US2] Translate quest trigger events → `world.quest.trigger` IC-004 envelopes in `Colyseusbridge.ts`
- [ ] T037 [P] [US2] Translate session events → `world.session.start` / `world.session.end` IC-004 envelopes in `Colyseusbridge.ts`
- [ ] T038 [US2] Wire bridge → supervisor event routing in `SupervisorService` — receive `WorldEvent` from bridge, find session by `ghostId`, deliver as A2A push notification using non-blocking send + `setTaskPushNotificationConfig` (IC-002 push invariant)
- [ ] T039 [US2] Create `observer-agent` Listener example in `ghosts/ghost-house/examples/observer-agent/` — exposes A2A endpoint with `capabilities.pushNotifications: true`; logs all received IC-004 events; does NOT emit `say`
- [ ] T040 [US2] Add Listener TCK suite in `ghosts/tck/src/listener.ts` — tests: agent card declares `tier: "listener"` and `pushNotifications: true`; house delivers IC-004 `world.message.new` event within observable latency; envelope passes IC-004 schema (schema literal, ULID eventId, valid sentAt); agent does NOT emit `say` in response (non-speech property)
- [ ] T041 [P] [US2] Add `tck:listener` script to `ghosts/tck/package.json`

**Checkpoint**: `pnpm --filter @aie-matrix/tck run tck:listener` passes against `observer-agent`. US2 independently testable.

---

## Phase 6: User Story 3 — Ghost Speaks and Converses (Priority: P3)

**Goal**: A Social-tier agent emits `say` actions via A2A; the ghost house routes them into the Colyseus world as conversation records; ghost-to-ghost speech is delivered as `message.new` events to nearby Social agents.

**Independent Test**: Deploy a Social echo-agent. Send a message to the ghost. Confirm the echo appears in the world conversation log. Run `tck:social`.

### Implementation

- [ ] T042 [US3] Add outbound `say` handler in `Colyseusbridge.ts` — receive `say` action from a Social agent's A2A stream; emit into Colyseus as a conversation record attributed to the ghost
- [ ] T043 [US3] Wire `say` routing path: A2A host receives `say` from agent → `AgentSupervisor` routes to `Colyseusbridge` → Colyseus emits conversation record → bridge fans out `world.message.new` to nearby ghost sessions
- [ ] T044 [US3] Implement capability manifest query in `AgentSupervisor` — expose available house capabilities (initially `telemetry.otlp` if configured); validate `matrix.capabilitiesRequired` at spawn; return `CapabilityUnmet` error if a required capability is unavailable
- [ ] T045 [US3] Create Social echo-agent example in `ghosts/ghost-house/examples/echo-agent/` — receives `world.message.new` events; emits a `say` action echoing the received text; validates the full Social round-trip
- [ ] T046 [US3] Add Social TCK suite in `ghosts/tck/src/social.ts` — tests: agent card declares `tier: "social"` and `pushNotifications: true`; agent receives `world.message.new` event; agent emits `say` action; `say` appears in world conversation log attributed to the ghost; ghost-to-ghost message delivery round-trip
- [ ] T047 [P] [US3] Add `tck:social` script to `ghosts/tck/package.json`

**Checkpoint**: `pnpm --filter @aie-matrix/tck run tck:social` passes against `echo-agent`. US3 independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation sync, proposal updates, and final integration verification.

- [ ] T048 [P] Update RFC-0007 `proposals/rfc/0007-ghost-house-architecture.md` — mark all §Open Questions resolved (catalog paths → IC-005, event envelope → IC-004, spawn contract → IC-006, catalog persistence → file-backed JSON, task model → streaming + discrete, push notification prerequisites → documented in IC-002); update §Spawn and Supervision Contract step 4 to reference A2A task delivery
- [ ] T049 [P] Update `docs/architecture.md` component map — add ghost house service block and its connections to world server (MCP proxy), Colyseus (bridge), and ghost agents
- [ ] T050 [P] Update `CONTRIBUTING.md` with ghost agent contribution path — tier tiers, IC-001 agent card format, catalog registration endpoint (IC-005), TCK invocation per tier, localhost Phase 1 requirement
- [ ] T051 [P] Update `ghosts/ghost-house/README.md` — environment variables table, `pnpm dev` startup, catalog file location, relationship to `random-agent` and TCK
- [ ] T052 [P] Update `ghosts/random-agent/README.md` — environment variables, startup, how to register with the house, Wanderer TCK invocation
- [ ] T053 Run `pnpm typecheck` across all workspace packages; fix any type errors introduced by ghost-house or random-agent
- [ ] T054 Run full `quickstart.md` on a clean shell one final time; confirm every step succeeds with the production packages (not the spike)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all user stories
- **Phase 3 (US1 Wanderer)**: Depends on Phase 2 — first MVP delivery
- **Phase 4 (US4 Reliability)**: Depends on Phase 3 — extends the supervisor built in US1
- **Phase 5 (US2 Listener)**: Depends on Phase 4 — Colyseus bridge needs a reliable supervisor
- **Phase 6 (US3 Social)**: Depends on Phase 5 — `say` routing extends the bridge built in US2
- **Phase 7 (Polish)**: Depends on all desired user stories complete

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no dependency on other stories
- **US4 (P2)**: After US1 — extends `AgentSupervisor`; can be developed concurrently with US2 once US1 ships
- **US2 (P2)**: After US4 — Colyseus bridge requires a reliable supervisor
- **US3 (P3)**: After US2 — `say` routing extends the Colyseus bridge

### Within Each User Story

- Types (T006–T007) before services
- Service implementation before HTTP route wiring
- House services before agent implementation
- Agent implementation before TCK suite
- TCK suite before quickstart verification

### Parallel Opportunities

- T004 and T005 (vitest setup) in parallel
- T008 and T009 (deps install) in parallel
- T012 and T013 (CatalogService + layer) in parallel — different files
- T021 (buildAgentCard) in parallel with T022–T023 (executor + agent)
- T025 (tck:wanderer script) in parallel with T026 (quickstart verification)
- T034, T035, T036, T037 (bridge event translators) all in parallel — different event kinds
- T048–T052 (polish docs) all in parallel

---

## Parallel Example: User Story 1

```bash
# After T010 (ManagedRuntime scaffold), launch concurrently:
Task A: "T012 CatalogService in ghosts/ghost-house/src/catalog/CatalogService.ts"
Task B: "T014 A2AHostService in ghosts/ghost-house/src/a2a-host/A2AHostService.ts"
Task C: "T016 MCPProxyService in ghosts/ghost-house/src/mcp-proxy/MCPProxyService.ts"
Task D: "T021 buildAgentCard.ts in ghosts/random-agent/src/buildAgentCard.ts"

# After T018 (AgentSupervisor) and T023 (agent.ts), launch concurrently:
Task E: "T024 Wanderer TCK suite in ghosts/tck/src/wanderer.ts"
Task F: "T026 quickstart.md end-to-end verification"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational) — blocks everything
3. Complete Phase 3 (US1 Wanderer)
4. **Stop and validate**: `pnpm --filter @aie-matrix/tck run tck:wanderer` must pass
5. Ship: contributor guide live, `random-agent` reference running

### Incremental Delivery

1. Phase 1 + 2 → foundation ready
2. Phase 3 (US1) → Wanderer contribution model live (MVP!)
3. Phase 4 (US4) → house operates without operator intervention
4. Phase 5 (US2) → Listener agents receive world events
5. Phase 6 (US3) → Social agents speak; full conversation loop complete
6. Phase 7 → docs synced, ADR/RFC updated, typecheck clean

### Parallel Team Strategy

With two developers after Phase 2:
- Developer A: Phase 3 (US1) — ghost house services + random-agent
- Developer B: Phase 3 (US1) — Wanderer TCK + quickstart verification

After Phase 3:
- Developer A: Phase 4 (US4) — supervisor reliability
- Developer B: Phase 5 (US2) prep — Colyseus bridge design

---

## Notes

- `[P]` = different files, no incomplete dependencies — safe to parallelize
- `[US#]` = maps task to its user story for traceability
- `quickstart.md` was written during planning; T026 and T054 *run* it to verify
- RF-0007 and ADR-0004 must stay in sync per FR-021; T048 is the final checkpoint
- The spike (`spikes/a2a-ghost-agent-protocol/`) is reference material only — production code goes in `ghosts/`
- Phase 1 auth: `GHOST_HOUSE_DEV_TOKEN` static token throughout; flag any non-localhost usage immediately

---

## Summary

| Phase | User Story | Tasks | Parallelizable |
|-------|-----------|-------|---------------|
| 1 Setup | — | T001–T005 | T004, T005 |
| 2 Foundational | — | T006–T011 | T008, T009 |
| 3 Wanderer | US1 (P1) | T012–T026 | T012, T013, T021, T025 |
| 4 Reliability | US4 (P2) | T027–T031 | T030 |
| 5 Listener | US2 (P2) | T032–T041 | T035, T036, T037, T041 |
| 6 Social | US3 (P3) | T042–T047 | T047 |
| 7 Polish | — | T048–T054 | T048–T052 |
| **Total** | | **54 tasks** | **~15 parallel** |
