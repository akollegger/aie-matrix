# Tasks: Intermedium — Human Spectator Client

**Input**: Design documents from `specs/011-intermedium-client/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅  
**Branch**: `011-intermedium-client`

**Tests**: No TDD approach requested. Each phase includes a smoke-test checkpoint per spec acceptance scenarios.

---

## ⚠️ Design Revision — 2026-04-27

The five-scale navigation model was redesigned to a **seven-stop camera model** during implementation. See `plan.md` § "Revision: Camera Stop Model" for the full rationale.

**Impact on existing phases:**
- Phases 1–5 (all ✅): remain valid — the infrastructure and deck.gl scene are the foundation for the new interior stops.
- Phase 2 mockups (T010–T017 ✅): three new exterior-stop mockups and a revised transition diagram are needed — see **Phase 9** below.
- **Phase 6 (Partner scale) and Phase 7 (Ghost scale): preserved as history but superseded.** The Personal stop (Phases 11–12) implements the revised approach for paired conversation and ghost interiority.
- Phase 8 (Polish): extended by **Phase 13**.

New work starts at **Phase 9**.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1–US4)
- Exact file paths included in all descriptions

---

## Phase 1: Setup & Repository Restructure

**Purpose**: Mechanical rename of `client/` → `clients/` and scaffold of the new `clients/intermedium/` Vite/React package. No UI work — safe to proceed before design review.

- [X] T001 Rename `client/` to `clients/debugger/` at repo root (shell rename, no internal changes)
- [X] T002 Update `pnpm-workspace.yaml` — change `"client/**"` glob to `"clients/**"`
- [X] T003 [P] Create directory tree for `clients/intermedium/src/{hooks,components,layers,services,types}/`
- [X] T004 Create `clients/intermedium/package.json` with React 18, deck.gl ≥ 9, h3-js, colyseus.js, @relateby/pattern dependencies
- [X] T005 [P] Create `clients/intermedium/vite.config.ts` (React plugin, VITE_ env prefix)
- [X] T006 [P] Create `clients/intermedium/tsconfig.json` (strict, browser target, path alias `@/` → `src/`)
- [X] T007 [P] Create `clients/intermedium/index.html` (root mount point)
- [X] T008 Add `@aie-matrix/shared-types` as a workspace dependency in `clients/intermedium/package.json`
- [X] T009 Create `clients/intermedium/.env.example` with `VITE_COLYSEUS_URL`, `VITE_WORLD_API_URL`, `VITE_GHOST_HOUSE_URL`, `VITE_MAP_ID`, `VITE_DEV_GHOST_ID`

**Checkpoint**: `pnpm install` succeeds; `clients/debugger/` runs unchanged; `clients/intermedium/` builds an empty Vite app.

---

## Phase 2: UI Design Review ⚠️ GATE — blocks Phases 4–7

**Purpose**: Produce SVG design mockups for all visual layouts per FR-020. Implementation of SceneView, PanelView, and all scale-specific components is **blocked until the feature author approves these mockups**.

- [X] T010 [P] Produce `specs/011-intermedium-client/mockups/01-map-scale.svg` — Map = **world / fleet zoom** (densest grid), overhead; 100:0, tile hover
- [X] T011 [P] Produce `specs/011-intermedium-client/mockups/02-area-scale.svg` — **World grid + zoomed region grid** both visible; 80:20 overlay; cards
- [X] T012 [P] Produce `specs/011-intermedium-client/mockups/03-neighbor-scale.svg` — **World + 7-hex cluster** zoom; 50% overlay; lazy-follow
- [X] T013 [P] Produce `specs/011-intermedium-client/mockups/04-partner-scale.svg` — **Single H3 cell**, **high 3/4** camera, **3D** paired-ghost point cloud, floor hex updates on move; **no** mini-map strip; conversation overlay
- [X] T014 [P] Produce `specs/011-intermedium-client/mockups/05-ghost-scale.svg` — 0:100 (no hex); interiority (inventory, active **goal**, **memories**); copy is observability-first, not game-quest phrasing
- [X] T015 [P] Produce `specs/011-intermedium-client/mockups/06-fail-whale.svg` — full-screen error state: point-cloud globe (wireframe sphere of dots, void background), animated breathing/rotation concept indicated in notes
- [X] T016 Produce `specs/011-intermedium-client/mockups/00-scale-transitions.svg` — composite: **zoom ladder** + dual grid where applicable + Partner 3/4; navigation per spec
- [X] T017 Commit all mockups to `specs/011-intermedium-client/mockups/` and request author approval — **UI component implementation (Phases 4–7) must not begin until approved**

**Checkpoint**: ⚠️ All 7 SVG files committed; author has approved design direction.

---

## Phase 3: Foundational Client Infrastructure

**Purpose**: Types, services, and app shell that all user story phases depend on. No deck.gl scene or scale panels with real content yet — data/state layers, service stubs, and **placeholder** scale panels that later phases replace.

**⚠️ CRITICAL**: No user story UI work can begin until this phase is complete.

**Independent test**: `pnpm dev` in `clients/intermedium` starts; root mounts without errors; `PairingContext` reflects `?ghost=`; `ClientState` and service modules import cleanly (even if `ghosts`/`tiles` are empty); `PanelView` shows placeholders only; Colyseus service can `joinOrCreate` when server is up.

### Types (can run in parallel)

- [X] T018 Define `ViewState` type and `Scale` in `clients/intermedium/src/types/viewState.ts` — per `data-model.md` / FR-004 (`focus` null at `map`, region or ghost id otherwise)
- [X] T019 [P] Define `GhostPosition` in `clients/intermedium/src/types/ghostPosition.ts` — per `data-model.md`; include optional `previousH3Index` for movement hints (IC-001)
- [X] T020 [P] Define `WorldTile`, `TileType` in `clients/intermedium/src/types/worldTile.ts` — per `data-model.md`
- [X] T021 [P] Define `MessageSender`, `ConversationMessage`, and `ConversationThread` in `clients/intermedium/src/types/conversation.ts` — per `data-model.md` (includes `isAvailable` for MVP stub)
- [X] T022 [P] Define `GhostIdentity`, `HumanPairing`, and `GhostInteriority` plus nested `Goal` / `Memory` / `InventoryItem` in `clients/intermedium/src/types/ghost.ts` — per `data-model.md` and `contracts/ic-003-ghost-interiority-api.md`
- [X] T074 [P] Define `ProximityCluster` in `clients/intermedium/src/types/proximityCluster.ts` — per `data-model.md` (consumed in Phase 5, not at runtime yet)

### State and services

- [X] T023 Define `ClientState` interface in `clients/intermedium/src/types/clientState.ts` and implement `ClientStateProvider` in `clients/intermedium/src/context/ClientState.tsx` — shape per `data-model.md` (compose `viewState`, `ghosts`, `identities`, `tiles`, `thread`, `interiority`, `pairing`); start with null/empty maps where appropriate
- [X] T024 Implement `clients/intermedium/src/services/colyseusClient.ts` — singleton `colyseus.js` `Client`; `joinOrCreate("world_spectator")` per `contracts/ic-001-colyseus-ghost-positions.md`; export connect/disconnect helpers; on socket drop, surface reconnecting state and attempt resume without clearing last-known data (FR-021)
- [X] T025 [P] Implement `gramParser` in `clients/intermedium/src/services/gramParser.ts` — `Gram.validate` + tile extraction; parse HTTP `.map.gram` body to `Map<string, WorldTile>`; Vite uses `vite-plugin-wasm` + `vite-plugin-top-level-await` for `@relateby/pattern` WASM; consumer shape aligns with `specs/010-tmj-to-gram` (FR-006, IC-001 map topology)
- [X] T026 [P] Implement `a2aClient` in `clients/intermedium/src/services/a2aClient.ts` — typed `GET`/`POST` wrappers for `GET /conversation/:ghostId/messages` and `POST` send per `contracts/ic-002-a2a-conversation-subscription.md`; on `404` / network error return `{ isAvailable: false }` so UI can stub (FR-011)

### Shell: pairing, panel stubs, catalog hook, `PanelView`, `App`

- [X] T027 Implement `PairingContext` in `clients/intermedium/src/context/PairingContext.tsx` — read `?ghost=<ghostId>`; `HumanPairing | null` (FR-013)
- [X] T075 [P] Create `clients/intermedium/src/components/PanelView/AreaPanel.tsx`, `NeighborPanel.tsx`, `PartnerPanel.tsx`, `GhostPanel.tsx` — each exports a **minimal placeholder** (empty fragment or one-line "—" for devtools); Phases 5–7 **replace** with real components (same file paths)
- [X] T072 Implement `useGhostIdentity` in `clients/intermedium/src/hooks/useGhostIdentity.ts` — `GET` catalog from ghost house base URL; build `Map<string, GhostIdentity>`; refresh on demand; tolerate failure with empty map (per `data-model.md` / spec-009 `GET /catalog`)
- [X] T073 Create `clients/intermedium/src/components/PanelView/PanelView.tsx` — props: `viewState`, `pairing` (and any pass-throughs Phase 4+ need); at `map` render `null`; at `area`/`neighbor`/`partner`/`ghost` render corresponding stub from T075; layout is **overlays** only (no flex sidebar that shrinks the future deck.gl canvas; FR-003)
- [X] T028 Implement `clients/intermedium/src/App.tsx` — wrap `PairingContext` + `ClientStateProvider`; top-level `scale` switch with placeholder `<div data-scale=…>` (or `PanelView` with `viewState` fixed to `map` for Phase 3); **no** `DeckGL` yet
- [X] T029 Wire `clients/intermedium/src/main.tsx` — `createRoot` + `StrictMode`; import `index.css`

**Checkpoint**: `pnpm dev` starts; browser shows blank app shell; no console errors from context or service wiring; `PanelView` at mock `viewState` lists stub panels only.

---

## Phase 4: User Story 1 — Fleet Overview at Map Scale (P1) 🎯 MVP

**Goal**: A new attendee opens the intermedium and sees the hex world with live ghost positions within 3 seconds.

**Independent Test**: Open client with no pairing (`?ghost` absent); verify hex grid renders, ghost dots update live, tile hover shows type, zero-ghost overlay appears and clears, fail whale shows on map load failure.

- [X] T030 [US1] Implement `useMapGram` hook — fetch `GET /maps/:mapId?format=gram`, auto-retry ×3 with 2s backoff, emit `tiles: Map<string, WorldTile>` or `error` (SC-004, FR-006) in `clients/intermedium/src/hooks/useMapGram.ts`
- [X] T031 [US1] Implement `useColyseus` hook — subscribe to `ghostTiles` patches, emit `ghosts: Map<string, GhostPosition>` (preserving `previousH3Index` from the prior value on each update), surface `connectionState` (FR-005) in `clients/intermedium/src/hooks/useColyseus.ts`
- [X] T032 [P] [US1] Implement `hexGridLayer` factory — `H3HexagonLayer` wireframe, `filled: false`, coloured by `tileType` in `clients/intermedium/src/layers/hexGridLayer.ts`
- [X] T033 [P] [US1] Implement `ghostPointCloudLayer` factory — `PointCloudLayer` per ghost at `h3.cellToLatLng()` centroid in `clients/intermedium/src/layers/ghostPointCloudLayer.ts`
- [X] T034 [US1] Implement `SceneView` component (Map scale) — deck.gl `DeckGL` canvas with `hexGridLayer` + `ghostPointCloudLayer` in `clients/intermedium/src/components/SceneView/SceneView.tsx`
- [X] T035 [US1] Implement tile hover tooltip in `clients/intermedium/src/components/SceneView/TileTooltip.tsx` — shows `tileType` on `onHover` event (US1 acceptance scenario 3)
- [X] T036 [US1] Implement `GhostArrivalOverlay` component — renders "Awaiting ghost arrivals…" message when `ghosts.size === 0`, auto-hides on first ghost (FR-022) in `clients/intermedium/src/components/GhostArrivalOverlay.tsx`
- [X] T037 [US1] Implement `FailWhale` component — full-screen PointCloudLayer sphere, rotation animation, breathing pulse animation, retry button (FR-023) in `clients/intermedium/src/components/FailWhale.tsx`
- [X] T038 [US1] Implement `ReconnectingBanner` component — non-blocking banner shown when `connectionState === 'reconnecting'` (FR-021) in `clients/intermedium/src/components/ReconnectingBanner.tsx`
- [X] T039 [US1] Wire Map scale in `clients/intermedium/src/App.tsx` — connect `useMapGram` + `useColyseus` → `SceneView`; show `FailWhale` on map error; show `ReconnectingBanner` on Colyseus drop
- [X] T040 [US1] Smoke test per `quickstart.md` step 1–2: hex grid renders within 3s, ghost dots appear (SC-001, SC-003, SC-004) — `pnpm --filter @aie-matrix/intermedium typecheck` + `build` pass; manual run: `pnpm dev` in `clients/intermedium` with world-api + Colyseus

**Checkpoint**: User Story 1 fully functional. Can demo the ghost world at Map scale independently.

---

## Phase 5: User Story 2 — Drill-Down Navigation (P1)

**Goal**: Attendee navigates from Map → Area → Neighbor using double-click; Escape returns one level. Viewport lazily follows focused ghost. Pan gestures work at Area/Neighbor.

**Independent Test**: Without pairing, double-click a tile cluster → Area, double-click a ghost → Neighbor, Escape back to each prior scale. Confirm viewport follows ghost movement and pan works.

- [X] T041 [US2] Implement `useViewState` hook — `{ scale, focus }` state machine with `zoomIn(target)` and `zoomOut()` actions, keyboard listener for `Escape` (FR-014) in `clients/intermedium/src/hooks/useViewState.ts`
- [X] T042 [P] [US2] Implement `tileIconLayer` factory — `IconLayer` for semantic tiles (vendor, session room, etc.) in `clients/intermedium/src/layers/tileIconLayer.ts`
- [X] T043 [P] [US2] Implement `selectionLayer` factory — `H3HexagonLayer` stroke highlight for active ghost/cluster (FR-019) in `clients/intermedium/src/layers/selectionLayer.ts`
- [X] T044 [US2] Implement `GhostCard` component — ghost name, class, current tile type in `clients/intermedium/src/components/GhostCard/GhostCard.tsx`
- [X] T045 [US2] Implement `AreaPanel` — Area scale **overlay** (~20% width footprint on the right); lists nearby ghost identity cards using `GhostCard` in `clients/intermedium/src/components/PanelView/AreaPanel.tsx`
- [X] T046 [US2] Implement `NeighborPanel` — Neighbor scale **overlay** (~50% width); proximity activity feed; appends paired-ghost thread stub if paired ghost in cluster in `clients/intermedium/src/components/PanelView/NeighborPanel.tsx`
- [X] T047 [US2] Extend `SceneView` with Area scale — full-bleed world, **~80:20 overlay** footprint, pan gesture support, `tileIconLayer`, `onHover`/`onClick` for ghost double-click (FR-016, FR-003)
- [X] T048 [US2] Extend `SceneView` with Neighbor scale — full-bleed world, **~50:50 overlay** footprint, 7-hex cluster highlight via `selectionLayer`, lazy viewport follow centred on focused ghost (FR-015, FR-003)
- [X] T049 [US2] Add `Enter`-key zoom-in on focused tile/ghost (FR-014) in `useViewState.ts`
- [X] T050 [US2] Mount `PanelView` in `clients/intermedium/src/App.tsx` — pass `viewState` and `pairing`; `PanelView` handles scale routing internally (T073); full-viewport `SceneView` (or stack) with **overlays** for panels — not a resizable flex column layout for the world
- [X] T051 [US2] Smoke test per `quickstart.md` step 3–5: Map → Area → Neighbor → back; ghost follow; pan (SC-002) — typecheck + build; manual quickstart 3–5 with live server

**Checkpoint**: User Stories 1 and 2 both functional. Full observability hierarchy demonstrable without pairing.

---

## Phase 6: User Story 3 — Paired Conversation at Partner Scale (P2)

**Goal**: A paired attendee reads and sends messages to their ghost at Partner scale (20:80 **effective** overlay; full-bleed world underneath, no mini-map strip, FR-009). Partner/Ghost scale unavailable to unpaired attendees.

**Independent Test**: Append `?ghost=<id>` to URL; navigate to Partner scale; conversation stub ("unavailable") renders; message input present (disabled). With live ghost house endpoint: messages load and send.

- [ ] T052 [US3] Implement `useA2AConversation` hook — polls `GET /conversation/:ghostId/messages`; sets `isAvailable: false` on 404/error; optimistic append on send (IC-002, FR-011) in `clients/intermedium/src/hooks/useA2AConversation.ts`
- [ ] T053 [US3] Implement `MessageInput` component — text input + submit button; disabled with tooltip when `!isAvailable` (FR-010) in `clients/intermedium/src/components/ConversationThread/MessageInput.tsx`
- [ ] T054 [US3] Implement `ConversationThread` component — ordered `ConversationMessage` list; "conversation not yet available" placeholder when `!isAvailable` (FR-009, FR-011) in `clients/intermedium/src/components/ConversationThread/ConversationThread.tsx`
- [ ] T055 [US3] Implement `GhostStatusWidget` — minimal ambient widget showing ghost's current tile type and movement direction (derived from `previousH3Index` → `h3Index` bearing; "stationary" when absent) (FR-009) in `clients/intermedium/src/components/ConversationThread/GhostStatusWidget.tsx`
- [ ] T056 [US3] Implement `PartnerPanel` — **overlay** with ~80% width footprint: `GhostStatusWidget` (top) + `ConversationThread` + `MessageInput` in `clients/intermedium/src/components/PanelView/PartnerPanel.tsx` (no separate mini-map column; FR-009)
- [ ] T057 [US3] Implement pairing gate in `clients/intermedium/src/components/PairingGate.tsx` — blocks navigation to Partner/Ghost scale when `pairing === null`; renders clear unavailability message (FR-013)
- [ ] T058 [US3] Wire Partner scale into `App.tsx` — `PartnerPanel` at 20:80 split; `PairingGate` wrapping Partner/Ghost nav controls
- [ ] T059 [US3] Smoke test per `quickstart.md` "Paired Ghost Test": Partner scale renders with mock `?ghost=` token; conversation stub visible (SC-005)

**Checkpoint**: User Stories 1, 2, and 3 functional. Full companion experience demonstrable with a pairing token.

---

## Phase 7: User Story 4 — Ghost Interiority at Ghost Scale (P3)

**Goal**: A paired attendee views their ghost's inventory, active goal, and memories at Ghost scale (0:100). Content is stubbed; `isAvailable: false` until IC-003 is resolved. **Copy**: observability-first, not game-quest diction (see `spec.md` US4 / FR-012).

**Independent Test**: With `?ghost=<id>`, navigate Partner → Ghost scale; `GhostInteriority` renders placeholder sections for inventory, active goal, memories; back control returns to Partner.

- [ ] T060 [P] [US4] Implement `InventoryList` stub — renders "loading…" placeholder (IC-003 gap) in `clients/intermedium/src/components/GhostInteriority/InventoryList.tsx`
- [ ] T061 [P] [US4] Implement `GoalSummary` stub — renders "loading…" placeholder in `clients/intermedium/src/components/GhostInteriority/GoalSummary.tsx`
- [ ] T062 [P] [US4] Implement `Memories` stub — renders "loading…" placeholder in `clients/intermedium/src/components/GhostInteriority/Memories.tsx`
- [ ] T063 [US4] Implement `GhostInteriority` container — assembles `InventoryList`, `GoalSummary`, `Memories`; `isAvailable: false` state note inline (FR-012) in `clients/intermedium/src/components/GhostInteriority/GhostInteriority.tsx`
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

---

## Phase 9: Updated Stop Mockups ⚠️ GATE — blocks Phases 10–12

**Purpose**: Produce the three missing exterior-stop mockups and a revised stop-transition diagram reflecting the 7-stop model. The existing five interior-stop mockups (T010–T014) remain valid and are not replaced.

- [X] T076 [P] Produce `specs/011-intermedium-client/mockups/07-global-stop.pdf` — R0 globe wireframe; extruded board tiny in center; overhead 0°; no ghosts
- [X] T077 [P] Produce `specs/011-intermedium-client/mockups/08-regional-stop.pdf` — R4–R5; board visible as landmark rectangle; overhead 0°; no ghosts
- [X] T078 [P] Produce `specs/011-intermedium-client/mockups/09-neighborhood-stop.pdf` — R15; board fills frame at 45°; extruded; floor platter visible; no ghosts
- [X] T079 Produce `specs/011-intermedium-client/mockups/00-stop-transitions.pdf` — 7-stop ladder with exterior/interior split, pitch per stop, resolution per stop
- [X] T080 Author approved mockups 2026-04-27 with clarifications: Regional=R4–R5; Plan card label fix; Personal pitch=~80° deck.gl; Personal has single floor tile under ghost (FR-030)

**Checkpoint**: ✅ All stop mockups committed and approved. Phases 10–13 unblocked.

---

## Phase 10: Seven-Stop Navigation State Machine

**Purpose**: Extend the existing `useViewState` and `hexViewport` to support all seven stops, keyboard cycling, and pitch-aware camera placement. Builds on the `{ scale, focus }` foundation from T018/T041 without removing it.

- [X] T081 Extend `clients/intermedium/src/types/viewState.ts` — add `CameraStop` union type (`"global" | "regional" | "neighborhood" | "plan" | "room" | "situational" | "personal"`); extend `ViewState` to `{ stop: CameraStop; focus: string | null }` (FR-004 revised)
- [X] T082 Extend `useViewState` in `clients/intermedium/src/hooks/useViewState.ts` — implement 7-stop ordered sequence; zoom-in / zoom-out key cycling; `Personal` stop requires `pairing !== null`; preserve existing `Escape` and double-click behaviour (FR-014 revised)
- [X] T083 [P] Extend `clients/intermedium/src/utils/hexViewport.ts` — add pitch constant per stop (0° Global/Regional/Plan/Room; 45° Neighborhood/Situational); add `globalView`, `regionalView` viewport calculations (FR-027)
- [X] T084 [P] Update `ClientState.tsx` context — thread new `stop` type through; ensure `nav` actions expose `cycleTo(stop)` alongside existing `zoomInFrom…` helpers

**Checkpoint**: `useViewState` cycles through all 7 stops via keyboard; pitch values are correct per stop; type system enforces `CameraStop` throughout.

---

## Phase 11: Exterior Stops

**Purpose**: Render Global, Regional, and Neighborhood stops — extruded board, floor platter, no ghosts, pitch per stop. Builds on existing `hexGridLayer` and `SceneView`.

- [X] T085 Extend `clients/intermedium/src/layers/hexGridLayer.ts` — add `extruded: true` mode for exterior stops; keep existing flat mode for interior stops (FR-026)
- [X] T086 Extend `clients/intermedium/src/utils/h3region.ts` — improve `voidNeighborH3s` floor platter using `gridDisk` centred on map center with radius proportional to map size (replaces prototype approach; FR-026)
- [X] T087 Extend `SceneView` in `clients/intermedium/src/components/SceneView/SceneView.tsx` — add `global`, `regional`, `neighborhood` stop branches: extruded board layer, floor platter wireframe, no ghost layers; apply pitch from `hexViewport` per stop (FR-026, FR-027)
- [X] T088 [P] Implement LOD hard-cut logic in `SceneView` — extruded/flat determined by stop regime; timing delay deferred to Phase 12 (T089) (FR-028)

**Checkpoint**: All three exterior stops render correctly; extruded board visible at Global/Regional; 45° pitch and floor platter at Neighborhood; no ghosts shown.

---

## Phase 12: Animated Stop Transitions

**Purpose**: Smooth camera animation between all stops — simultaneous zoom + pitch + pan with easement curve; LOD hard cut at transition midpoint.

- [X] T089 Implement stop transition animator in `SceneView` — use `deck.gl` `LinearInterpolator` with `transitionProps: ['longitude','latitude','zoom','pitch']` and a cubic-in-out easing function; wire to stop changes from `useViewState` (FR-028)
- [X] T090 [P] Implement fade wrapper for deck.gl ↔ R3F renderer swap in `clients/intermedium/src/App.tsx` — CSS opacity transition: fade-out before `DeckGL` unmount, fade-in after `PersonalScene` mount; reverse on exit from Personal stop (FR-028, FR-029)
- [X] T091 Smoke test all 7 stop transitions: verify zoom + pitch animate simultaneously; LOD flip occurs at midpoint; no flash on Personal stop entry/exit

**Checkpoint**: All stop-to-stop transitions animate smoothly; deck.gl ↔ R3F swap is invisible behind the fade.

---

## Phase 13: Personal Stop (R3F) — replaces Phases 6 + 7

**Purpose**: Personal stop — the non-geospatial ghost-presence view. React Three Fiber scene for the ghost figure; conversation thread and ghost interiority in the panel overlay. Requires pairing (FR-013, FR-029).

- [X] T092 Add `@react-three/fiber` and `three` to `clients/intermedium/package.json`; verify build (ADR-0006)
- [X] T093 Implement `clients/intermedium/src/components/PersonalScene/PersonalScene.tsx` — R3F `Canvas`: dark void background, single flat floor tile under ghost (FR-030), ghost point-cloud figure (`Points`), ghost interiority annotation scaffold (inventory/goal/memories as floating labels), orbit disabled (ghost stays centred) (FR-029, FR-002, FR-030)
- [X] T094 [P] Implement `clients/intermedium/src/components/PanelView/PersonalPanel.tsx` — ~80% overlay: `GhostStatusWidget` (tile type + last move direction) + `ConversationThread` + `MessageInput` + `GhostInteriority` stub; no separate mini-map (FR-009)
- [X] T095 [P] Implement `useA2AConversation` hook in `clients/intermedium/src/hooks/useA2AConversation.ts` — polls `GET /conversation/:ghostId/messages`; `isAvailable: false` on 404/error; optimistic append on send (IC-002, FR-011)
- [X] T096 [P] Implement `ConversationThread` in `clients/intermedium/src/components/ConversationThread/ConversationThread.tsx` and `MessageInput` in `…/MessageInput.tsx` — ordered message list; disabled input with tooltip when `!isAvailable` (FR-010, FR-011)
- [X] T097 [P] Implement `GhostInteriority` annotation component in `clients/intermedium/src/components/PersonalScene/GhostInteriority.tsx` — three stubs (inventory, active goal, memories); `isAvailable: false` note; observability-first copy (FR-012); no game-quest phrasing
- [X] T098 Wire Personal stop in `clients/intermedium/src/App.tsx` — mount `PersonalScene` + `PersonalPanel` when `stop === "personal"`; `PairingGate` blocks navigation without pairing (FR-013)
- [X] T099 Smoke test Personal stop with mock `?ghost=`: R3F scene renders ghost figure; conversation stub visible; interiority stubs visible; back control returns to Situational

**Checkpoint**: All 4 revised user stories functional. Ghost world legible at all 7 stops.

---

## Phase 14: Extended Polish

**Purpose**: Documentation updates required by the camera stop redesign, beyond those already listed in Phase 8.

- [ ] T100 [P] Update `docs/architecture.md` — add React Three Fiber alongside deck.gl in the "Human spectator client" row (per RFC-0008, ADR-0006)
- [ ] T101 [P] Update `clients/intermedium/README.md` — document 7-stop model, exterior/interior distinction, two-renderer architecture (deck.gl + R3F)
- [ ] T102 Run complete 7-stop smoke test sequence — verify all stops, all transitions, conversation panel, interiority stubs; record results against spec acceptance scenarios

**Checkpoint**: All documentation consistent with 7-stop model; smoke test passes across all stops.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately ✅
- **Phase 2 (Design Review)**: Depends on Phase 1 — GATE ✅
- **Phase 3 (Foundational)**: Depends on Phase 1; parallel with Phase 2 ✅
- **Phase 4 (US1)**: Depends on Phase 2 approval + Phase 3 completion ✅
- **Phase 5 (US2)**: Depends on Phase 4 completion ✅
- **Phase 6 (US3)**: ~~Superseded by Phase 13~~ — preserved as history
- **Phase 7 (US4)**: ~~Superseded by Phase 13~~ — preserved as history
- **Phase 8 (Polish)**: Extended by Phase 14
- **Phase 9 (Updated Mockups)**: No code dependencies — GATE; **Phases 10–12 blocked until author approval**
- **Phase 10 (Seven-Stop State Machine)**: Depends on Phase 9 approval; builds on Phase 5
- **Phase 11 (Exterior Stops)**: Depends on Phase 10
- **Phase 12 (Animated Transitions)**: Depends on Phase 11
- **Phase 13 (Personal Stop)**: Depends on Phase 12; can run in parallel with Phase 11 for non-SceneView components
- **Phase 14 (Extended Polish)**: Depends on Phase 13

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
T018, T019, T020, T021, T022, T074 (concurrent)
T023 (depends on T018–T022, T074)
T024, T025, T026 (concurrent; T025/T026 can follow T021–T022 for import stability)
T075 (parallel with T024–T026; before T073)
T072, T073 (T073 after T075)
T028, T029 (after T023, T027, T072, T073)

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
3. Complete Phase 3: Foundational infrastructure (types, Colyseus, gram, A2A stub, `PanelView` with placeholders)
4. Complete Phase 4 (US1): Map scale with live ghosts
5. **STOP and VALIDATE**: Demo hex world at Map scale — ghost positions live, fail whale, zero-ghost overlay
6. Ship if ready; continue to US2/US3/US4 incrementally

### Incremental Delivery

| After phase | Deliverable |
|-------------|-------------|
| Phase 1 | Debugger renamed; intermedium scaffolded ✅ |
| Phase 2 ✅ | Interior-stop design approved → implementation unblocked ✅ |
| Phase 3 | App shell + data layer running ✅ |
| Phase 4 (US1) | **MVP**: hex world live at Plan stop ✅ |
| Phase 5 (US2) | Stop navigation (Plan → Room → Situational) ✅ |
| Phase 9 | Exterior-stop design approved → Phases 10–12 unblocked |
| Phase 10 | 7-stop state machine + pitch per stop |
| Phase 11 | Exterior stops live (Global → Neighborhood) |
| Phase 12 | All transitions animated |
| Phase 13 | Personal stop with R3F + conversation + interiority stubs |
| Phase 8 + 14 | Docs clean; all 7 stops demo-ready |

---

## Summary

| Phase | Tasks | Story | Parallel opportunities |
|-------|-------|-------|----------------------|
| 1: Setup ✅ | T001–T009 (9) | — | T003, T005–T009 |
| 2: Design Review ✅ | T010–T017 (8) | — | T010–T015 all parallel |
| 3: Foundational ✅ | T018–T029, T072–T075 (16) | — | T018–T022, T074, T024–T026, T075 |
| 4: US1 Plan Scale ✅ | T030–T040 (11) | US1 | T032, T033 |
| 5: US2 Navigation ✅ | T041–T051 (11) | US2 | T042–T044 |
| 6: US3 Conversation | T052–T059 (8) | ~~US3~~ | — superseded by Phase 13 |
| 7: US4 Interiority | T060–T065 (6) | ~~US4~~ | — superseded by Phase 13 |
| 8: Polish | T066–T071 (6) | — | T066–T068, T070 |
| 9: Updated Mockups | T076–T080 (5) | — | T076–T078 parallel |
| 10: 7-Stop State Machine | T081–T084 (4) | — | T083, T084 |
| 11: Exterior Stops | T085–T088 (4) | US1 ext. | — |
| 12: Animated Transitions | T089–T091 (3) | US2 ext. | — |
| 13: Personal Stop | T092–T099 (8) | US3+US4 | T094–T097 parallel |
| 14: Extended Polish | T100–T102 (3) | — | T100, T101 |
| **Total** | **102** | | |
