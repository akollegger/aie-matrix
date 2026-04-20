# Tasks: Ghost Conversation Mechanics

**Input**: Design documents from `specs/006-ghost-conversation/`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

---

## Phase 1: Setup

**Purpose**: Accept proposals, scaffold new package, add shared types.

- [ ] T001 Accept RFC-0005: update **Status** from `draft` to `accepted` in `proposals/rfc/0005-ghost-conversation-model.md`
- [ ] T002 Accept ADR-0003: update **Status** from `proposed` to `accepted` in `proposals/adr/0003-conversation-server.md`
- [ ] T003 Create `server/conversation/` package scaffolding: `package.json` (workspace name `@aie-matrix/conversation`, ESM, Node 24), `tsconfig.json` (extends root), `src/` directory
- [ ] T004 Add `ulid` dependency to `server/conversation/package.json`
- [ ] T005 [P] Create `shared/types/src/conversation.ts`: export `MessageRecord`, `ConversationStore`, and `PendingNotification` interfaces per `data-model.md`
- [ ] T006 [P] Add `SayArgs`, `SayResult`, `ByeArgs`, `ByeResult`, `InboxResult` to `shared/types/src/ghostMcp.ts` per `contracts/mcp-tools.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Colyseus schema extension, ConversationService, and server wiring — must complete before any user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T007 Add `ghostModes: MapSchema<string>` field to `WorldSpectatorState` in `server/colyseus/src/room-schema.ts`
- [ ] T008 Add `setGhostMode(ghostId, mode)` and `getGhostMode(ghostId)` methods to `MatrixRoom` in `server/colyseus/src/MatrixRoom.ts`; default absent key → `"normal"`
- [ ] T009 [P] Implement `ConversationStore` interface and `JsonlStore` class in `server/conversation/src/store.ts`: `append()`, `get()`, `list()` with ULID cursor pagination; JSONL files at `CONVERSATION_DATA_DIR/{ghost_id}.jsonl`
- [ ] T010 Implement `ConversationService` Effect service in `server/conversation/src/ConversationService.ts`: ghost state map, `say()` (cluster compute via `h3.gridDisk` + `MatrixRoom.listOccupantsOnCell`, store append, notification enqueue, mode transition), `bye()` (mode transition), `inbox()` (drain queue); depends on T007–T009
- [ ] T011 Export public API from `server/conversation/src/index.ts`: re-export `ConversationService`, `ConversationStore`, `MessageRecord`, `JsonlStore`
- [ ] T012 Wire `ConversationService` Layer into `server/src/index.ts`; remove `TranscriptHubService` stub and its `PubSub` wiring

**Checkpoint**: `pnpm typecheck` passes; server starts; `ConversationService` layer resolves.

---

## Phase 3: User Story 1 — Ghost Broadcasts a Message (Priority: P1) 🎯 MVP

**Goal**: `say` tool transitions ghost to conversational mode, persists the message record, fans out inbox notifications to cluster members, and rejects `go`/`traverse` while in mode.

**Independent Test**: Ghost issues `say "hello"` via ghost-cli one-shot; record appears in `CONVERSATION_DATA_DIR/{ghost_id}.jsonl`; subsequent `go` is rejected with `IN_CONVERSATION`.

- [ ] T013 [US1] Add `say` MCP tool to `server/world-api/src/mcp-server.ts`: validate content, call `ConversationService.say()`, return `SayResult`; wire `ConversationService` into `ToolServices` layer
- [ ] T014 [US1] Add `IN_CONVERSATION` guard at the top of the `go` tool handler in `server/world-api/src/mcp-server.ts`
- [ ] T015 [US1] Add `IN_CONVERSATION` guard at the top of the `traverse` tool handler in `server/world-api/src/mcp-server.ts` (sequential with T014 — same file)
- [ ] T016 [P] [US1] Add `say(content: string)` method wrapper to `ghosts/ts-client/src/client.ts`
- [ ] T017 [US1] Verify smoke test 1 (partial): `ghost-cli --token <tok> say "hello"` persists record and `go` is rejected; document result in `quickstart.md`

**Checkpoint**: US1 independently functional — say works, movement blocked, record on disk.

---

## Phase 4: User Story 2 — Ghost Ends a Conversation (Priority: P2)

**Goal**: `bye` tool transitions ghost from conversational mode back to normal, re-enabling movement. No-op from normal state.

**Independent Test**: Ghost in conversational mode issues `bye`; subsequent `go` succeeds. Ghost in normal state issues `bye`; no error, state unchanged.

- [ ] T018 [US2] Add `bye` MCP tool to `server/world-api/src/mcp-server.ts`: call `ConversationService.bye()`, return `ByeResult` with `previous_mode`
- [ ] T019 [US2] Add `bye()` method wrapper to `ghosts/ts-client/src/client.ts`
- [ ] T020 [US2] Verify smoke test 1 (complete): `say` → `go` rejected → `bye` → `go` succeeds; document result in `quickstart.md`

**Checkpoint**: US1 + US2 fully functional — full say/bye round-trip works end-to-end.

---

## Phase 5: User Story 3 — Ghost House Monitors Conversation History (Priority: P3)

**Goal**: Ghost house authenticates with its API key and reads message history for any of its registered ghost instances via HTTP.

**Independent Test**: After ghost has sent messages, `curl -H "Authorization: Bearer <key>" /threads/<ghost_id>` returns records with correct fields; pagination via `?after=<ulid>` works.

- [ ] T021 [US3] Verify `GhostClaims` in `server/auth/src/jwt.ts` includes `ghostHouseId`; add it if absent and update token issuance in `server/registry/`
- [ ] T022 [US3] Implement `ConversationRouter` in `server/conversation/src/router.ts`: `GET /threads/:ghostId` (list + pagination) and `GET /threads/:ghostId/:messageId` (single); auth checks ghost belongs to calling ghost house via `RegistryStoreService`
- [ ] T023 [US3] Mount `ConversationRouter` at `/threads` in `server/src/index.ts`
- [ ] T024 [US3] Verify smoke test 3: list, paginate with `after` cursor, fetch single message; document result in `quickstart.md`

**Checkpoint**: US3 independently functional — ghost house can read full thread history over HTTP.

---

## Phase 6: User Story 4 — Developer Exercises Conversation from ghost-cli + random-house + debug panel (Priority: P4)

**Goal**: Developer can `say` and `bye` in the ghost-cli REPL and one-shot mode with clear state feedback; random-house ghosts engage in and exit conversations autonomously; debug panel shows conversational mode per ghost.

**Independent Test**: ghost-cli REPL shows `[conversational]` in status after `say`, clears on `bye`, logs inbox notifications; random-house with 3 ghosts shows conversational state transitions in debug panel within 30s.

- [ ] T025 [P] [US4] Add `inbox` MCP tool to `server/world-api/src/mcp-server.ts`: call `ConversationService.inbox()`, return `InboxResult`
- [ ] T026 [P] [US4] Add `inbox()` method wrapper to `ghosts/ts-client/src/client.ts`
- [ ] T027 [US4] Add `Say`, `Bye` variants to `ReplCommand` discriminated union and extend `parseReplCommand` in `ghosts/ghost-cli/src/repl/repl-state.ts`; `say <rest of line>` captures full content, `bye` takes no args
- [ ] T028 [US4] Add `say`/`bye` dispatch and inbox polling loop (every 3s) to `ghosts/ghost-cli/src/repl/session.ts`; store ghost mode in session state
- [ ] T029 [US4] Add `[conversational]` mode token to `StatusStrip` in `ghosts/ghost-cli/src/repl/StatusStrip.tsx`; shown when mode is conversational, hidden otherwise
- [ ] T030 [P] [US4] Append `message.new` log entries to `LogPanel` in `ghosts/ghost-cli/src/repl/LogPanel.tsx` when inbox returns notifications
- [ ] T031 [P] [US4] Add `say <content>` and `bye` one-shot handlers to `ghosts/ghost-cli/src/oneshot/commands.ts`
- [ ] T032 [US4] Register `say` and `bye` as subcommands in `ghosts/ghost-cli/src/cli.ts`
- [ ] T033 [US4] Subscribe to `room.state.ghostModes.onChange` in `client/phaser/src/spectatorDebug.ts`; add `mode` column to per-ghost debug entry line
- [ ] T034 [US4] Add conversation behavior loop to `ghosts/random-house/src/index.ts`: after `look` shows occupants → 20% chance to `say`; after `inbox` returns notifications → always `say` a response; while conversational → 15% chance per poll tick to `bye`; skip walk step while conversational
- [ ] T035 [US4] Verify smoke tests 1 (ghost-cli full round-trip), 2 (random-house + debug panel), and 4 (debug panel mode column); document results in `quickstart.md`

**Checkpoint**: Developer can fully exercise conversation in ghost-cli; random-house ghosts converse autonomously; debug panel reflects live state.

---

## Phase 7: User Story 5 — Ghost Moves Through a Cluster (Priority: P5)

**Goal**: Confirm that cluster membership is correctly computed per `say` call — a ghost that enters the speaker's cluster before the next `say` receives a notification; one that has left does not.

**Independent Test**: Two ghost-cli sessions — Ghost B outside cluster; Ghost A says (B not in listeners); Ghost B moves into cluster; Ghost A says again (B now in listeners and gets inbox notification).

- [ ] T036 [US5] Verify cluster membership integration: run two ghost-cli sessions, move Ghost B in/out of Ghost A's cluster between `say` calls; confirm `mx_listeners` and inbox results match spatial position; document test sequence in `quickstart.md`

**Checkpoint**: Cluster computation confirmed correct under movement.

---

## Phase 8: User Story 6 — Conversation Store Backend is Swapped (Priority: P6)

**Goal**: Demonstrate the `ConversationStore` interface is genuinely pluggable — an alternative implementation can replace `JsonlStore` with no changes outside `server/conversation/`.

**Independent Test**: Wire `MemoryStore` into `ConversationService` in place of `JsonlStore`; all smoke test 1 and 3 scenarios pass unchanged.

- [ ] T037 [US6] Add `MemoryStore` class to `server/conversation/src/store.ts`: in-memory `Map`-backed implementation of `ConversationStore`; demonstrates interface pluggability without requiring disk I/O
- [ ] T038 [US6] Create `server/conversation/README.md`: store interface docs, `JsonlStore` quickstart, `MemoryStore` example, contribution guide for alternative implementations

**Checkpoint**: Pluggable store contract verified; contributor entry point documented.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T039 [P] Update `docs/architecture.md`: add `server/conversation/` to the server package inventory with a note that the store interface is an extension point
- [ ] T040 [P] Update `CLAUDE.md` Recent Changes entry for `006-ghost-conversation`: new `server/conversation/` package, `ulid`, JSONL store
- [ ] T041 Run all four `quickstart.md` smoke tests in sequence; confirm each passes; commit results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories**
- **Phase 3–8 (User Stories)**: All depend on Phase 2 completion; can proceed in priority order or in parallel
- **Phase 9 (Polish)**: Depends on all desired user stories complete

### User Story Dependencies

| Story | Can start after | Notes |
|---|---|---|
| US1 (P1) | Phase 2 | No story dependencies |
| US2 (P2) | US1 complete | `bye` tool depends on `say` state model being in place |
| US3 (P3) | Phase 2 | Independent of US1/US2 except needs records to test against |
| US4 (P4) | US1 + US2 complete | ghost-cli and random-house need both tools working |
| US5 (P5) | US1 complete | Verifies cluster computation already built in T010 |
| US6 (P6) | Phase 2 complete | Store interface defined in T009 |

### Within Each Phase

- Models/types before services
- Services before tools
- Tools before client wrappers
- Client wrappers before CLI and ghost house consumers

### Parallel Opportunities

- T005 + T006 (shared type additions — different files)
- T009 (JsonlStore) runs in parallel with T007 + T008 (Colyseus schema)
- T014 + T015 (go + traverse guards — different tools in same file, but same-file edits should be sequential)
- T016 (ts-client say) in parallel with T014/T015
- T025 + T026 (inbox tool + client wrapper)
- T029 + T030 + T031 (ghost-cli UI components — different files)
- T039 + T040 (docs updates — different files)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Can run concurrently:
Task T007: "Add ghostModes to room-schema.ts"       # server/colyseus/src/room-schema.ts
Task T009: "Implement JsonlStore in store.ts"        # server/conversation/src/store.ts

# Then sequentially:
Task T008: "Add setGhostMode/getGhostMode to MatrixRoom"  # depends on T007
Task T010: "Implement ConversationService"               # depends on T007, T008, T009
Task T011: "Export from index.ts"                        # depends on T010
Task T012: "Wire into server/src/index.ts"              # depends on T011
```

## Parallel Example: Phase 6 (US4)

```bash
# Can run concurrently once Phase 2 + US1 + US2 are done:
Task T025: "Add inbox tool to mcp-server.ts"
Task T026: "Add inbox() to ts-client/src/client.ts"

# Then concurrently:
Task T029: "StatusStrip conversational indicator"    # ghosts/ghost-cli/src/repl/StatusStrip.tsx
Task T030: "LogPanel message.new entries"            # ghosts/ghost-cli/src/repl/LogPanel.tsx
Task T031: "One-shot say/bye handlers"               # ghosts/ghost-cli/src/oneshot/commands.ts
Task T033: "Debug panel ghostModes column"           # client/phaser/src/spectatorDebug.ts
Task T034: "random-house conversation loop"          # ghosts/random-house/src/index.ts
```

---

## Implementation Strategy

### MVP (US1 only — Phases 1–3)

1. Phase 1: Accept proposals, scaffold package, add shared types
2. Phase 2: Colyseus schema + ConversationService + server wiring
3. Phase 3: `say` tool + movement guard + ts-client wrapper
4. **STOP and VALIDATE**: `ghost-cli say "hello"` persists record, `go` is rejected ✓

### Incremental Delivery

1. Phases 1–3 → `say` works, movement blocked (MVP)
2. Phase 4 → `bye` works, full round-trip (US1 + US2)
3. Phase 5 → HTTP store access (US3)
4. Phase 6 → ghost-cli + random-house + debug panel (US4)
5. Phases 7–9 → Verification + extensibility + polish

---

## Notes

- T001 and T002 (proposal status updates) require human review of RFC-0005 and ADR-0003 before marking complete
- T021 (JWT ghostHouseId check) may be a no-op if already present, or may require a registry change — investigate before starting Phase 5
- `[P]` = different files, no incomplete dependencies; safe to run in parallel
- `[USn]` = maps task to spec user story for traceability
- Commit after each phase checkpoint at minimum
