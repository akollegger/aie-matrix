# Tasks: Intermedium — Human Spectator Client

**Input**: Design documents from `specs/011-intermedium-client/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅  
**Branch**: `011-intermedium-client`

**Tests**: No TDD approach requested. Each phase includes a smoke-test checkpoint per spec acceptance scenarios.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1–US4)
- Exact file paths included in all descriptions

---

## Phase 1: Setup & Repository Restructure

**Purpose**: Mechanical rename of `client/` → `clients/` and scaffold of the new `clients/intermedium/` Vite/React package. No UI work — safe to proceed before design review.

- [ ] T001 Rename `client/` to `clients/debugger/` at repo root (shell rename, no internal changes)
- [ ] T002 Update `pnpm-workspace.yaml` — change `"client/**"` glob to `"clients/**"`
- [ ] T003 [P] Create directory tree for `clients/intermedium/src/{hooks,components,layers,services,types}/`
- [ ] T004 Create `clients/intermedium/package.json` with React 18, deck.gl ≥ 9, h3-js, colyseus.js, @relateby/pattern dependencies
- [ ] T005 [P] Create `clients/intermedium/vite.config.ts` (React plugin, VITE_ env prefix)
- [ ] T006 [P] Create `clients/intermedium/tsconfig.json` (strict, browser target, path alias `@/` → `src/`)
- [ ] T007 [P] Create `clients/intermedium/index.html` (root mount point)
- [ ] T008 Add `@aie-matrix/shared-types` as a workspace dependency in `clients/intermedium/package.json`
- [ ] T009 Create `clients/intermedium/.env.example` with `VITE_COLYSEUS_URL`, `VITE_WORLD_API_URL`, `VITE_GHOST_HOUSE_URL`, `VITE_MAP_ID`, `VITE_DEV_GHOST_ID`

**Checkpoint**: `pnpm install` succeeds; `clients/debugger/` runs unchanged; `clients/intermedium/` builds an empty Vite app.

---

## Phase 2: UI Design Review ⚠️ GATE — blocks Phases 4–7

**Purpose**: Produce SVG design mockups for all visual layouts per FR-020. Implementation of SceneView, PanelView, and all scale-specific components is **blocked until the feature author approves these mockups**.

- [ ] T010 [P] Produce `specs/011-intermedium-client/mockups/01-map-scale.svg` — full-world wireframe hex grid (100:0 scene:panel, no sidebar, ghost point-cloud dots, tile hover tooltip)
- [ ] T011 [P] Produce `specs/011-intermedium-client/mockups/02-area-scale.svg` — 80:20 scene:panel split; browsable hex region; ghost identity cards in right panel
- [ ] T012 [P] Produce `specs/011-intermedium-client/mockups/03-neighbor-scale.svg` — 50:50 split; highlighted 7-hex cluster; lazy-follow viewport; proximity activity feed in panel
- [ ] T013 [P] Produce `specs/011-intermedium-client/mockups/04-partner-scale.svg` — 20:80 split; minimal ghost location status widget left; full conversation thread right; message input at bottom
- [ ] T014 [P] Produce `specs/011-intermedium-client/mockups/05-ghost-scale.svg` — 0:100 (no hex grid); structured interiority document (inventory, active quest, memory log) in full panel
- [ ] T015 [P] Produce `specs/011-intermedium-client/mockups/06-fail-whale.svg` — full-screen error state: point-cloud globe (wireframe sphere of dots, void background), animated breathing/rotation concept indicated in notes
- [ ] T016 Produce `specs/011-intermedium-client/mockups/00-scale-transitions.svg` — composite diagram showing all 5 scales as columns with scene:panel ratios and navigation arrows (double-click ↓, Escape ↑)
- [ ] T017 Commit all mockups to `specs/011-intermedium-client/mockups/` and request author approval — **UI component implementation (Phases 4–7) must not begin until approved**

**Checkpoint**: ⚠️ All 7 SVG files committed; author has approved design direction.

---

## Phase 3: Foundational Client Infrastructure

**Purpose**: Types, services, and app shell that all user story phases depend on. No visual output yet — these are the data and state layers.

**⚠️ CRITICAL**: No user story UI work can begin until this phase is complete.

- [ ] T018 Define `ViewState` type and `Scale` enum in `clients/intermedium/src/types/viewState.ts`
- [ ] T019 [P] Define `GhostPosition` interface in `clients/intermedium/src/types/ghostPosition.ts`
- [ ] T020 [P] Define `WorldTile`, `TileType` in `clients/intermedium/src/types/worldTile.ts`
- [ ] T021 [P] Define `ConversationMessage`, `ConversationThread`, `MessageSender` in `clients/intermedium/src/types/conversation.ts`
- [ ] T022 [P] Define `GhostIdentity`, `GhostInteriority`, `HumanPairing` in `clients/intermedium/src/types/ghost.ts`
- [ ] T023 Implement `ClientState` React context (assembles all data sources) in `clients/intermedium/src/context/ClientState.tsx`
- [ ] T024 Implement Colyseus singleton client in `clients/intermedium/src/services/colyseusClient.ts` — connect/disconnect, reconnect on drop (FR-021)
- [ ] T025 [P] Implement gram parser in `clients/intermedium/src/services/gramParser.ts` — parse `.map.gram` payload → `Map<string, WorldTile>` using `@relateby/pattern`
- [ ] T026 [P] Implement A2A client stub in `clients/intermedium/src/services/a2aClient.ts` — GET/POST `/conversation/:ghostId/messages`; returns `isAvailable: false` when endpoint absent (IC-002 gap)
- [ ] T072 Implement `useGhostIdentity` hook — fetch `GET /catalog` from ghost house at startup, return `Map<string, GhostIdentity>` keyed by ghostId; refresh on demand (IC-005 from spec-009) in `clients/intermedium/src/hooks/useGhostIdentity.ts`
- [ ] T073 Create `PanelView` container component in `clients/intermedium/src/components/PanelView/PanelView.tsx` — receives `viewState` and `pairing` as props; renders `null` at Map scale, `AreaPanel` at Area, `NeighborPanel` at Neighbor, `PartnerPanel` at Partner, `GhostPanel` at Ghost; applies the scene:panel ratio via CSS
- [ ] T027 Implement `PairingContext` in `clients/intermedium/src/context/PairingContext.tsx` — reads `?ghost=<ghostId>` URL param; null when absent (FR-013)
- [ ] T028 Implement `clients/intermedium/src/App.tsx` — root shell: wraps contexts, renders scale router stub (placeholder `<div>` per scale), no deck.gl yet
- [ ] T029 Implement `clients/intermedium/src/main.tsx` — React 18 root render, StrictMode

**Checkpoint**: `pnpm dev` starts; browser shows blank app shell; no console errors from context or service wiring.

---

## Phase 4: User Story 1 — Fleet Overview at Map Scale (P1) 🎯 MVP

**Goal**: A new attendee opens the intermedium and sees the hex world with live ghost positions within 3 seconds.

**Independent Test**: Open client with no pairing (`?ghost` absent); verify hex grid renders, ghost dots update live, tile hover shows type, zero-ghost overlay appears and clears, fail whale shows on map load failure.

- [ ] T030 [US1] Implement `useMapGram` hook — fetch `GET /maps/:mapId?format=gram`, auto-retry ×3 with 2s backoff, emit `tiles: Map<string, WorldTile>` or `error` (SC-004, FR-006) in `clients/intermedium/src/hooks/useMapGram.ts`
- [ ] T031 [US1] Implement `useColyseus` hook — subscribe to `ghostTiles` patches, emit `ghosts: Map<string, GhostPosition>` (preserving `previousH3Index` from the prior value on each update), surface `connectionState` (FR-005) in `clients/intermedium/src/hooks/useColyseus.ts`
- [ ] T032 [P] [US1] Implement `hexGridLayer` factory — `H3HexagonLayer` wireframe, `filled: false`, coloured by `tileType` in `clients/intermedium/src/layers/hexGridLayer.ts`
- [ ] T033 [P] [US1] Implement `ghostPointCloudLayer` factory — `PointCloudLayer` per ghost at `h3.cellToLatLng()` centroid in `clients/intermedium/src/layers/ghostPointCloudLayer.ts`
- [ ] T034 [US1] Implement `SceneView` component (Map scale) — deck.gl `DeckGL` canvas with `hexGridLayer` + `ghostPointCloudLayer` in `clients/intermedium/src/components/SceneView/SceneView.tsx`
- [ ] T035 [US1] Implement tile hover tooltip in `clients/intermedium/src/components/SceneView/TileTooltip.tsx` — shows `tileType` on `onHover` event (US1 acceptance scenario 3)
- [ ] T036 [US1] Implement `GhostArrivalOverlay` component — renders "Awaiting ghost arrivals…" message when `ghosts.size === 0`, auto-hides on first ghost (FR-022) in `clients/intermedium/src/components/GhostArrivalOverlay.tsx`
- [ ] T037 [US1] Implement `FailWhale` component — full-screen PointCloudLayer sphere, rotation animation, breathing pulse animation, retry button (FR-023) in `clients/intermedium/src/components/FailWhale.tsx`
- [ ] T038 [US1] Implement `ReconnectingBanner` component — non-blocking banner shown when `connectionState === 'reconnecting'` (FR-021) in `clients/intermedium/src/components/ReconnectingBanner.tsx`
- [ ] T039 [US1] Wire Map scale in `clients/intermedium/src/App.tsx` — connect `useMapGram` + `useColyseus` → `SceneView`; show `FailWhale` on map error; show `ReconnectingBanner` on Colyseus drop
- [ ] T040 [US1] Smoke test per `quickstart.md` step 1–2: hex grid renders within 3s, ghost dots appear (SC-001, SC-003, SC-004)

**Checkpoint**: User Story 1 fully functional. Can demo the ghost world at Map scale independently.

---

## Phase 5: User Story 2 — Drill-Down Navigation (P1)

**Goal**: Attendee navigates from Map → Area → Neighbor using double-click; Escape returns one level. Viewport lazily follows focused ghost. Pan gestures work at Area/Neighbor.

**Independent Test**: Without pairing, double-click a tile cluster → Area, double-click a ghost → Neighbor, Escape back to each prior scale. Confirm viewport follows ghost movement and pan works.

- [ ] T041 [US2] Implement `useViewState` hook — `{ scale, focus }` state machine with `zoomIn(target)` and `zoomOut()` actions, keyboard listener for `Escape` (FR-014) in `clients/intermedium/src/hooks/useViewState.ts`
- [ ] T042 [P] [US2] Implement `tileIconLayer` factory — `IconLayer` for semantic tiles (vendor, session room, etc.) in `clients/intermedium/src/layers/tileIconLayer.ts`
- [ ] T043 [P] [US2] Implement `selectionLayer` factory — `H3HexagonLayer` stroke highlight for active ghost/cluster (FR-019) in `clients/intermedium/src/layers/selectionLayer.ts`
- [ ] T044 [US2] Implement `GhostCard` component — ghost name, class, current tile type in `clients/intermedium/src/components/GhostCard/GhostCard.tsx`
- [ ] T045 [US2] Implement `AreaPanel` — Area scale right panel (20% width); lists nearby ghost identity cards using `GhostCard` in `clients/intermedium/src/components/PanelView/AreaPanel.tsx`
- [ ] T046 [US2] Implement `NeighborPanel` — Neighbor scale right panel (50% width); proximity activity feed; appends paired-ghost thread stub if paired ghost in cluster in `clients/intermedium/src/components/PanelView/NeighborPanel.tsx`
- [ ] T047 [US2] Extend `SceneView` with Area scale — 80:20 split, pan gesture support, `tileIconLayer`, `onHover`/`onClick` for ghost double-click (FR-016)
- [ ] T048 [US2] Extend `SceneView` with Neighbor scale — 50:50 split, 7-hex cluster highlight via `selectionLayer`, lazy viewport follow centred on focused ghost (FR-015)
- [ ] T049 [US2] Add `Enter`-key zoom-in on focused tile/ghost (FR-014) in `useViewState.ts`
- [ ] T050 [US2] Mount `PanelView` in `clients/intermedium/src/App.tsx` — pass `viewState` and `pairing`; `PanelView` handles scale routing internally (T073); update App.tsx layout to apply scene:panel CSS split based on `viewState.scale`
- [ ] T051 [US2] Smoke test per `quickstart.md` step 3–5: Map → Area → Neighbor → back; ghost follow; pan (SC-002)

**Checkpoint**: User Stories 1 and 2 both functional. Full observability hierarchy demonstrable without pairing.

---

## Phase 6: User Story 3 — Paired Conversation at Partner Scale (P2)

**Goal**: A paired attendee reads and sends messages to their ghost at Partner scale (20:80). Partner/Ghost scale unavailable to unpaired attendees.

**Independent Test**: Append `?ghost=<id>` to URL; navigate to Partner scale; conversation stub ("unavailable") renders; message input present (disabled). With live ghost house endpoint: messages load and send.

- [ ] T052 [US3] Implement `useA2AConversation` hook — polls `GET /conversation/:ghostId/messages`; sets `isAvailable: false` on 404/error; optimistic append on send (IC-002, FR-011) in `clients/intermedium/src/hooks/useA2AConversation.ts`
- [ ] T053 [US3] Implement `MessageInput` component — text input + submit button; disabled with tooltip when `!isAvailable` (FR-010) in `clients/intermedium/src/components/ConversationThread/MessageInput.tsx`
- [ ] T054 [US3] Implement `ConversationThread` component — ordered `ConversationMessage` list; "conversation not yet available" placeholder when `!isAvailable` (FR-009, FR-011) in `clients/intermedium/src/components/ConversationThread/ConversationThread.tsx`
- [ ] T055 [US3] Implement `GhostStatusWidget` — minimal ambient widget showing ghost's current tile type and movement direction (derived from `previousH3Index` → `h3Index` bearing; "stationary" when absent) (FR-009) in `clients/intermedium/src/components/ConversationThread/GhostStatusWidget.tsx`
- [ ] T056 [US3] Implement `PartnerPanel` — 80% panel: `GhostStatusWidget` (top strip) + `ConversationThread` + `MessageInput` in `clients/intermedium/src/components/PanelView/PartnerPanel.tsx`
- [ ] T057 [US3] Implement pairing gate in `clients/intermedium/src/components/PairingGate.tsx` — blocks navigation to Partner/Ghost scale when `pairing === null`; renders clear unavailability message (FR-013)
- [ ] T058 [US3] Wire Partner scale into `App.tsx` — `PartnerPanel` at 20:80 split; `PairingGate` wrapping Partner/Ghost nav controls
- [ ] T059 [US3] Smoke test per `quickstart.md` "Paired Ghost Test": Partner scale renders with mock `?ghost=` token; conversation stub visible (SC-005)

**Checkpoint**: User Stories 1, 2, and 3 functional. Full companion experience demonstrable with a pairing token.

---

## Phase 7: User Story 4 — Ghost Interiority at Ghost Scale (P3)

**Goal**: A paired attendee views their ghost's inventory, active quest, and memory log at Ghost scale (0:100). Content is stubbed; `isAvailable: false` until IC-003 is resolved.

**Independent Test**: With `?ghost=<id>`, navigate Partner → Ghost scale; `GhostInteriority` renders placeholder sections for inventory, quest, memories; back control returns to Partner.

- [ ] T060 [P] [US4] Implement `InventoryList` stub — renders "loading…" placeholder (IC-003 gap) in `clients/intermedium/src/components/GhostInteriority/InventoryList.tsx`
- [ ] T061 [P] [US4] Implement `QuestSummary` stub — renders "loading…" placeholder in `clients/intermedium/src/components/GhostInteriority/QuestSummary.tsx`
- [ ] T062 [P] [US4] Implement `MemoryLog` stub — renders "loading…" placeholder in `clients/intermedium/src/components/GhostInteriority/MemoryLog.tsx`
- [ ] T063 [US4] Implement `GhostInteriority` container — assembles `InventoryList`, `QuestSummary`, `MemoryLog`; `isAvailable: false` state note inline (FR-012) in `clients/intermedium/src/components/GhostInteriority/GhostInteriority.tsx`
- [ ] T064 [US4] Implement `GhostPanel` — 100% panel: full-height `GhostInteriority`; no map; no message input (FR-012) in `clients/intermedium/src/components/PanelView/GhostPanel.tsx`
- [ ] T065 [US4] Wire Ghost scale into `App.tsx` — `GhostPanel` at 0:100; Escape returns to Partner scale (FR-014)

**Checkpoint**: All 4 user stories functional. Ghost scale renders placeholder interiority; navigation complete.

---

## Phase 8: Polish & Documentation

**Purpose**: Documentation updates, cross-cutting verification, and final smoke test.

- [ ] T066 [P] Update `docs/architecture.md` — add `clients/` directory structure diagram; add intermedium entry alongside debugger
- [ ] T067 [P] Update `docs/project-overview.md` — introduce intermedium as the primary conference attendee interface; describe its role relative to the debugger
- [ ] T068 [P] Update `clients/debugger/README.md` — note rename from `client/`; clarify developer-tool audience, not attendee interface
- [ ] T069 Create `clients/intermedium/README.md` — purpose, target audience (conference attendees + observability engineers), local run instructions, environment variables, smoke test steps
- [ ] T070 [P] Update `CONTRIBUTING.md` — replace all references to `client/` with `clients/`; add intermedium to the client inventory
- [ ] T071 Run full smoke test sequence from `quickstart.md`; verify all 6 acceptance scenarios across all 4 user stories; record results

**Checkpoint**: All documentation consistent; smoke test passes; feature ready for demo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Design Review)**: Depends on Phase 1 — GATE; **Phases 4–7 blocked until author approval**
- **Phase 3 (Foundational)**: Depends on Phase 1; can run **in parallel with Phase 2**
- **Phase 4 (US1)**: Depends on Phase 2 approval + Phase 3 completion
- **Phase 5 (US2)**: Depends on Phase 4 completion (builds on SceneView)
- **Phase 6 (US3)**: Depends on Phase 3 completion; can run in parallel with Phase 5
- **Phase 7 (US4)**: Depends on Phase 6 completion (Ghost scale builds on Partner)
- **Phase 8 (Polish)**: Depends on all desired user story phases

### User Story Dependencies

- **US1 (P1)**: No story dependencies — first vertical slice
- **US2 (P1)**: Extends SceneView from US1; sequential after US1
- **US3 (P2)**: Depends on pairing infrastructure from Phase 3; **can run in parallel with US2 once Phase 3 is complete**
- **US4 (P3)**: Depends on US3 (Ghost scale navigates from Partner scale)

### Parallel Opportunities Within Phases

```bash
# Phase 2 — all 7 mockup tasks in parallel:
T010, T011, T012, T013, T014, T015, T016 (concurrent)

# Phase 3 — types in parallel, then services:
T018, T019, T020, T021, T022 (concurrent)
T023 (depends on T018-T022)
T024, T025, T026 (concurrent after T018)

# Phase 4 — layers in parallel with hook work:
T032, T033 (concurrent with T030, T031)

# Phase 5 — layers and panels in parallel:
T042, T043, T044 (concurrent after T041)
T045, T046 (concurrent after T044)

# Phase 7 — stub components in parallel:
T060, T061, T062 (concurrent)
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3 + US1 only)

1. Complete Phase 1: Repository restructure
2. Design Review: Produce + approve mockups ← **pause here for author approval**
3. Complete Phase 3: Foundational infrastructure
4. Complete Phase 4 (US1): Map scale with live ghosts
5. **STOP and VALIDATE**: Demo hex world at Map scale — ghost positions live, fail whale, zero-ghost overlay
6. Ship if ready; continue to US2/US3/US4 incrementally

### Incremental Delivery

| After phase | Deliverable |
|-------------|-------------|
| Phase 1 | Debugger renamed; intermedium scaffolded |
| Phase 2 ✅ | Design approved → implementation unblocked |
| Phase 3 | App shell + data layer running |
| Phase 4 (US1) | **MVP**: hex world live at Map scale |
| Phase 5 (US2) | Full scale navigation (Map → Neighbor) |
| Phase 6 (US3) | Paired conversation at Partner scale |
| Phase 7 (US4) | Ghost interiority shell (stub) |
| Phase 8 | Docs clean; demo-ready |

---

## Summary

| Phase | Tasks | Story | Parallel opportunities |
|-------|-------|-------|----------------------|
| 1: Setup | T001–T009 (9) | — | T003, T005, T006, T007, T008, T009 |
| 2: Design Review | T010–T017 (8) | — | T010–T015 all parallel |
| 3: Foundational | T018–T029, T072, T073 (14) | — | T018–T022, T024–T026 |
| 4: US1 Map Scale | T030–T040 (11) | US1 | T032, T033 |
| 5: US2 Navigation | T041–T051 (11) | US2 | T042, T043, T044 |
| 6: US3 Conversation | T052–T059 (8) | US3 | — |
| 7: US4 Interiority | T060–T065 (6) | US4 | T060, T061, T062 |
| 8: Polish | T066–T071 (6) | — | T066, T067, T068, T070 |
| **Total** | **73** | | |
