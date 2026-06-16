# Tasks: Ghost Agent Autospawning

**Input**: Design documents from `specs/032-ghost-autospawn/`  
**Branch**: `032-ghost-autospawn`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: No new project scaffolding needed — changes are additive to existing packages.

- [x] T001 Confirm branch `032-ghost-autospawn` is active and `pnpm install` is clean from repo root

---

## Phase 2: Foundational (No Blockers)

This feature has no foundational prerequisites beyond the existing codebase. Slices A, B, and C can proceed in parallel immediately after T001.

---

## Phase 3: Slice A — random-agent roster endpoint (US1 + US2)

**Goal**: random-agent exposes `GET /v1/roster` and declares `rosterAgent: true`, making it a first-class roster agent identical to npc-agent from agent-host's perspective.

**Independent Test**: `curl http://127.0.0.1:4001/v1/roster` returns 10 entries. `pnpm --filter @aie-matrix/random-agent test` passes.

- [x] T002 [P] [US1] Add `rosterAgent: true` to `matrix` block in `ghosts/random-agent/src/buildAgentCard.ts` (inside `buildWandererAgentCard` return value)
- [x] T003 [P] [US1] Add `GET /v1/roster` endpoint to `ghosts/random-agent/src/agent.ts` — reads `RANDOM_AGENT_COUNT` env var (default 10, min 0), returns `Array<{characterId: "wanderer-N", displayName: "Wanderer N"}>`
- [x] T004 [US1] Add `rosterAgent: true` to the `agentCard.matrix` block in the `random-agent` entry in `server/agent-host/catalog.json` (local dev catalog)
- [x] T005 [US2] Add `RANDOM_AGENT_COUNT` env var to `deploy/k8s/ghosts/random-agent.yaml` with value `"10"`
- [x] T006 [US1] Write `ghosts/random-agent/tests/roster.test.ts` with unit tests covering: default count (10 entries), `RANDOM_AGENT_COUNT=3` (3 entries), `RANDOM_AGENT_COUNT=0` (empty array), response schema shape (`characterId`, `displayName` present)
- [x] T007 [US1] Run `pnpm --filter @aie-matrix/random-agent test` and confirm all tests pass including T006

**Checkpoint**: `GET /v1/roster` works, agent card has `rosterAgent: true`, tests pass.

---

## Phase 4: Slice B — agent-host startup reconciliation (US1)

**Goal**: agent-host checks for an active live session on startup and spawns all roster agents' ghosts if one is found.

**Independent Test**: Restart agent-host with an active session running. Logs show `startup-reconciliation.found-session` and `roster-spawn-complete`. Ghosts appear in Intermedium.

- [x] T008 [US1] Add startup reconciliation async bootstrap to `server/agent-host/src/main.ts` in the `app.listen(...)` callback, after the Barnacle encounter trigger block — fetch `GET ${worldApiUrl}/live?status=active`, iterate `catalogFile.agents` for `rosterAgent: true` entries, call `supervisor.spawnRosterForAgent` for each; guard with `AGENT_HOST_DISABLE_RECONCILIATION !== "1"` env var opt-out; log `agent-host.startup-reconciliation.*` events
- [x] T009 [US1] Run `pnpm --filter @aie-matrix/server-agent-host test` and confirm existing tests still pass (no regression)
- [x] T010 [US1] Manual smoke test per `specs/032-ghost-autospawn/quickstart.md` restart scenario — confirm ghosts reappear after agent-host restart with active session

**Checkpoint**: Ghosts auto-spawn after pod restart. Existing tests unaffected.

---

## Phase 5: Polish & Docs

- [x] T011 [P] Update `CLAUDE.md` Recent Changes section with a summary of this feature (ghost autospawn via startup reconciliation + random-agent roster endpoint)
- [x] T012 [P] Run full build from repo root: `pnpm run build` — must pass cleanly
- [x] T013 Run `pnpm test` from repo root — confirm no regressions across all packages

---

## Dependencies & Execution Order

### Phase Dependencies

- **T001 (Setup)**: No dependencies — start immediately
- **T002–T007 (Slice A)**: Depend only on T001; T002, T003, T005 can run in parallel
- **T008–T010 (Slice B)**: Depend only on T001; independent of Slice A (can run in parallel with Phase 3)
- **T011–T013 (Polish)**: Depend on T007 + T009 + T010

### Parallel Opportunities

Slices A and B are fully independent — different packages, no shared files:

```
T001
├── T002 [P]  buildAgentCard.ts
├── T003 [P]  agent.ts (random-agent)    ← Slice A (can run in parallel)
├── T004      catalog.json
├── T005 [P]  random-agent.yaml
└── T008      main.ts (agent-host)       ← Slice B (can run in parallel with A)
```

After T002 + T003 + T004:
```
T006  roster.test.ts
T007  pnpm test (random-agent)
```

After T008:
```
T009  pnpm test (agent-host)
T010  manual smoke test
```

After T007 + T009 + T010:
```
T011 [P]  CLAUDE.md
T012 [P]  pnpm run build
T013      pnpm test (all)
```

---

## Implementation Strategy

### MVP (Slice A only — unblocks existing `world.session.start` path)

1. T001 → T002, T003, T004, T005 (parallel) → T006 → T007
2. Deploy: random-agent now self-manages its roster via the existing `world.session.start` trigger
3. **Validates**: New sessions work end-to-end without a bootstrap job

### Full delivery (adds restart resilience)

4. T008 → T009 → T010
5. **Validates**: Pod restarts no longer empty the world

### Incremental deploy note

Slice A can be deployed independently — it adds value immediately by making new session activations automatically populate wanderers. Slice B can follow in the next deploy cycle if needed.
