# Tasks: Group Formation and Group Chat

**Input**: Design documents from `specs/023-group-formation/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Unit tests ship in same change (constitution requirement). Integration tests planned in same change; may land separately if Neo4j unavailable in CI.

**Organization**: Tasks grouped by user story. US1 (group formation) is the sole MVP increment — all others depend on it being in place.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no cross-dependencies)
- **[Story]**: User story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New types, error types, and Neo4j schema initialization — prerequisites for all stories.

- [x] T001 Add `group.ts` to `shared/types/src/` with GroupId, AdmissionOffer, AdmissionVote, VoteWindow, GroupSummary, GroupMessage types per `specs/023-group-formation/data-model.md`
- [x] T002 Re-export group types from `shared/types/src/index.ts`
- [x] T003 Create `server/world-api/src/group-errors.ts` with all Data.TaggedError types: GroupNotFound, GroupDissolved, GroupNotMember, GroupNotParticipant, GroupNotMemberOrParticipant, GroupAntesMismatch, GroupOfferNotFound, GroupOfferExpired, GroupPersistenceError, GroupChatStoreError
- [x] T004 Add `unique-names-generator` dependency to `server/world-api/package.json`
- [x] T005 Add `(:Group)` uniqueness constraint to `server/world-api/src/neo4j-graph-init.ts` (`CREATE CONSTRAINT group_id_unique IF NOT EXISTS FOR (g:Group) REQUIRE g.group_id IS UNIQUE`)
- [x] T006 Link this work to RFC-0024 in `proposals/rfc/0024-group-formation-and-chat.md` — update status from `draft` to `accepted`

**Checkpoint**: Types compile, errors compile, Neo4j constraint wired — story implementation can begin.

---

## Phase 2: Foundational (GroupService Interface + In-Memory Implementation)

**Purpose**: `GroupService` Context.Tag and `GroupServiceInMemory` are blocking prerequisites for all story phases. Unit tests live here.

**⚠️ CRITICAL**: No user story phase can be completed until this phase is done.

- [x] T007 Create `server/world-api/src/GroupService.ts` — define `GroupServiceOps` interface and `GroupService` Context.Tag per `specs/023-group-formation/contracts/ic-group-service.md`
- [x] T008 Create `server/world-api/src/GroupServiceInMemory.ts` — in-memory Layer implementation of all `GroupServiceOps` methods; handles `GroupRecord` and `VoteWindow` in-memory state; no Neo4j dependency
- [x] T009 Create `server/world-api/test/GroupService.test.ts` — unit tests against `GroupServiceInMemory` covering:
  - `createGroup` — happy path; both MEMBER_OF edges created; group bag ActorId assigned
  - `proposeJoin` — vote window opened; system message queued
  - `proposeJoin` — duplicate offer rejected (FR-013)
  - `vote` — accept tips to majority; `admitMember` triggered
  - `vote` — reject tips to majority; offer cancelled
  - `resolveExpiredOffers` — expired window with no votes → offer cancelled
  - `leave` — resources returned; MEMBER_OF edge removed
  - `leave` — last member triggers dissolution
  - `groupSay` — message stored; mx_listeners = members + participants
  - `addParticipant` / `removeParticipant`
  - `listMemberships` — correct summary returned
- [x] T010 Export `GroupService` and group errors from `server/world-api/src/index.ts`
- [x] T011 Add group errors to `HttpMappingError` union in `server/src/errors.ts` with appropriate HTTP status codes (404 for GroupNotFound/GroupDissolved, 403 for GroupNotMember/GroupNotMemberOrParticipant, 409 for GroupOfferExpired/GroupAntesMismatch)

**Checkpoint**: `pnpm test` in `server/world-api` passes all GroupService unit tests.

---

## Phase 3: User Story 1 — Two Ghosts Form a Group (Priority: P1) 🎯 MVP

**Goal**: Two co-located ghosts can exchange a `group.offer`, and upon acceptance a named group actor is created with both as members, a group bag holding their combined stake, and a group chat thread initialized.

**Independent Test**: `ghost_A` and `ghost_B` on same tile; `ghost_A` issues `group.offer to=ghost_B resource=trust amount=10`; `ghost_B` accepts; verify (:Group) node exists in Neo4j, both MEMBER_OF edges present, `{group_id}.jsonl` exists, `group.list` returns the group for both ghosts.

- [x] T012 [US1] Extend `ProposeParams` in `server/world-api/src/ProposalService.ts` with optional `shared: true` flag; add `GroupFormationTarget` type (ghost or existing group)
- [x] T013 [US1] Implement the `shared` formation path in `ProposalService.agree()`: when `shared=true`, after ledger commit, call `GroupService.createGroup()` to mint the (:Group) node, MEMBER_OF edges, group bag (ActorId = `"group:{group_id}"`), and initialize the JSONL thread via `JsonlStore`. **FR-011**: validate that `give.resource === receive.resource` when `shared=true` in `ProposalService.propose()` and return `LedgerMonotonicTradeRejected` (or a new `GroupResourceMismatch` error) if they differ.
- [x] T014 [US1] Add the `group.offer` MCP tool handler in `server/world-api/src/mcp-server.ts` per `specs/023-group-formation/contracts/ic-mcp-group-tools.md` — routes to `ProposalService.propose({ shared: true })` for ghost-to-ghost formation; enforces proximity via existing `getGhostCell` check; returns a clear error message if resource types do not match (`"Both sides must offer the same resource type to form a group"`)
- [x] T015 [US1] Add the `group.list` MCP tool handler in `server/world-api/src/mcp-server.ts` — calls `GroupService.listMemberships(ghostId)`
- [x] T016 [US1] Implement `GroupServiceLive.createGroup()` in `server/world-api/src/GroupServiceLive.ts` (new file) — Neo4j-backed: write (:Group) node, MEMBER_OF edges, (:Group)-[:OWNS]->(:Bag); load into in-memory GroupRecord; initialize JSONL thread file
- [x] T017 [US1] Implement `GroupServiceLive.listMemberships()` — query MEMBER_OF edges for ghostId from Neo4j; return GroupSummary[]
- [x] T018 [P] [US1] Create `server/world-api/test/GroupService.integration.test.ts` — integration tests for `GroupServiceLive.createGroup` and `listMemberships`; skipped when `NEO4J_URI` unset
- [x] T019 [US1] Smoke-test the formation flow per `specs/023-group-formation/quickstart.md` §"Smoke Test: Form a Group"; confirm `group.list` output and JSONL file creation

**Checkpoint**: Two ghosts can form a group end-to-end. `group.list` returns the group. JSONL thread file exists. Unit tests pass. Proceed to US2/US3 in parallel or sequentially.

---

## Phase 4: User Story 2 — Ghost Joins an Existing Group (Priority: P2)

**Goal**: A third ghost submits a join offer to an existing group; current members vote; majority accept admits the newcomer.

**Independent Test**: Two-member group exists; `ghost_C` issues `group.offer to=<group_id>`; `ghost_A` votes accept; verify ghost_C has MEMBER_OF edge and can post to group chat.

- [ ] T020 [US2] Implement `GroupService.proposeJoin()` in `GroupServiceInMemory` (already required by T008) — also implement in `GroupServiceLive`: write VoteWindow to memory, post system message to group JSONL thread, fan-out system notification via WorldBridgeService
- [ ] T021 [US2] Implement `GroupService.vote()` in `GroupServiceLive` — record vote, check majority, call `admitMember()` or `rejectOffer()` when threshold reached
- [ ] T022 [US2] Implement `GroupService.resolveExpiredOffers()` in `GroupServiceLive` — resolves vote windows past expiry by majority-of-voters rule
- [ ] T022b [US2] Wire `GroupService.resolveExpiredOffers()` into a background fiber in `GroupServiceLive` layer initialization in `server/world-api/src/GroupServiceLive.ts` using `Effect.repeat(Schedule.fixed(Duration.seconds(30)))` inside a `Layer.scopedDiscard` so the fiber is cancelled when the layer scope closes
- [ ] T023 [US2] Extend `group.offer` MCP tool to handle `to = group_id` (join path) — validate amount matches per-member ante (FR-011 via GroupAntesMismatch), call `GroupService.proposeJoin()`
- [ ] T024 [US2] Add `group.vote` MCP tool handler in `server/world-api/src/mcp-server.ts` — calls `GroupService.vote()`; returns resolved/pending/rejected outcome text per IC-003
- [ ] T025 [P] [US2] Add integration tests for `proposeJoin`, `vote`, and `resolveExpiredOffers` to `server/world-api/test/GroupService.integration.test.ts`
- [ ] T026 [US2] Smoke-test the join flow per `specs/023-group-formation/quickstart.md` §"Smoke Test: Join an Existing Group"

**Checkpoint**: Full admission vote lifecycle works. Duplicate offer rejection (FR-013) covered by T009.

---

## Phase 5: User Story 3 — Ghost Leaves a Group (Priority: P3)

**Goal**: Any member can leave voluntarily and recover contributed resources. Last member triggers dissolution.

**Independent Test**: Member issues `group.leave`; verify resources returned to bag, MEMBER_OF edge removed. Last-member leave marks (:Group) with `dissolved_at`.

- [ ] T027 [US3] Implement `GroupServiceLive.leave()` — commit leave ledger transaction (`cause: "group.leave"`, transfers contribution from group bag back to ghost bag); remove MEMBER_OF edge in Neo4j; update in-memory GroupRecord; if last member, call `dissolveGroup()`
- [ ] T028 [US3] Implement `GroupServiceLive.dissolveGroup()` — set `dissolved_at` on (:Group) node; retain node as tombstone (do not delete)
- [ ] T029 [US3] Add `group.leave` MCP tool handler in `server/world-api/src/mcp-server.ts` — calls `GroupService.leave()`; returns resource return amount and dissolution status per IC-003
- [ ] T030 [P] [US3] Add integration tests for `leave` and dissolution to `server/world-api/test/GroupService.integration.test.ts`
- [ ] T031 [US3] Smoke-test leave flow per `specs/023-group-formation/quickstart.md` §"Smoke Test: Leave"

**Checkpoint**: Leave + dissolution works end-to-end. Tombstone retained in graph.

---

## Phase 6: User Story 4 — Group Chat (Priority: P2)

**Goal**: Members and participants can exchange messages on the group thread at any time, regardless of map position. Non-member participants can be added and removed.

**Independent Test**: Two members on different tiles both issue `group.say`; each receives the other's message via inbox notification with `thread_id = group_id`. Add a non-member participant; verify they receive messages and can post.

- [ ] T032 [US4] Implement `GroupServiceLive.groupSay()` — append GroupMessageRecord to `{group_id}.jsonl` via `JsonlStore`; fan-out `message.new` Colyseus signal to all current members + participants via `WorldBridgeService.notifyGhost()` per IC-002; no location check, no conversational mode change
- [ ] T033 [US4] Add `group.say` MCP tool handler in `server/world-api/src/mcp-server.ts` — calls `GroupService.groupSay()`; uses `WorldBridgeService.getGhostCell()` for sender tile (best-effort, empty string if unavailable)
- [ ] T034 [P] [US4] Implement `GroupServiceLive.addParticipant()` and `removeParticipant()` — write/remove PARTICIPANT_IN edges in Neo4j; update in-memory GroupRecord.participants
- [ ] T035 [P] [US4] Add `group.add_participant` and `group.remove_participant` MCP tool handlers in `server/world-api/src/mcp-server.ts` per IC-003 schemas (see below); tool names are canonical — document in `specs/023-group-formation/contracts/ic-mcp-group-tools.md` before implementing:
  - `group.add_participant { group_id, actor_id, role }` — caller must be a member
  - `group.remove_participant { group_id, actor_id }` — caller must be a member
- [ ] T036 [US4] Confirm that the `inbox` MCP tool in `server/world-api/src/mcp-server.ts` returns group-thread `{ thread_id, message_id }` entries without changes — verify by running the group.say smoke test and checking that inbox output contains entries with `thread_id = group_id`; if the inbox handler filters by ghost-owned threads, patch it to pass through any thread_id opaquely
- [ ] T037 [P] [US4] Add integration tests for `groupSay`, `addParticipant`, `removeParticipant` to `server/world-api/test/GroupService.integration.test.ts`
- [ ] T038 [US4] Smoke-test group chat per `specs/023-group-formation/quickstart.md` §step 4

**Checkpoint**: Group chat works across distance. Participant add/remove works. Inbox delivers group-thread notifications.

---

## Phase 7: Random-Agent Group Participation

**Goal**: Upgrade `@aie-matrix/random-agent` to randomly exercise all five group MCP tools so that group mechanics are exercised in every multi-ghost deployment without manual intervention.

**Independent Test**: Deploy two random-agent instances; wait 2–3 minutes; verify at least one (:Group) node appears in Neo4j and at least one `{group_id}.jsonl` file exists. Check random-agent logs for `random-agent.group.*` events.

**Depends on**: Phase 3 (US1) complete — group.offer, group.list must be implemented and deployed.

- [ ] T047 [P] Add in-memory group state tracking to `ghosts/random-agent/src/executor.ts`: a `knownGroupIds: Set<string>` per ghost (alongside `pendingProposals`) to track groups the ghost belongs to; populate by calling `group.list` on startup and after any group event
- [ ] T048 [US1] Add `group.list` call branch to `tryAction()` in `ghosts/random-agent/src/executor.ts` — 5% probability when `knownGroupIds` is empty or stale (check at most once per 10 ticks); cache returned group IDs in `knownGroupIds`
- [ ] T049 [US1] Add `group.offer` branch to `tryAction()` — 5% probability when an occupant is present and `knownGroupIds.size === 0` (ghost not yet in a group); call `group.offer { to: occupant, resource: "gold", amount: 1, expires_in: 120 }` and store returned `offerId` in `pendingProposals` (reuse existing array); log `random-agent.group.offer`
- [ ] T050 [US2] Add inbox-polling + `group.vote` branch — when `world.message.new` arrives with a group-thread `thread_id`, call `group.vote { group_id, offer_id, decision: "accept" }` with 80% probability (20% reject); extract `offer_id` from the system message content using a simple regex; log `random-agent.group.vote`
- [ ] T051 [US3] Add `group.leave` branch to `tryAction()` — 1% probability per tick when `knownGroupIds.size > 0`; pick a random group ID and call `group.leave { group_id }`; remove from `knownGroupIds` on success; log `random-agent.group.leave`

**Note on `group.say`**: Random agent intentionally omits `group.say` — it has nothing meaningful to say. Adding noisy automated group messages would pollute the chat log for human observers. Add only if explicitly needed for demo purposes.

**Checkpoint**: Two random-agent instances eventually form a group, the first vote-invited member accepts, and at least one voluntary leave occurs over a 5-minute run. All events logged with `random-agent.group.*` kind.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T039 [P] Update `docs/architecture.md` — document Group as a new disembodied world actor type; document group chat as a second fan-out target model alongside proximity chat
- [ ] T040 [P] Add formal addendum note to `proposals/rfc/0023-in-world-resource-ledger.md` documenting the `shared` transaction variant (causes `"group.form"`, `"group.join"`, `"group.leave"`) per IC-001
- [ ] T041 [P] Update `server/world-api/README.md` — document `GroupService`, new MCP tools, environment requirements
- [ ] T042 [P] Add group tool schemas to any ghost MCP tool reference documentation (ghost-ts-client README or equivalent)
- [ ] T043 Extend ghost TCK (`ghosts/tck/`) with group contract tests per IC-003: formation, admission, leave, group.say delivery, group.list — these are the acceptance tests for the full feature
- [ ] T044 Run `pnpm typecheck` across all affected packages; fix any type errors
- [ ] T045 Run `pnpm test` in `server/world-api` and confirm all GroupService unit tests pass
- [ ] T046 Verify `specs/023-group-formation/quickstart.md` end-to-end scenario against the running server (all 3 smoke tests pass)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately; tasks T001–T006 are all independent [P]
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all story phases
- **Phase 3–6 (Stories)**: All depend on Phase 2. US1 (Phase 3) must be complete before US2/US3/US4 — the group actor must exist before join, leave, or chat can work
- **Phase 7 (Random-Agent)**: Depends on Phase 3 (US1) — group.offer and group.list must be implemented
- **Phase 8 (Polish)**: Depends on all desired stories and Phase 7 being complete

### User Story Dependencies

- **US1 (P1)** — no other story dependency; start after Phase 2
- **US2 (P2)** — depends on US1 (group must exist to join)
- **US3 (P3)** — depends on US1 (group must exist to leave)
- **US4 (P2)** — depends on US1 (group must exist to chat); US3 can be parallelized with US4

### Parallel Opportunities Within Phase 1

```bash
# All Phase 1 tasks are file-independent — run all at once:
T001  # shared/types/src/group.ts
T002  # shared/types/src/index.ts
T003  # server/world-api/src/group-errors.ts
T004  # server/world-api/package.json
T005  # server/world-api/src/neo4j-graph-init.ts
T006  # proposals/rfc/0024-...
```

### Parallel Opportunities Within Phase 3 (US1)

```bash
# After T012/T013 (ProposalService extension), these can proceed in parallel:
T014  # mcp-server.ts group.offer tool
T015  # mcp-server.ts group.list tool
T016  # GroupServiceLive.createGroup
T017  # GroupServiceLive.listMemberships
T018  # integration test file
```

---

## Implementation Strategy

### MVP Scope (User Story 1 Only)

1. Complete Phase 1 (Setup) — all tasks parallelizable
2. Complete Phase 2 (Foundational) — unit tests gate this phase
3. Complete Phase 3 (US1) — group formation end-to-end
4. **STOP and VALIDATE**: run quickstart.md smoke test §"Smoke Test: Form a Group"
5. Demo / deploy

### Incremental Delivery

1. Setup + Foundational → foundation + unit tests green
2. US1 → group formation + group.list → **MVP demo**
3. US2 + US3 in parallel → join, vote, leave → full membership lifecycle
4. US4 → group chat → full RFC-0024 feature complete
5. Polish → docs, TCK, typecheck

### Notes on `GroupServiceLive`

`GroupServiceLive` can be introduced incrementally — stub all unimplemented methods with `Effect.fail(new GroupPersistenceError({ message: "not yet implemented" }))` and fill in method by method per story phase. `GroupServiceInMemory` carries unit tests throughout.
