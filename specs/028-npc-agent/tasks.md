# Tasks: NPC Agent — Rule-Based Character Roster

**Input**: Design documents from `/specs/028-npc-agent/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅ (IC-001–IC-008)
**RFC**: [RFC-0026](../../proposals/rfc/0026-npc-agent.md) | **ADR**: [ADR-0012](../../proposals/adr/0012-ghost-self-spawn-lifecycle.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared incomplete dependency)
- **[Story]**: US1–US4 maps to spec.md user stories by priority
- Exact file paths are given for every implementation task

---

## Phase 1: Setup (Package Scaffolding)

**Purpose**: Create the `ghosts/npc-agent` package and wire it into the monorepo so all subsequent tasks have a build target.

- [X] T001 Scaffold `ghosts/npc-agent/` mirroring `ghosts/random-agent/` — create `package.json` (`@aie-matrix/npc-agent`, port 4004, deps: `@a2a-js/sdk`, `@modelcontextprotocol/sdk`, `@aie-matrix/ghost-ts-client`, `@aie-matrix/root-env`, `@relateby/pattern ^0.4.2`, `express`, `h3-js`, `ulid`), `tsconfig.json` (extends `../../tsconfig.base.json`), `vitest.config.ts`
- [X] T002 Add `ghosts/npc-agent` to `pnpm-workspace.yaml` and to the `test:packages` filter in root `package.json`
- [X] T003 [P] Copy and adapt `ghosts/random-agent/src/spawn-types.ts` → `ghosts/npc-agent/src/spawn-types.ts` (add optional `background: string` and `characterId: string` fields to `SpawnContext.ghostCard` per IC-008/data-model)
- [X] T004 [P] Copy and adapt `ghosts/random-agent/src/world-event.ts` → `ghosts/npc-agent/src/world-event.ts` (add `world.session.start` case to `WorldEventKind`)
- [X] T005 [P] Create `ghosts/npc-agent/src/buildAgentCard.ts` declaring `pushNotifications: true`, `llmProvider: none`, subscribes to `aie-matrix.world-event.v1` (IC-005)
- [X] T006 Create stub `ghosts/npc-agent/src/agent.ts` — express A2A server on port 4004, registers/deregisters with agent-host, mirrors `random-agent/src/agent.ts`; connects to a stub `AgentExecutor` so `pnpm build` passes

**Checkpoint**: `cd ghosts/npc-agent && pnpm build` succeeds, package visible in workspace

---

## Phase 2: Foundational (Server-Side Additive Changes)

**Purpose**: The three service capabilities required by all user stories (IC-006, IC-007, IC-008). These server changes are **blocking prerequisites** — the npc-agent cannot self-spawn or receive session signals without them.

- [X] T007 **IC-008 — per-ghost `background` (registry adoption payload)**: add optional `background: string` to the adoption request type and persist it in `server/registry/src/routes/adoption.ts` and `server/world-api/src/registry-store-model.ts`
- [X] T008 **IC-008 — `background` in SpawnContext**: extend `SpawnContext.ghostCard` in `server/agent-host/src/types.ts` with optional `background` and `characterId`; update `SupervisorService.ts` spawn path to pass them through (around line 378 where `displayName` is currently threaded)
- [X] T009 **IC-008 — surface `background` on read paths**: update `whereami` response in `server/world-api/src/mcp-server.ts` (around line 783) and `GET /registry/ghosts/:id` to include `background` alongside `displayName`
- [X] T010 **IC-007 — emit `world.session.start`**: add a `fanoutWorldV1` call in the world server when a live session becomes active (`server/src/index.ts` around line 441, same mechanism as `message.new`); payload: `{ schema: "aie-matrix.world-event.v1", kind: "world.session.start", payload: { sessionId }, ghostId, eventId, sentAt }`
- [X] T011 **IC-006 — agent-callable spawn endpoint**: add `POST /v1/sessions/spawn-roster/:agentId` to `server/agent-host/src/app.ts`; authenticate caller via its scoped session credential (validated against existing session/token maps at `SupervisorService.ts:426`); loop `AgentSupervisor.spawn` per character; return `{ spawned[], failed[] }` per IC-006 contract; per-character failures do not abort the batch
- [X] T012 **IC-006 — deterministic ghostId derivation**: implement `deriveCharacterGhostId(sessionId, characterId): string` in `server/agent-host/src/supervisor/SupervisorService.ts` (or adjacent util) — ensures restart-idempotent spawn (R3/US1 scenario 3)

**Checkpoint**: `pnpm typecheck` passes across `server/agent-host`, `server/world-api`, `server/registry`. Manual smoke: `POST /v1/sessions/spawn-roster/:agentId` with a valid agent session token returns 200 (or 401 for bad token).

---

## Phase 3: User Story 1 — Session Populates with Named NPCs (Priority: P1) 🎯 MVP

**Story goal**: On `world.session.start`, the npc-agent spawns one ghost per enabled catalog character, each with its configured name and background visible on inspection. Agent restart re-attaches under the same ghost IDs (no duplication).

**Independent test**: Register npc-agent, start a session containing 3 enabled + 1 disabled catalog entries, confirm exactly 3 named ghosts appear.

- [X] T013 [US1] Implement `CharacterDefinition`, `BehaviorRule`, `DialogTree`, `DialogNode`, `NpcAgentCatalog` TypeScript types in `ghosts/npc-agent/src/types.ts` (from data-model.md)
- [X] T014 [P] [US1] Implement `ghosts/npc-agent/src/catalog/parse-character-gram.ts` — parse a single `.character.gram` file via `@relateby/pattern` `parseWithHeader`; extract header fields (`kind`, `id`, `name`, `background`, `enabled`, `defaultAction`), `[behaviors:Behaviors]` block (ordered `Rule` nodes), `(:DialogNode {…})` declarations, and `[dialog:DialogTree]` edges; return `CharacterDefinition` or a typed error (follow `parse-calendar-gram.ts` pattern: accumulate missing fields, skip on failure)
- [X] T015 [P] [US1] Implement `ghosts/npc-agent/src/catalog/catalog-loader.ts` — read all `*.character.gram` files from `NPC_CATALOG_DIR` (env var, default `./catalog`), call `parseCharacterGram` per file, dedupe by `id` (duplicate → warning + skip), return populated `NpcAgentCatalog`
- [X] T016 [US1] Implement `ghosts/npc-agent/src/roster/spawn-roster.ts` — given a loaded catalog and a `sessionId`+`agentCredential`, call `POST /v1/sessions/spawn-roster/:agentId` for all `enabled()` characters; collect `spawned`/`failed`; log failures without aborting; return map of `characterId → ghostId`
- [X] T017 [US1] Implement the top-level coordinator in `ghosts/npc-agent/src/executor.ts`: on startup query `GET /live?status=active` (ADR-0012 R3); if a session is active call `spawnRoster` immediately; otherwise await `world.session.start` A2A push notification then call `spawnRoster`; store `characterId → ghostId` mapping for the action and dialog phases
- [X] T018 [P] [US1] Write unit tests `ghosts/npc-agent/tests/parse-character-gram.test.ts` — valid file parses to correct `CharacterDefinition`; missing required field → skipped with error; duplicate id across two files → second skipped; `enabled: false` entry present and distinct from enabled
- [X] T019 [P] [US1] Write unit tests `ghosts/npc-agent/tests/buildAgentCard.test.ts` — confirms `pushNotifications: true`, correct A2A schema subscriptions
- [X] T020 [US1] Create 3 example catalog entries `ghosts/npc-agent/catalog/info-attendant.character.gram`, `collector.character.gram`, `hermit.character.gram` (at least 1 `enabled: false`) for local dev / smoke tests
- [X] T021 [P] [US1] Create `ghosts/npc-agent/schema/character.gram.md` documenting the gram shape with a worked example (IC-001 reference doc)
- [X] T022 [US1] Update `ghosts/npc-agent/src/agent.ts` to wire the real `executor.ts` (replace stub); confirm `pnpm build` and `pnpm test` pass

**Checkpoint**: `pnpm test` in `ghosts/npc-agent` passes. With a live server: npc-agent registers, session starts, catalog characters appear as distinct named ghosts; restart produces no duplicates.

---

## Phase 4: User Story 2 — Characters Follow Behavioral Rules (Priority: P2)

**Story goal**: Each character's action loop evaluates its behavior-rule table in priority order each tick, executing goal-directed MCP actions rather than random moves. Unknown-state falls back to `defaultAction`.

**Independent test**: Run a "resource-seeker" character in a world with items within 3 cells; after 20 ticks confirm it has moved toward and taken at least one item.

- [ ] T023 [US2] Implement `ghosts/npc-agent/src/behavior/rule-engine.ts` — given a `CharacterDefinition` and a world-state snapshot, evaluate `behaviorRules` in priority order; for each rule call the appropriate `GhostMcpClient` method (`go`, `take`, etc.) when the condition holds; return on first match; fall back to `defaultAction` when no rule fires; degrade gracefully if an MCP call fails (skip rule, try next, then fallback) — per spec edge case
- [ ] T024 [US2] Integrate the rule engine into the per-character action loop in `ghosts/npc-agent/src/executor.ts`: after roster spawn, start one async loop per spawned character (keyed by `ghostId`); each tick calls `whereami`, `exits`, `inventory` via `GhostMcpClient`, then `evaluateRules`; loop failure for one character MUST NOT affect others (FR-005)
- [ ] T025 [P] [US2] Write unit tests `ghosts/npc-agent/tests/rule-engine.test.ts` — `inventory_empty` + item nearby → `seek-item` action fires; `crowded` → `avoid-crowd` fires; no rule matches → `defaultAction` returned; MCP failure on first rule → second rule evaluated; `always` condition always matches
- [ ] T026 [P] [US2] Add condition evaluators for the closed condition set (`inventory_empty`, `crowded`, `item_nearby`, `alone`, `always`) in `ghosts/npc-agent/src/behavior/rule-engine.ts`; each takes the world-state snapshot, returns boolean

**Checkpoint**: Unit tests pass. Manual: a catalog character with a `seek-item` rule moves toward a nearby item over several ticks.

---

## Phase 5: User Story 3 — Characters Converse via Dialog Tree (Priority: P3)

**Story goal**: Inbound messages addressed to an NPC (from any non-NPC ghost or human partner) trigger dialog-tree evaluation; replies are keyed per-partner so simultaneous conversations maintain independent state. Sibling NPC messages are ignored.

**Independent test**: External ghost sends "hello" then "bye" to an NPC with a greeting→farewell dialog tree; NPC replies with the greeting text then the farewell text (FR-015/SC-007/SC-008).

- [ ] T027 [US3] Implement `ghosts/npc-agent/src/dialog/dialog-engine.ts` — `evaluateDialog(tree, state, senderGhostId, inboundText): { response: string, nextNodeId: nodeId }`: case-insensitive keyword-substring scan over trigger conditions; random selection among `responses`; transition update; fallback node on no-match (FR-010/FR-011/FR-012); cycle guard (max traversal depth or loop detection)
- [ ] T028 [US3] Integrate the dialog engine into `ghosts/npc-agent/src/executor.ts`: handle incoming `world.message.new` A2A notifications; identify target character by `ghostId`; reject sibling-NPC senders (FR-009 — sender ghostId is in the roster map); look up or initialize `DialogState` for `(characterGhostId, partnerGhostId)`; call `evaluateDialog`; send reply via `GhostMcpClient.say` with `to: senderGhostId` for `DIRECT` delivery; update per-partner state (FR-012)
- [ ] T029 [P] [US3] Write unit tests `ghosts/npc-agent/tests/dialog-engine.test.ts` — trigger match fires correct node; random response is from the node's `responses` list; transition updates state; fallback fires on no match; two partners advance independently (no shared state); sibling-NPC sender is rejected before dialog state is created; cycle guard prevents infinite loop
- [ ] T030 [P] [US3] Add `_tck/dialog` introspection endpoint to `ghosts/npc-agent/src/agent.ts` — returns current per-character dialog state map (for integration-test assertion per R8)
- [ ] T031 [US3] Add `ghosts/tck/src/npc.ts` integration harness — mirrors `social.ts` structure: validate agent card → register npc-agent → create caretaker+house → adopt one external ghost → spawn → inject `world.message.new` via `/internal/world-fanout` → assert NPC reply via `_tck/dialog` or conversation log; covers (a) single multi-turn dialog (SC-007) and (b) two interleaved conversations with independent state (SC-008)

**Checkpoint**: `pnpm test` passes. Integration: `pnpm test:tck` npc harness (live server) completes the scripted 3-turn dialog and the two-ghost interleaved test with correct replies.

---

## Phase 6: User Story 4 — Operator Configures the Catalog (Priority: P4)

**Story goal**: A new `.character.gram` file in `NPC_CATALOG_DIR` appears on the next agent start with no code changes. Malformed files are skipped with warnings; `enabled: false` entries are never spawned.

**Independent test**: Add a new `.character.gram`, restart npc-agent, confirm the new character spawns.

- [ ] T032 [US4] Verify `NPC_CATALOG_DIR` env var is read in `catalog-loader.ts` with a correct default (`./catalog`); write a test in `ghosts/npc-agent/tests/catalog-loader.test.ts` — empty dir → empty catalog + log warning; malformed file → skipped + warning, valid file loads; two files with duplicate `id` → second skipped; `enabled: false` entry excluded from `catalog.enabled()`
- [ ] T033 [P] [US4] Add staging compose service block for `npc-agent` in `deploy/staging/docker-compose.yml` mirroring the `funder-agent` block (port 4004, `NPC_CATALOG_DIR` env + volume mount for catalog files)
- [ ] T034 [P] [US4] Write `ghosts/npc-agent/Dockerfile` — 3-stage build mirroring `random-agent/Dockerfile`; add `@relateby/pattern` to topological build order

**Checkpoint**: `docker build ghosts/npc-agent` succeeds. Staging compose starts with catalog volume mounted; adding a file and restarting produces the new character.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T035 Write `ghosts/npc-agent/README.md` — catalog format, env vars (`NPC_CATALOG_DIR`, `AGENT_HOST_URL`, `MCP_TOKEN`), how to add a character, how to run locally
- [ ] T036 [P] Update `docs/project-overview.md` — add npc-agent to the agent roster section, describe the character catalog concept
- [ ] T037 [P] Update `AGENTS.md` — add npc-agent entry alongside random-agent for agent-consumer guidance
- [ ] T038 [P] Update `docs/architecture.md` — add agent-callable self-spawn capability to the agent-host ↔ first-party-ghost link (around line 212) and note `world.session.start` is now emitted (per ADR-0012 Consequences)
- [ ] T039 Run `pnpm typecheck` and `pnpm test` across the full workspace; fix any type errors introduced by IC-008 additive changes (spawn-types, registry, supervisor)
- [ ] T040 [P] Verify RFC-0026 status in `proposals/rfc/0026-npc-agent.md` — update to `accepted` once all P1 tasks land

---

## Dependencies

```
Phase 1 (T001–T006) → Phase 2 (T007–T012) → Phase 3 (T013–T022)
                                            → Phase 4 (T023–T026) [requires Phase 3 executor loop]
                                            → Phase 5 (T027–T031) [requires Phase 3 executor + roster map]
                       Phase 2 (T007)       → Phase 6 (T032–T034) [US4 catalog-loader tests stand alone]
Phase 3 complete → Phase 7 (T035–T040)
```

**Phase 3 is hard-gated on Phase 2** — the server-side spawn endpoint (T011) and `world.session.start` emission (T010) must exist before the npc-agent coordinator (T017) can be exercised.

Within a phase, tasks marked `[P]` can run in parallel once their phase's non-[P] tasks are complete.

---

## Parallel Execution Examples

**Phase 3 inner parallel** (once T013 types are defined):
- T014 (catalog parser) ∥ T015 (catalog loader) ∥ T019 (agent card test) ∥ T021 (schema doc)

**Phase 2 inner parallel**:
- T007 (registry adoption) ∥ T010 (`session.start` emission) — different packages
- T008 + T009 are sequential (T009 reads SpawnContext shape set by T008)

**Phase 4 inner parallel** (all after T023 engine core):
- T025 (rule-engine tests) ∥ T026 (condition evaluators)

---

## Implementation Strategy

**MVP scope = Phase 1 + Phase 2 + Phase 3 (US1)**

US1 delivers the visible milestone: named NPC characters appearing in a session. Everything in US2–US4 builds on that foundation. Recommend shipping US1 → US2 → US3 as successive increments before tackling US4 config polish and the staging deployment.

**Total tasks**: 40
- Phase 1 (Setup): 6
- Phase 2 (Foundational): 6
- Phase 3 (US1): 10
- Phase 4 (US2): 4
- Phase 5 (US3): 5
- Phase 6 (US4): 3
- Phase 7 (Polish): 6

**Parallel opportunities per phase**: Phase 3 has the most (T014, T015, T018, T019, T021 all parallelizable once T013 is done).
