# Tasks: Intermedium Polish — Map, Chat, and Camera Stops

**Input**: Design documents from `specs/014-intermedium-polish/`
**Branch**: `014-intermedium-polish`
**All paths**: relative to `clients/intermedium/src/` unless stated otherwise

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no cross-task dependency)
- **[Story]**: US1=Global, US2=Regional, US3=Plan, US4=Room, US5=Situational, US6=Personal, US7=Neighborhood (P2)
- Navigation continuity (cross-cutting) is in the Foundational phase

---

## Phase 1: Setup

**Purpose**: Confirm the build baseline is clean before any type changes land.

- [ ] T001 Verify TypeScript builds with zero errors: run `pnpm typecheck` from repo root and record current error count as baseline

**Checkpoint**: Baseline established — type change in Phase 2 must not introduce regressions beyond the known set.

---

## Phase 2: Foundational — `neighborhood` Type & Navigation Continuity (IC-005)

**Purpose**: Add `"neighborhood"` to `CameraStop` and wire it into every file that enumerates stops. This is the widest change; TypeScript surfaces all unhandled cases. Completes the cross-cutting navigation continuity story by inserting the stop into the sequence.

**⚠️ CRITICAL**: T002 must complete before T003–T005. T006 gates all stop-specific phases.

- [ ] T002 Add `"neighborhood"` to `ExteriorStop` union in `types/viewState.ts` (makes TypeScript surface all unhandled cases)
- [ ] T003 [P] Insert `"neighborhood"` between `"regional"` and `"plan"` in `STOP_SEQUENCE`; add `|| stop === "neighborhood"` to `isExteriorStop` in `hooks/useViewState.ts`
- [ ] T004 [P] Add `neighborhood: 45` to `STOP_PITCH` map; add `neighborhoodView(tiles, widthPx, heightPx)` function (fits R12 parent cell of first board H3 via `cellFitViewport`) in `utils/hexViewport.ts`
- [ ] T005 [P] Add `viewState.stop === "neighborhood"` to the no-panel guard in `components/PanelView/PanelView.tsx`
- [ ] T006 Verify `pnpm typecheck` passes with zero new errors after T002–T005; fix any exhaustive-check gaps the type change exposes

**Checkpoint**: All seven stops are in the type system and sequence. Navigation Continuity user story is structurally satisfied — `Escape`/`-`/`+` traverses all seven stops with focus preserved.

---

## Phase 3: User Story 1 — Global Stop (P1) 🎯

**Goal**: First-time attendee sees the globe + venue marker within 3 seconds and immediately knows how to advance.

**Story**: US1 — Understanding + Discoverability at Global stop  
**Independent Test**: Open cold; keyboard hint visible bottom-center; press `+`; hint disappears; stop advances to Regional.

- [ ] T007 [US1] Create `components/NavHint.tsx`: position `absolute`, bottom-center, `pointer-events: none`; renders keyboard hint text (`+ zoom in · Esc back`); local `useState(false)` dismissed flag; registers `keydown` listener for `=`, `+`, `Escape` and sets dismissed on first press
- [ ] T008 [US1] Wire `<NavHint visible={stop === "global" && !dismissed} />` into `App.tsx` inside the non-Personal branch, stacked above `PanelView`
- [ ] T009 [US1] Smoke test per quickstart.md Phase 4: open client, verify hint text visible at Global; press `+`, verify hint gone and stop advances

**Checkpoint**: Global stop delivers orientation and discoverability without user documentation.

---

## Phase 4: User Story 2 — Regional Stop (P1)

**Goal**: Confirm the existing Regional drill-in animation completes correctly and geographic context is legible after the 7-stop type change lands.

**Story**: US2 — Understanding + Discoverability at Regional stop  
**Independent Test**: Navigate Global → Regional; drill-in runs automatically; venue marker (teal) and ≥2 SF landmark markers (amber) visible at drill completion.

- [ ] T010 [US2] Smoke test per quickstart.md Phase 2: cycle from Global to Regional; verify drill animation plays through all levels, venue marker and landmark markers render at drill end, `+` advances to Neighborhood (now the next stop after Phase 2 type change)

*No code changes required — Regional rendering is already implemented (research R-003). This phase is verification-only.*

**Checkpoint**: Regional stop unchanged and functional after type system update.

---

## Phase 5: User Story 7 — Neighborhood Stop (P2)

**Goal**: Add the missing 45°-pitch bridge stop between Regional and Plan so the seven-stop arc is fully navigable.

**Story**: US7 — Understanding + Discoverability at Neighborhood stop  
**Independent Test**: Navigate Global → Regional → Neighborhood → Plan; each transition is a smooth camera move; at Neighborhood the board fills ~70% of viewport at ~45° pitch; no ghost markers.

- [ ] T011 [US7] Add `neighborhood` case in `computeMapCamera` in `components/SceneView/SceneView.tsx`: call `neighborhoodView(tiles, w, h)` and return with `pitch: STOP_PITCH["neighborhood"]`, `bearing: 0`
- [ ] T012 [US7] Add `neighborhood` branch in the `layers` memo in `components/SceneView/SceneView.tsx`: return `buildRegionalEndLayers()` (same stable IDs as Regional end-state — pure camera move, no layer swap)
- [ ] T013 [US7] Smoke test per quickstart.md Phase 2: navigate all 7 stops in sequence; verify Neighborhood shows board at 45° pitch, no ghost markers, smooth camera transition in/out

**Checkpoint**: Seven-stop arc is fully navigable end-to-end. Neighborhood bridges Regional cinematics and Plan overview.

---

## Phase 6: User Story 3 — Plan Stop (P1)

**Goal**: Ghost markers are correctly placed on their tiles; no void-platter artifacts outside the map footprint.

**Story**: US3 — Understanding + Discoverability + Interaction at Plan stop  
**Independent Test**: With 5 active ghosts, Plan stop shows exactly 5 markers each within its tile; no stray wireframe cells outside map boundary at 1920×1080.

- [ ] T014 [US3] Confirm `layers/ghostPointCloudLayer.ts` uses `ScatterplotLayer` (already done — read the file and record confirmation; update `clients/intermedium/README.md` architecture section to replace "PointCloudLayer" with "ScatterplotLayer")
- [ ] T015 [US3] Fix `voidNeighborH3s()` in `utils/hexViewport.ts`: replace `gridDisk(centerH3, platterRadius)` body with K=1 edge-neighbor approach — iterate each tile in the tile set, collect `gridDisk(tile.h3Index, 1)` neighbors not in the tile set, return deduplicated array
- [ ] T016 [US3] Smoke test per quickstart.md Phase 6: open Plan stop on 1920×1080 viewport with active ghosts; verify ghost count matches backend, each marker on its tile, no wireframe outside tile footprint

**Checkpoint**: Plan stop is the accurate overview — ghost positions and map boundary both visually correct.

---

## Phase 7: User Story 4 — Room Stop (P1)

**Goal**: Confirm the Room stop's ghost identity panel is visible immediately on arrival with no extra interaction.

**Story**: US4 — Understanding + Interaction at Room stop  
**Independent Test**: Double-click a tile near active ghosts at Plan; Room stop opens; `AreaPanel` shows ghost list immediately.

- [ ] T017 [US4] Smoke test per quickstart.md Phase 3: double-click a tile at Plan to enter Room; verify `AreaPanel` lists nearby ghosts without any additional click; double-click a ghost marker to advance to Situational

*No code changes required — `AreaPanel` renders unconditionally via `PanelView` at the Room stop (research R-004). Verification only.*

**Checkpoint**: Room stop surfaces ghost identities without extra interaction.

---

## Phase 8: User Story 5 — Situational Stop (P1)

**Goal**: Replace the placeholder stub in the proximity panel with the actual last message from the paired ghost's conversation thread.

**Story**: US5 — Understanding + Discoverability at Situational stop  
**Independent Test**: With pairing configured and paired ghost in the 7-hex cluster, navigate to Situational; panel shows last message instead of "Conversation view unlocks at Partner scale" stub.

- [ ] T018 [US5] Update `components/PanelView/NeighborPanel.tsx`: add `useA2AConversation(pairedGhostId, worldApiUrl, humanId)` hook call gated on `pairedInCluster`; replace the stub section with last-message display (sender label + first 120 chars, ellipsis if truncated)
- [ ] T019 [US5] Smoke test per quickstart.md Phase 5: navigate to Situational with paired ghost in cluster; verify last message renders; verify section is absent when paired ghost is outside cluster

**Checkpoint**: Situational stop previews the conversation, bridging spatial exploration and the Personal companion experience.

---

## Phase 9: User Story 6 — Personal Stop (P1)

**Goal**: Conversation thread visible immediately on mount; input auto-focused; floating [C] panel redirects to Personal for full experience.

**Story**: US6 — Understanding + Discoverability + Interaction at Personal stop  
**Independent Test**: Navigate to Personal with pairing; thread scrolled to bottom and input focused without any click; send a message; verify it appears; open [C] from Plan stop, verify redirect note.

- [ ] T020 [P] [US6] Add auto-scroll to bottom in `components/ConversationThread/ConversationThread.tsx`: add `bottomRef = useRef<HTMLDivElement>(null)` sentinel div after the message list; `useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages])`
- [ ] T021 [P] [US6] Add auto-focus on mount in `components/ConversationThread/MessageInput.tsx`: add `useEffect(() => { inputRef.current?.focus() }, [])` — fires once on mount; existing `inputRef` ref is already wired to the input element
- [ ] T022 [P] [US6] Add stop-context note in `components/ChatPanel/ChatPanel.tsx`: read `viewState.stop` via `useClientState()`; when `stop !== "personal"`, render dim informational banner "Full conversation view at the Personal stop ( + / = to navigate)" below the panel header
- [ ] T023 [US6] Smoke test per quickstart.md Phase 3: navigate to Personal; verify thread at bottom + input focused on mount; send message; open [C] from Plan, verify banner; open [C] from Personal, verify no banner

**Checkpoint**: Personal stop is the primary conversation surface — no extra navigation or clicks needed to engage.

---

## Phase 10: Polish & Documentation

**Purpose**: Close RFC/spec superseded notes, verify full arc, update docs.

- [ ] T024 Update `proposals/rfc/0008-human-spectator-client.md` layer composition section: correct both `PointCloudLayer` references (lines ~140 and ~163) to `ScatterplotLayer`; add implementation note to the Neighborhood stop entry (line ~103) confirming it is now added in spec-014
- [ ] T025 [P] Add superseded notes to `specs/011-intermedium-client/spec.md` for FR-002 (ghost rendering), FR-003 (stop count), and FR-009 (chat panel primary surface)
- [ ] T026 [P] Verify `docs/architecture.md` and `docs/project-overview.md` are consistent with the implemented seven-stop model; update only if discrepancies are found
- [ ] T027 Run full 7-stop navigation arc smoke test per quickstart.md: Global → Regional → Neighborhood → Plan → Room → Situational → Personal; forward and backward; verify no visual pop, blank frame, or crash at any transition
- [ ] T028 Run `pnpm typecheck && pnpm run lint` from repo root; fix any issues

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
  └─ Phase 2 (Foundational — T002 first, then T003–T005 in parallel, then T006)
       ├─ Phase 3 (Global — US1, P1) ← can start after T006
       ├─ Phase 4 (Regional — US2, P1) ← can start after T006
       ├─ Phase 5 (Neighborhood — US7, P2) ← can start after T006
       ├─ Phase 6 (Plan — US3, P1) ← can start after T006
       ├─ Phase 7 (Room — US4, P1) ← can start after T006
       ├─ Phase 8 (Situational — US5, P1) ← can start after T006
       └─ Phase 9 (Personal — US6, P1) ← can start after T006
            └─ Phase 10 (Polish) ← after all desired stories complete
```

### User Story Dependencies

All user stories (Phases 3–9) depend only on Foundational (Phase 2) completing. No story depends on another story — each is independently testable.

- **US1 Global (Phase 3)**: Independent after Phase 2
- **US2 Regional (Phase 4)**: Independent after Phase 2 — verification only, no code changes
- **US7 Neighborhood (Phase 5)**: Independent after Phase 2 — adds camera + layer case in SceneView
- **US3 Plan (Phase 6)**: Independent after Phase 2 — ScatterplotLayer already done; void platter fix only
- **US4 Room (Phase 7)**: Independent after Phase 2 — verification only, no code changes
- **US5 Situational (Phase 8)**: Independent after Phase 2 — NeighborPanel hook addition
- **US6 Personal (Phase 9)**: Independent after Phase 2 — three separate file edits

### Within-Phase Parallel Opportunities

**Phase 2**: T003, T004, T005 can run in parallel (different files) — all depend on T002
**Phase 9**: T020, T021, T022 can run in parallel (different files)
**Phase 10**: T025, T026 can run in parallel with T024 (different files)

---

## Parallel Example: Phase 2 (Foundational)

```
# After T002 (type definition) lands:
Parallel batch A:
  T003 — hooks/useViewState.ts (STOP_SEQUENCE + isExteriorStop)
  T004 — utils/hexViewport.ts (STOP_PITCH + neighborhoodView)
  T005 — components/PanelView/PanelView.tsx (no-panel guard)

Then T006 — pnpm typecheck (gates all story phases)
```

## Parallel Example: Phase 9 (Personal Stop)

```
Parallel batch:
  T020 — components/ConversationThread/ConversationThread.tsx (auto-scroll)
  T021 — components/ConversationThread/MessageInput.tsx (auto-focus)
  T022 — components/ChatPanel/ChatPanel.tsx (redirect note)

Then T023 — smoke test (depends on all three)
```

---

## Implementation Strategy

### MVP First (P1 stops only, skip Neighborhood)

1. Phase 1: Setup baseline
2. Phase 2: Foundational type change (required even for MVP — keeps TypeScript happy)
3. Phase 3: Global hint (quick, high visibility)
4. Phase 6: Plan ghost rendering confirmation + void platter
5. Phase 8: Situational last message
6. Phase 9: Personal auto-scroll + auto-focus + chat note
7. **STOP and VALIDATE**: all P1 stops functional

### Full Delivery (add Neighborhood)

8. Phase 5: Neighborhood camera + layers
9. Phase 10: Polish + documentation

### Parallel Strategy (if two people)

After Phase 2 completes:
- Person A: Phases 3 + 5 (Global hint + Neighborhood rendering)
- Person B: Phases 8 + 9 (Situational last message + Personal chat UX)
- Phases 4, 6, 7 are verification-only — either person picks them up as filler

---

## Notes

- Phases 4, 7 are verification-only (Regional and Room stops already work). They exist to confirm no regressions after the Phase 2 type change.
- T014 (ghost rendering confirmation) is a read-and-document task — the fix already landed earlier in this branch.
- [P] tasks within a phase touch different files and have no shared state — safe to parallelize.
- Each user story phase ends with a smoke test that can be run independently to validate the story without completing other phases.
