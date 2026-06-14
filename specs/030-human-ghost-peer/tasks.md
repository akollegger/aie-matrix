# Tasks: Human Participation as Ghost Peer

**Input**: Design documents from `specs/030-human-ghost-peer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: No new packages or scaffolding needed — all changes land in existing packages. This phase links the work to the governing proposal record.

- [X] T001 Add `030-human-ghost-peer` entry to `CLAUDE.md` Recent Changes section as an in-progress stub (update to final description after implementation)

---

## Phase 2: Foundational — JWT role claim + auth wiring

**Purpose**: The `role` claim in the JWT is the load-bearing primitive that all subsequent phases depend on. The spawn-grant wire is already coded but missing the claim; this phase closes that gap and adds the guest token endpoint.

**⚠️ CRITICAL**: Phases 3–6 (all user stories) depend on this phase.

- [X] T002 Add `role?: string` to `GhostClaims` interface in `server/world-api/src/jwt.ts`
- [X] T003 Extract `claims.role` and add to `auth.extra` object in `server/world-api/src/auth-context.ts`
- [X] T004 Create `server/world-api/src/guest-auth-route.ts` — `POST /auth/guest` handler: validate `ghostId`, call `mintGhostToken({ sub, ghostId, role: "human" })`, return `{ token }`
- [X] T005 Register `/auth/guest` route in the world-api h3 server entry point (find where other routes are registered and add alongside them)
- [X] T006 Add unit tests for `guest-auth-route.ts` in `server/world-api/tests/` — valid ghostId returns token with `role: "human"`; missing ghostId returns 400
- [X] T007 [P] Add `human` role to `:Grants` blocks in `maps/*.map.gram` — choose a reasonable starting credit amount for the broker-credit item type

**Checkpoint**: `POST /auth/guest` returns a JWT; `pnpm test` passes in `server/world-api`; spawn-grant code reads role from JWT for next connect.

---

## Phase 3: User Story 1 — Join as a named participant (P1) 🎯 MVP

**Goal**: Attendee opens client, gets stable identity, guest JWT, and a seeded credit balance.

**Independent Test**: Open fresh browser profile; verify localStorage has `ghostId` + `displayName`; HUD shows name and balance; reload and confirm same values; check ledger for spawn-grant transaction.

### Implementation

- [X] T008 [US1] Create `clients/intermedium/src/hooks/useIdentity.ts` — generate/persist ULID ghostId and auto-generated displayName in localStorage; fetch `POST /auth/guest` on load; expose `{ ghostId, displayName, token, setDisplayName }`; `setDisplayName` locks after one edit
- [X] T009 [US1] Wire `useIdentity` into `clients/intermedium/src/App.tsx` — gate MCP/Colyseus calls until `token` is available; expose identity via React context
- [X] T010 [US1] Create `clients/intermedium/src/components/HUD/BalanceDisplay.tsx` — call `inventory` MCP tool on mount and after contract settlement; display broker-credit balance; read token from identity context
- [X] T011 [US1] Mount `BalanceDisplay` in the HUD area of `clients/intermedium/src/App.tsx` or the appropriate layout component
- [X] T012 [US1] Add display name edit affordance in `clients/intermedium/src/` (small inline edit on the HUD name label; calls `setDisplayName`; hides edit control after save)
- [X] T013 [US1] Smoke test: document manual verification steps in `specs/030-human-ghost-peer/quickstart.md` (already drafted — confirm steps match implementation)

**Checkpoint**: P1 story fully functional; ghost peer identity established; credits visible in HUD.

---

## Phase 4: User Story 2 — Talk to a broker NPC (P2)

**Goal**: Human messages reach broker via unified `say()` MCP tool; broker receives them identically to ghost messages; broker ghosts are visually badged.

**Independent Test**: Select broker in ghost list; send "accept" via chat; verify broker inbox receives it; broker responds with question; contract appears.

### Server: ConversationService proximity exemption

- [X] T014 [US2] Add `callerRole?: string` parameter to `say()` method signature in `server/conversation/src/ConversationService.ts` (interface + implementation)
- [X] T015 [US2] Implement proximity exemption in `server/conversation/src/ConversationServiceLive.ts` — skip position check when `callerRole === "human"` and `to` is specified; broadcast path still requires position for all callers
- [X] T016 [US2] Extract `callerRole` from `auth.extra.role` in `sayEffect()` in `server/world-api/src/mcp-server.ts` and pass it through to `conversation.say()`
- [X] T017 [US2] Add unit tests in `server/conversation/tests/` — directed say with `callerRole: "human"` and no position succeeds; broadcast say with `callerRole: "human"` and no position fails with `ConversationGhostNoPosition`; existing ghost tests unchanged

### Server: Colyseus ghost labels

- [X] T018 [P] [US2] Add `ghostLabels: MapSchema<string>` to `WorldSpectatorState` in `server/colyseus/src/room-schema.ts`
- [X] T019 [US2] Populate `ghostLabels[ghostId]` on NPC ghost join and clear on leave in `server/colyseus/src/MatrixRoom.ts`
- [X] T020 [US2] Send character gram labels when npc-agent ghost joins the Colyseus room (find the join path in `ghosts/npc-agent/src/` and add labels from the character gram, e.g. `"Character:Broker"`)

### Client: unified messaging + broker badge

- [X] T021 [US2] Replace `POST /threads/{ghostId}/human-say` with MCP `say` tool call (using guest JWT, `to: ghostId`) in `clients/intermedium/src/hooks/useA2AConversation.ts`
- [X] T022 [US2] Expose `ghostLabels` per ghost from Colyseus room state in `clients/intermedium/src/hooks/useColyseus.ts`
- [X] T023 [US2] Add "Broker" badge to broker ghosts in `clients/intermedium/src/components/ChatPanel/GhostList.tsx` (or wherever the ghost list renders) — check `ghostLabels` for `"Character:Broker"`

**Checkpoint**: P2 story functional; human messages reach broker inbox; broker badge visible; broker responds to "accept".

---

## Phase 5: User Story 3 — Complete a broker challenge (P3)

**Goal**: Human sees the question, submits an answer, earns credits, appears on leaderboard.

**Independent Test**: With open contract visible, submit answer; contract moves to Settled; HUD balance increases; human entry appears on leaderboard.

### Client: contract polling + inline contract UI

- [X] T024 [US3] Create `clients/intermedium/src/hooks/useContracts.ts` — poll `eval_contract_list` MCP tool every 5s using guest JWT; return `activeContract: EvalContract | null` (first open/submitted contract where human is contractorId); expose `submitAnswer(contractId, submission)` which calls `eval_contract_submit`
- [X] T025 [US3] Modify `clients/intermedium/src/components/ChatPanel/ChatPanel.tsx` — when `activeContract` is non-null and the selected ghost is the contract's `clientId`, replace chat input with submission form (question text + textarea + submit button)
- [X] T026 [US3] Handle contract state transitions in the submission form — Submitted state shows "waiting for evaluation"; Settled clears form and restores chat input; Expired shows "challenge expired" and restores input; Declined (fully booked) shows message and restores input
- [X] T027 [US3] Trigger balance refresh in `BalanceDisplay` after contract settles — call `inventory` MCP tool again when `activeContract` transitions to Settled

**Checkpoint**: P3 story functional; full challenge loop working end-to-end.

---

## Phase 6: User Story 4 — View own leaderboard position (P4)

**Goal**: Human's leaderboard entry is highlighted so they can identify their own standing.

**Independent Test**: With credits earned, open leaderboard panel; human's entry is present and visually distinguished.

- [X] T028 [US4] Pass `humanGhostId` (from identity context) into `clients/intermedium/src/components/LeaderboardPanel/LeaderboardPanel.tsx`
- [X] T029 [US4] Apply a visual distinction (CSS highlight class or "you" label) to the leaderboard entry whose `actorId` matches `humanGhostId`

**Checkpoint**: P4 story functional; human's row is identifiable on the leaderboard.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T030 [P] Update `docs/architecture.md` — add human client as a peer actor type; document role-based proximity exemption for `human` role
- [X] T031 [P] Verify `pnpm run build` passes cleanly from repo root after all changes
- [X] T032 [P] Run `pnpm test` in `server/world-api`, `server/conversation`, `server/colyseus` — confirm all pass
- [X] T033 Update `CLAUDE.md` Recent Changes entry for `030-human-ghost-peer` with final description
- [X] T034 Run `/speckit-verify` and confirm GO verdict before opening PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 — client identity + JWT + spawn-grant
- **Phase 4 (US2)**: Depends on Phase 2 — server proximity exemption + ghost labels; also depends on Phase 3 (JWT in client)
- **Phase 5 (US3)**: Depends on Phase 4 — requires unified messaging and contract delivery
- **Phase 6 (US4)**: Depends on Phase 5 — requires credits on leaderboard
- **Phase 7 (Polish)**: Depends on all user story phases

### Within Phase 4 (US2)

- T014–T017 (ConversationService) and T018–T020 (Colyseus labels) can proceed in parallel
- T021–T023 (client) depend on T014–T016 server changes being deployed

### Parallel Opportunities

- T002 + T007 (JWT claim + map gram grants) can proceed in parallel
- T014–T020 (server side of US2) can proceed in parallel once Phase 2 is complete
- T028–T029 (US4) can proceed in parallel with T030 (docs)
- T031–T032 (build + test) can proceed in parallel

---

## Implementation Strategy

### MVP (User Story 1 Only — Phases 1–3)

1. Phase 1: T001
2. Phase 2: T002–T007
3. Phase 3: T008–T013
4. **Validate**: Open fresh browser, confirm identity + balance

### Incremental Delivery

| Phase | Delivers |
|-------|---------|
| 1 + 2 | Guest JWT; spawn-grant wired for human role |
| + 3 | P1: Stable identity, HUD balance, display name |
| + 4 | P2: Unified messaging, broker badge, broker receives human "accept" |
| + 5 | P3: Full challenge loop — question, submission, settlement, balance update |
| + 6 | P4: Leaderboard self-highlighting |
| + 7 | Polish + PR ready |
