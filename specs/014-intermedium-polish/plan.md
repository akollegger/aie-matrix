# Implementation Plan: Intermedium Polish — Map, Chat, and Camera Stops

**Branch**: `014-intermedium-polish` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)

## Summary

Iterative polish pass on the `clients/intermedium/` React client, working through each camera stop in sequence with user approval of the experience at each step. Covers: navigation hint at Global stop, Regional verification, a Neighborhood Re-Evaluation phase (the decision to add or skip the stop is made after experiencing Regional → Plan, not before), ghost marker placement at Plan, ghost identity at Room, last-paired-message preview at Situational, and chat UX (auto-scroll, auto-focus, floating-panel redirect) at Personal. Ghost rendering (`ScatterplotLayer`) was already corrected in the current session.

All changes are confined to `clients/intermedium/src/`. No new packages, no server changes, no shared-type changes.

**Acceptance model**: Each stop phase ends with a live review session. The phase is not complete until the user approves the experience at that stop. TypeScript and smoke-test passes are necessary but not sufficient — user sign-off is the gate.

## Technical Context

**Language/Version**: TypeScript 5.7 (browser target, ESM)  
**Primary Dependencies**: React 18, deck.gl ≥ 9 (`H3HexagonLayer`, `ScatterplotLayer`, `_GlobeView`), h3-js ≥ 4, colyseus.js, `@react-three/fiber`, `three`, Vite 6  
**Storage**: N/A — stateless browser client  
**Testing**: Vitest (unit); manual browser smoke test (no Playwright for this client)  
**Target Platform**: Desktop/tablet browser (Chrome, Firefox, Safari)  
**Project Type**: Web application client (existing package `clients/intermedium/`)  
**Performance Goals**: 60 fps during camera transitions; ghost position updates ≤ 1 s  
**Constraints**: All changes inside `clients/intermedium/src/`; no new workspace packages; no server-side changes  
**Scale/Scope**: Single browser client; seven camera stops; up to ~50 simultaneous ghost markers

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Proposal linkage matches scope | ✅ | `spec-014` traces back to RFC-0008 and `spec-011`; this is an enumerated polish pass with no architectural change |
| Architectural boundaries preserved | ✅ | All changes stay inside `clients/intermedium/src/`; no changes to `@aie-matrix/shared-types`, Colyseus server, or any other package |
| Shared interfaces have contract artifacts | ✅ | IC-005 and IC-006 are internal to `clients/intermedium`; no cross-package contract changes; existing `spec.md` documents both |
| Verifiable increments per user slice | ✅ | Each stop has an independent smoke-test path (see quickstart.md); each phase below is independently demonstrable |
| Documentation impact enumerated | ✅ | `clients/intermedium/README.md` requires update for seven-stop table and chat integration note; `spec-011` requires superseded-by notes |

*Re-check after Phase 3 (Neighborhood Re-Evaluation): if Outcome A is chosen, `neighborhood` is purely additive — it extends `CameraStop` within one package. The venueZoom trigger fix is the only non-additive change. No cross-package contracts affected.*

## Project Structure

### Documentation (this feature)

```text
specs/014-intermedium-polish/
├── plan.md              ← this file
├── research.md          ← Phase 0 findings
├── data-model.md        ← Phase 1 entity notes
├── quickstart.md        ← per-phase verification steps
└── checklists/
    └── requirements.md
```

### Source Code (affected files only)

All changes are inside `clients/intermedium/src/`. Neighborhood files are conditional on the re-evaluation outcome.

```text
clients/intermedium/src/
├── utils/
│   └── hexViewport.ts            ← voidNeighborH3s fix (Plan); neighborhoodView() if Neighborhood proceeds
├── hooks/
│   └── useViewState.ts           ← STOP_SEQUENCE + isExteriorStop (conditional on Neighborhood decision)
├── types/
│   └── viewState.ts              ← ExteriorStop union (conditional on Neighborhood decision)
├── components/
│   ├── SceneView/
│   │   └── SceneView.tsx         ← computeMapCamera + layers: neighborhood case (conditional)
│   ├── PanelView/
│   │   ├── PanelView.tsx         ← no-panel guard: neighborhood (conditional)
│   │   └── NeighborPanel.tsx     ← replace last-message stub with useA2AConversation
│   ├── ConversationThread/
│   │   ├── ConversationThread.tsx ← auto-scroll to bottom on message append
│   │   └── MessageInput.tsx       ← auto-focus on mount
│   ├── ChatPanel/
│   │   └── ChatPanel.tsx          ← "full conversation at Personal" note when off-stop
│   └── NavHint.tsx                ← NEW: navigation keyboard hint overlay (Global stop)
└── App.tsx                        ← render NavHint at Global stop
```

**Structure decision**: Single package, in-place edits; one new file (`NavHint.tsx`). No new directories needed for the confirmed scope.

## Implementation Phases

*Phases follow camera stop sequence. Each phase ends with a live user review — the phase is not complete until the user approves the experience. The Neighborhood phase is a re-evaluation point: the decision to add or skip the stop is made after experiencing Regional and the Regional → Plan transition, not before.*

---

### Phase 1 — Global Stop: Navigation Hint

*Adds the first-time keyboard hint overlay so first-time attendees know how to advance.*

**Files**: `NavHint.tsx` (new), `App.tsx`

**Tasks**:

1. **`NavHint.tsx`** — Create a small overlay component:
   - Renders when `visible` prop is `true`
   - Position: bottom-center, above the [C] button
   - Content: `+ / = zoom in · Esc back`
   - Style: monospace, ~10px, dim text (~50% opacity), no background box
   - Auto-hides after first `+` / `=` or `Escape` keypress using local `useState`

2. **`App.tsx`** — Add `<NavHint visible={stop === "global"} />` inside the non-Personal branch, above `PanelView`

**Smoke test**: Open the client — hint text visible at bottom-center at Global stop. Press `+` — view advances to Regional and hint disappears. Return to Global via `Escape` — hint does not reappear (dismissed state persists in session).

**Acceptance gate**: User approves that the Global stop communicates its purpose and affords navigation without additional explanation.

---

### Phase 2 — Regional Stop: Verification

*Confirm the existing Regional drill-in animation is correct and geographic context is legible — no code changes expected.*

**Files**: None anticipated.

**Smoke test**: Navigate Global → Regional. Drill animation plays through all levels. Venue marker (teal) and ≥2 SF landmark markers (amber) visible at drill completion. `+` advances toward Plan.

**Acceptance gate**: User approves that the Regional stop provides meaningful geographic context and a clear sense of approaching the venue.

---

### Phase 3 — Neighborhood Re-Evaluation

*The Neighborhood stop is specified in RFC-0008 but never implemented. Rather than deciding in advance whether it belongs, this phase examines the Regional → Plan transition as experienced and makes the decision collaboratively.*

**Decision criteria to evaluate**:
- Does the Regional → Plan automatic venueZoom animation (already implemented) provide sufficient venue-scale orientation, making a discrete Neighborhood stop redundant?
- Does inserting a manual stop between Regional and Plan interrupt the cinematic flow?
- Would a 45° overhead stop at the R12 venue cell add meaningful legibility beyond what the venueZoom already delivers?
- **Key technical note**: adding `neighborhood` between `regional` and `plan` in `STOP_SEQUENCE` breaks the venueZoom activation trigger at `SceneView.tsx:234` (`prev === "regional" && viewState.stop === "plan"`), requiring a fix.

**Outcome A — Add Neighborhood stop**:
- Add `"neighborhood"` to `ExteriorStop` union in `types/viewState.ts`
- Insert `"neighborhood"` between `"regional"` and `"plan"` in `STOP_SEQUENCE`; add to `isExteriorStop` in `hooks/useViewState.ts`
- Add `neighborhood: 45` to `STOP_PITCH`; add `neighborhoodView()` in `utils/hexViewport.ts`
- Fix venueZoom trigger in `SceneView.tsx` (`prev === "neighborhood"` or alternative logic)
- Add `neighborhood` case in `computeMapCamera` and `layers` memo in `SceneView.tsx`
- Add `neighborhood` to no-panel guard in `PanelView.tsx`
- Run `pnpm typecheck` — zero new errors

**Outcome B — Skip Neighborhood stop**:
- Update spec and RFC notes to record the decision and rationale
- No code changes required

**Acceptance gate**: User and implementer jointly decide Outcome A or B based on the experienced Regional → Plan transition. No code is written before this gate.

---

### Phase 4 — Plan Stop: Ghost Markers + Void Platter

*Ghost markers correctly placed on their tiles; no void-platter artifacts outside the map footprint.*

**Files**: `utils/hexViewport.ts`

**Tasks**:

1. **`voidNeighborH3s()` fix** — Replace `gridDisk(centerH3, platterRadius)` body with K=1 edge-neighbor approach: iterate each tile, collect `gridDisk(tile.h3Index, 1)` neighbors not in the tile set, return deduplicated array. Produces a one-cell-wide halo matching actual map outline.

2. Confirm `layers/ghostPointCloudLayer.ts` uses `ScatterplotLayer` (already done — verify and document).

**Smoke test**: Open Plan stop on 1920×1080 viewport with active ghosts; verify ghost count matches backend, each marker on its tile, no wireframe outside tile footprint.

**Acceptance gate**: User approves ghost marker placement and map boundary rendering at Plan stop.

---

### Phase 5 — Room Stop: Ghost Identity

*Ghost identity panel visible immediately on arrival — no code changes expected.*

**Files**: None anticipated.

**Smoke test**: Double-click a tile near active ghosts at Plan; Room stop opens; `AreaPanel` lists nearby ghosts without any additional click; double-click a ghost marker to advance to Situational.

**Acceptance gate**: User approves that the Room stop surfaces ghost identities without extra interaction.

---

### Phase 6 — Situational Stop: Last Paired Message

*Replaces the `NeighborPanel` conversation stub with the actual last message from the paired ghost's thread.*

**Files**: `components/PanelView/NeighborPanel.tsx`

**Tasks**:

1. Add `useA2AConversation` hook call inside `NeighborPanel`, gated on `pairedInCluster`:
   ```
   const worldApiUrl = import.meta.env.VITE_WORLD_API_URL ?? "";
   const humanId = useHumanSession();
   const pairedGhostId = pairedInCluster ? pairing!.ghostId : null;
   const { thread } = useA2AConversation(pairedGhostId, worldApiUrl, humanId);
   ```

2. Replace stub with compact last-message display: sender label (`Ghost` / `You`), first 120 chars, ellipsis if truncated. Show "No messages yet." if thread is empty. Section absent if paired ghost not in cluster.

**Smoke test**: Navigate to Situational with paired ghost in 7-hex cluster; verify last message renders; verify section absent when paired ghost outside cluster.

**Acceptance gate**: User approves that the Situational stop previews the conversation and bridges spatial exploration to the Personal stop.

---

### Phase 7 — Personal Stop: Chat UX

*Conversation thread visible immediately; input auto-focused; floating [C] panel redirects to Personal for full experience.*

**Files**: `ConversationThread.tsx`, `MessageInput.tsx`, `ChatPanel.tsx`

**Tasks**:

1. **`ConversationThread.tsx`** — Auto-scroll to bottom:
   - Add `bottomRef = useRef<HTMLDivElement>(null)` sentinel div after message list
   - `useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])`

2. **`MessageInput.tsx`** — Auto-focus on mount:
   - Add `useEffect(() => { inputRef.current?.focus() }, [])` — fires once on mount (existing `inputRef` is already wired)

3. **`ChatPanel.tsx`** — Stop-context note:
   - Read `viewState.stop` via `useClientState()`
   - When `stop !== "personal"`, render dim informational banner: "Full conversation view available at the Personal stop (navigate with +/=)"

**Smoke test**: Navigate to Personal; thread scrolled to bottom + input focused on mount; send message; open [C] from Plan, verify banner; open [C] from Personal, verify no banner.

**Acceptance gate**: User approves that the Personal stop is the primary conversation surface requiring no extra navigation or clicks to engage.

## Data Model Changes

See `data-model.md` for entity details. The only structural change is to `CameraStop` (new `"neighborhood"` member) and the optional new `lastDirection` field on ghost state. Both are additive and backward-compatible.

## Interface Contracts

IC-005 and IC-006 are internal to `clients/intermedium/src/` — they cross no package, process, or language boundary. No formal contract artifact beyond what the spec documents is required by the constitution.

IC-005 **touchpoint checklist** (all in `clients/intermedium/src/`) — conditional on Neighborhood Re-Evaluation outcome:
- [ ] `types/viewState.ts` — type definition
- [ ] `hooks/useViewState.ts` — sequence + predicate
- [ ] `utils/hexViewport.ts` — pitch map + camera function
- [ ] `components/SceneView/SceneView.tsx` — camera + layers + venueZoom trigger fix
- [ ] `components/PanelView/PanelView.tsx` — no-panel guard

## Success Criteria Verification Plan

| SC | Verification method |
|----|-------------------|
| SC-007 (ghost marker placement) | Open with 5 active ghosts, visually confirm each marker is on its tile |
| SC-008 (per-stop purpose legible) | Walk a colleague through each stop cold; they should name each stop's purpose |
| SC-009 (Personal chat in ≤2s) | Navigate to Personal; thread visible + input focused within 2s of stop mount |
| SC-010 (no pop or crash on 7-stop arc) | Navigate all 7 stops in sequence, forward and backward |
| SC-011 (no void platter artifacts) | Open Plan on 1920×1080 (or dev-tools emulated); no wireframe outside tile footprint |

## Documentation Updates

After implementation, update:

**RFCs**
- `proposals/rfc/0008-human-spectator-client.md`:
  - Layer composition section (line ~140): correct `PointCloudLayer` → `ScatterplotLayer` for ghost positions at interior stops; note that `PointCloudLayer` with `COORDINATE_SYSTEM.LNGLAT` misprojected in `_GlobeView` and `ScatterplotLayer` is the correct globe-aware layer
  - Layer composition section (line ~163): same correction in the numbered layer list
  - Neighborhood stop (line ~103): add an implementation note recording the Phase 3 re-evaluation outcome — either confirming the stop was added in spec-014 or explaining why the venueZoom animation satisfies the same need

**Feature specs**
- `specs/011-intermedium-client/spec.md`:
  - Add superseded note to FR-002 (ghost rendering — `ScatterplotLayer` per FR-031)
  - Add superseded note to FR-003 (six stops shipped; seven-stop question deferred to spec-014 Phase 3 re-evaluation)
  - Add superseded note to FR-009 (floating chat panel is secondary; `PersonalPanel` is the primary surface per FR-035)

**Client docs**
- `clients/intermedium/README.md`:
  - Architecture section: replace "PointCloudLayer" with "ScatterplotLayer" for ghost markers
  - Camera stops table: update `neighborhood` row based on Phase 3 re-evaluation outcome — either confirm description matches implementation, or mark as intentionally omitted with rationale

**Project-wide docs**
- `docs/architecture.md`: already correct (7-stop model referenced, no `PointCloudLayer` ghost reference); verify after implementation that no new inaccuracies were introduced
- `docs/project-overview.md`: already correct (lists all seven stops including neighborhood); no changes expected
