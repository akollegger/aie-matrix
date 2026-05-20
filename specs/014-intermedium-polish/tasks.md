# Tasks: Intermedium Polish — Map, Chat, and Camera Stops

**Input**: Design documents from `specs/014-intermedium-polish/`
**Branch**: `014-intermedium-polish`
**All paths**: relative to `clients/intermedium/src/` unless stated otherwise

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no cross-task dependency)
- **[Story]**: US1=Global, US2=Regional, US3=Neighborhood Re-Evaluation, US4=Plan, US5=Room, US6=Situational, US7=Personal
- **Acceptance**: Each phase ends with a user review task. The phase is not complete until the user approves the experience.

---

## Phase 1: Setup

**Purpose**: Confirm the build baseline is clean.

- [X] T001 Verify TypeScript builds with zero errors: run `pnpm typecheck` from repo root and record current error count as baseline

**Checkpoint**: Baseline established.

---

## Phase 2: User Story 1 — Global Stop (P1)

**Goal**: First-time attendee sees the globe + venue marker and immediately knows how to advance.

**Story**: US1 — Understanding + Discoverability at Global stop  
**Independent Test**: Open cold; keyboard hint visible bottom-center; press `+`; hint disappears; stop advances to Regional.

- [X] T002 [US1] Create `components/NavHint.tsx`: position `absolute`, bottom-center, `pointer-events: none`; renders keyboard hint text (`+ / = zoom in · Esc back`); local `useState(false)` dismissed flag; registers `keydown` listener for `=`, `+`, `Escape` and sets dismissed on first press
- [X] T003 [US1] Wire `<NavHint visible={stop === "global" && !dismissed} />` into `App.tsx` inside the non-Personal branch, stacked above `PanelView`
- [X] T004 [US1] Smoke test: open client, verify hint text visible at Global stop; press `+`, verify hint gone and stop advances to Regional
- [X] T005 [US1] **User review**: present Global stop experience; phase complete on user approval

**Checkpoint**: Global stop approved by user.

---

## Phase 3: User Story 2 — Regional Stop (P1)

**Goal**: Confirm drill-in animation completes correctly and geographic context is legible.

**Story**: US2 — Understanding + Discoverability at Regional stop  
**Independent Test**: Navigate Global → Regional; drill-in runs automatically; venue marker (teal) and ≥2 SF landmark markers (amber) visible at drill completion.

*No code changes required — Regional rendering is already implemented (research R-003). This phase is verification-only.*

- [ ] T006 [US2] Smoke test: navigate Global → Regional; verify drill animation plays through all levels, venue marker and landmark markers render at drill end, `+` advances to Plan
- [ ] T007 [US2] **User review**: present Regional stop + the Regional → Plan venueZoom transition; phase complete on user approval

**Checkpoint**: Regional stop and Regional → Plan transition approved by user.

---

## Phase 4: User Story 3 — Neighborhood Re-Evaluation

**Goal**: Decide whether to add the Neighborhood stop based on the experienced Regional → Plan transition. The decision is made in this phase — no code is written before T008.

**Story**: US3 — Evaluate whether a discrete Neighborhood stop adds value beyond the existing venueZoom animation

**Key context**:
- The venueZoom animation (Regional → Plan) already provides automatic venue-scale orientation at 45° pitch
- Inserting `neighborhood` between `regional` and `plan` in `STOP_SEQUENCE` breaks `SceneView.tsx:234` (`prev === "regional" && viewState.stop === "plan"` venueZoom trigger)
- This phase starts only after Phase 3 user approval

- [ ] T008 [US3] **User decision**: review the Regional → Plan transition together; decide Outcome A (add Neighborhood stop) or Outcome B (venueZoom already satisfies the need, skip)

**If Outcome A (add Neighborhood)**:
- [ ] T009 [US3] Add `"neighborhood"` to `ExteriorStop` union in `types/viewState.ts` (surfaces all unhandled TypeScript cases)
- [ ] T010 [US3] [P] Insert `"neighborhood"` between `"regional"` and `"plan"` in `STOP_SEQUENCE`; add `|| stop === "neighborhood"` to `isExteriorStop` in `hooks/useViewState.ts`
- [ ] T011 [US3] [P] Add `neighborhood: 45` to `STOP_PITCH`; add `neighborhoodView(tiles, widthPx, heightPx)` function (fits R12 parent cell of first board H3 via `cellFitViewport`) in `utils/hexViewport.ts`
- [ ] T012 [US3] [P] Add `viewState.stop === "neighborhood"` to the no-panel guard in `components/PanelView/PanelView.tsx`
- [ ] T013 [US3] Fix venueZoom activation trigger in `components/SceneView/SceneView.tsx`: update the `prev === "regional" && stop === "plan"` guard to account for `neighborhood` as the new previous stop (e.g., `(prev === "regional" || prev === "neighborhood") && stop === "plan"`)
- [ ] T014 [US3] Add `neighborhood` case in `computeMapCamera` in `components/SceneView/SceneView.tsx`: call `neighborhoodView(tiles, w, h)` and return with `pitch: STOP_PITCH["neighborhood"]`, `bearing: 0`
- [ ] T015 [US3] Add `neighborhood` branch in the `layers` memo in `components/SceneView/SceneView.tsx`: return `buildRegionalEndLayers()` (same stable IDs as Regional end-state — pure camera move, no layer swap)
- [ ] T016 [US3] Run `pnpm typecheck` — zero new errors; fix any exhaustive-check gaps the type change exposes
- [ ] T017 [US3] Smoke test: navigate Global → Regional → Neighborhood → Plan; verify smooth camera transitions, Neighborhood shows board at ~45° pitch, no ghost markers, venueZoom still triggers at Plan arrival
- [ ] T018 [US3] **User review (Outcome A)**: present 7-stop arc; phase complete on user approval

**If Outcome B (skip Neighborhood)**:
- [ ] T019 [US3] Record decision in `specs/014-intermedium-polish/research.md` with rationale: venueZoom animation already provides venue-scale orientation; adding a manual gate disrupts cinematic flow

**Checkpoint**: Neighborhood decision made and either implemented + approved, or rationale documented.

---

## Phase 5: User Story 4 — Plan Stop (P1)

**Goal**: Ghost markers correctly placed on their tiles; no void-platter artifacts outside the map footprint.

**Story**: US4 — Understanding + Discoverability + Interaction at Plan stop  
**Independent Test**: With 5 active ghosts, Plan stop shows exactly 5 markers each within its tile; no stray wireframe cells outside map boundary at 1920×1080.

- [ ] T020 [US4] Confirm `layers/ghostPointCloudLayer.ts` uses `ScatterplotLayer` (already done — read the file and record confirmation; update `clients/intermedium/README.md` architecture section to replace "PointCloudLayer" with "ScatterplotLayer")
- [ ] T021 [US4] Fix `voidNeighborH3s()` in `utils/hexViewport.ts`: replace `gridDisk(centerH3, platterRadius)` body with K=1 edge-neighbor approach — iterate each tile in the tile set, collect `gridDisk(tile.h3Index, 1)` neighbors not in the tile set, return deduplicated array
- [ ] T022 [US4] Smoke test: open Plan stop on 1920×1080 viewport with active ghosts; verify ghost count matches backend, each marker on its tile, no wireframe outside tile footprint
- [ ] T023 [US4] **User review**: present Plan stop with ghost markers and map boundary; phase complete on user approval

**Checkpoint**: Plan stop approved by user.

---

## Phase 6: User Story 5 — Room Stop (P1)

**Goal**: Ghost identity panel visible immediately on arrival with no extra interaction.

**Story**: US5 — Understanding + Interaction at Room stop  
**Independent Test**: Double-click a tile near active ghosts at Plan; Room stop opens; `AreaPanel` shows ghost list immediately.

*No code changes required — `AreaPanel` renders unconditionally via `PanelView` at the Room stop (research R-004). Verification only.*

- [ ] T024 [US5] Smoke test: double-click a tile at Plan to enter Room; verify `AreaPanel` lists nearby ghosts without any additional click; double-click a ghost marker to advance to Situational
- [ ] T025 [US5] **User review**: present Room stop ghost identity experience; phase complete on user approval

**Checkpoint**: Room stop approved by user.

---

## Phase 7: User Story 6 — Situational Stop (P1)

**Goal**: Replace the placeholder stub with the actual last message from the paired ghost's conversation thread.

**Story**: US6 — Understanding + Discoverability at Situational stop  
**Independent Test**: With pairing configured and paired ghost in the 7-hex cluster, navigate to Situational; panel shows last message instead of "Conversation view unlocks at Partner scale" stub.

- [ ] T026 [US6] Update `components/PanelView/NeighborPanel.tsx`: add `useA2AConversation(pairedGhostId, worldApiUrl, humanId)` hook call gated on `pairedInCluster`; replace the stub section with last-message display (sender label + first 120 chars, ellipsis if truncated)
- [ ] T027 [US6] Smoke test: navigate to Situational with paired ghost in cluster; verify last message renders; verify section is absent when paired ghost is outside cluster
- [ ] T028 [US6] **User review**: present Situational stop with last-message preview; phase complete on user approval

**Checkpoint**: Situational stop approved by user.

---

## Phase 8: User Story 7 — Personal Stop (P1)

**Goal**: Conversation thread visible immediately on mount; input auto-focused; floating [C] panel shows stop-context note when off-stop.

**Story**: US7 — Understanding + Discoverability + Interaction at Personal stop  
**Independent Test**: Navigate to Personal with pairing; thread scrolled to bottom and input focused without any click; send a message; verify it appears; open [C] from Plan stop, verify redirect note.

- [ ] T029 [P] [US7] Add auto-scroll to bottom in `components/ConversationThread/ConversationThread.tsx`: add `bottomRef = useRef<HTMLDivElement>(null)` sentinel div after the message list; `useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages])`
- [ ] T030 [P] [US7] Add auto-focus on mount in `components/ConversationThread/MessageInput.tsx`: add `useEffect(() => { inputRef.current?.focus() }, [])` — fires once on mount; existing `inputRef` ref is already wired to the input element
- [ ] T031 [P] [US7] Add stop-context note in `components/ChatPanel/ChatPanel.tsx`: read `viewState.stop` via `useClientState()`; when `stop !== "personal"`, render dim informational banner "Full conversation view at the Personal stop ( + / = to navigate)" below the panel header
- [ ] T032 [US7] Smoke test: navigate to Personal; verify thread at bottom + input focused on mount; send message; open [C] from Plan, verify banner; open [C] from Personal, verify no banner
- [ ] T033 [US7] **User review**: present Personal stop chat experience; phase complete on user approval

**Checkpoint**: Personal stop approved by user.

---

## Phase 9: Polish & Documentation

**Purpose**: Close RFC/spec superseded notes, verify full arc, update docs.

- [ ] T034 Update `proposals/rfc/0008-human-spectator-client.md` layer composition section: correct both `PointCloudLayer` references (lines ~140 and ~163) to `ScatterplotLayer`; update Neighborhood stop entry (line ~103) with Phase 4 re-evaluation outcome note
- [ ] T035 [P] Add superseded notes to `specs/011-intermedium-client/spec.md` for FR-002 (ghost rendering), FR-003 (stop count deferred to spec-014 re-evaluation), and FR-009 (chat panel primary surface)
- [ ] T036 [P] Verify `docs/architecture.md` and `docs/project-overview.md` are consistent with implemented stop model; update only if discrepancies are found
- [ ] T037 Run full navigation arc smoke test (all implemented stops, forward and backward); verify no visual pop, blank frame, or crash at any transition
- [ ] T038 Run `pnpm typecheck && pnpm run lint` from repo root; fix any issues

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
  └─ Phase 2 (Global — T002–T004 implement, T005 user approval)
       └─ Phase 3 (Regional — T006 verify, T007 user approval)
            └─ Phase 4 (Neighborhood Re-Evaluation — T008 decision gate)
                 ├─ [Outcome A] T009–T018 (implement + approve)
                 └─ [Outcome B] T019 (document rationale)
                      └─ Phase 5 (Plan — T020–T023)
                           └─ Phase 6 (Room — T024–T025)
                                └─ Phase 7 (Situational — T026–T028)
                                     └─ Phase 8 (Personal — T029–T033)
                                          └─ Phase 9 (Polish — T034–T038)
```

### Within-Phase Parallel Opportunities

**Phase 4 (Neighborhood, Outcome A)**: T010, T011, T012 can run in parallel (different files) — all depend on T009
**Phase 8 (Personal)**: T029, T030, T031 can run in parallel (different files) — all precede T032

---

## Parallel Example: Phase 4 Outcome A (Neighborhood)

```
# After T009 (type definition) lands:
Parallel batch:
  T010 — hooks/useViewState.ts (STOP_SEQUENCE + isExteriorStop)
  T011 — utils/hexViewport.ts (STOP_PITCH + neighborhoodView)
  T012 — components/PanelView/PanelView.tsx (no-panel guard)

Then sequential:
  T013 — SceneView.tsx venueZoom trigger fix
  T014 — SceneView.tsx computeMapCamera neighborhood case
  T015 — SceneView.tsx layers memo neighborhood branch
  T016 — pnpm typecheck
  T017 — smoke test
  T018 — user review
```

## Parallel Example: Phase 8 (Personal Stop)

```
Parallel batch:
  T029 — ConversationThread.tsx (auto-scroll)
  T030 — MessageInput.tsx (auto-focus)
  T031 — ChatPanel.tsx (redirect note)

Then sequential:
  T032 — smoke test
  T033 — user review
```

---

## Implementation Strategy

Phases are executed in camera-stop order. Each stop is reviewed and approved before the next begins. Neighborhood is the only stop where implementation is conditional.

### Stop Sequence

1. Phase 1: Setup baseline
2. Phase 2: Global hint → user approval
3. Phase 3: Regional verification → user approval
4. Phase 4: Neighborhood re-evaluation → decision → implementation if approved
5. Phase 5: Plan ghost markers → user approval
6. Phase 6: Room identity panel → user approval
7. Phase 7: Situational last message → user approval
8. Phase 8: Personal chat UX → user approval
9. Phase 9: Polish + documentation

---

## Notes

- Phases 3 and 6 are verification-only (Regional and Room already work). User review is still required.
- T020 (ghost rendering confirmation) is a read-and-document task — the ScatterplotLayer fix already landed in this branch.
- [P] tasks within a phase touch different files and have no shared state — safe to parallelize.
- User review tasks (T005, T007, T008, T018, T023, T025, T028, T033) are blocking — subsequent phases must not begin until approval is given.
