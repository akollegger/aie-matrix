# Implementation Plan: Intermedium Polish — Map, Chat, and Camera Stops

**Branch**: `014-intermedium-polish` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)

## Summary

Polish pass on the `clients/intermedium/` React client: add the missing `neighborhood` camera stop (completing the seven-stop arc), fix three chat UX gaps at the Personal stop (auto-scroll, auto-focus, and floating-panel redirect), add a navigation hint at Global stop, replace the stub in the Situational panel with the actual last paired-ghost message, and clean up the void platter boundary at Plan. Ghost rendering (`ScatterplotLayer`) was already corrected in the current session.

All changes are confined to `clients/intermedium/src/`. No new packages, no server changes, no shared-type changes.

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

*Re-check after Phase 1 design: `neighborhood` stop is purely additive — it extends `CameraStop` union type within one package, touches no cross-package contract.*

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

All changes are inside `clients/intermedium/src/`:

```text
clients/intermedium/src/
├── types/
│   └── viewState.ts              ← add "neighborhood" to CameraStop / ExteriorStop
├── hooks/
│   └── useViewState.ts           ← STOP_SEQUENCE, isExteriorStop, cycleIn gate
├── utils/
│   └── hexViewport.ts            ← STOP_PITCH entry, neighborhoodView(), voidNeighborH3s fix
├── components/
│   ├── SceneView/
│   │   └── SceneView.tsx         ← computeMapCamera + layers memo: neighborhood case
│   ├── PanelView/
│   │   ├── PanelView.tsx         ← add neighborhood to no-panel guard
│   │   └── NeighborPanel.tsx     ← replace last-message stub with useA2AConversation
│   ├── ConversationThread/
│   │   ├── ConversationThread.tsx ← auto-scroll to bottom on message append
│   │   └── MessageInput.tsx       ← auto-focus on mount
│   ├── ChatPanel/
│   │   └── ChatPanel.tsx          ← "full conversation at Personal" note when off-stop
│   └── NavHint.tsx                ← NEW: navigation keyboard hint overlay (Global stop)
└── App.tsx                        ← render NavHint at Global stop
```

**Structure decision**: Single package, in-place edits; one new file (`NavHint.tsx`). No new directories. The `neighborhood` stop change is the widest, touching 4–5 files, but all are in `clients/intermedium/src/` and the changes are purely additive (new case in existing switches/maps).

## Implementation Phases

---

### Phase 1 — Neighborhood Stop: Type Foundations (IC-005)

*Widest change — touches every file that enumerates `CameraStop`. Must land before Phase 2.*

**Files**: `viewState.ts`, `useViewState.ts`, `hexViewport.ts`, `PanelView.tsx`

**Tasks**:

1. **`viewState.ts`** — Add `"neighborhood"` to `ExteriorStop` union:
   ```
   export type ExteriorStop = "global" | "regional" | "neighborhood";
   ```
   TypeScript will surface every exhaustive check that needs updating.

2. **`useViewState.ts`** — Insert `"neighborhood"` in `STOP_SEQUENCE` between `"regional"` and `"plan"`:
   ```
   export const STOP_SEQUENCE: CameraStop[] = [
     "global", "regional", "neighborhood",
     "plan", "room", "situational", "personal",
   ];
   ```
   `isExteriorStop` already checks `stop === "regional"` — add `|| stop === "neighborhood"`. The `nextStopInSequence` / `prevStopInSequence` functions use the array and need no change beyond the sequence update.

3. **`hexViewport.ts`** — Add pitch entry and camera function:
   - `STOP_PITCH`: add `neighborhood: 45`
   - New `neighborhoodView(tiles, widthPx, heightPx)`: fit the R12 parent of the first board tile into the viewport (same cell used in the venue zoom sequence). Returns a `MapViewport`; pitch is applied by the caller.

4. **`PanelView.tsx`** — Add `neighborhood` to the no-panel guard:
   ```
   if (
     viewState.stop === "global" ||
     viewState.stop === "regional" ||
     viewState.stop === "neighborhood" ||
     viewState.stop === "plan"
   ) { return null; }
   ```

**Verification**: TypeScript build must pass with zero new errors. A `console.log` of `STOP_SEQUENCE` from `useViewState.ts` should show all seven stops.

---

### Phase 2 — Neighborhood Stop: Camera + Rendering

*Depends on Phase 1. Adds the actual camera target and layer set for the new stop.*

**Files**: `SceneView.tsx`

**Tasks**:

1. **`computeMapCamera`** — Add `neighborhood` case:
   ```
   if (vs.stop === "neighborhood") {
     const v = neighborhoodView(tiles, w, h);
     return { ...v, pitch, bearing: 0 };
   }
   ```

2. **`layers` memo** — Add `neighborhood` case to the giant `if (s === ...)` chain:
   - Layer set: use `buildRegionalEndLayers()` (the same stable-ID regional end-state) so the transition from `regional` to `neighborhood` is purely a camera move with no layer swap
   - This mirrors the Regional → Plan continuity already in the codebase: same layers, different camera

3. **`lodExtruded`** — The `neighborhood` stop is exterior, so `lodExtruded` should be `true`. Verify the existing condition covers it:
   ```
   const lodExtruded = !(
     viewState.stop === "plan" || viewState.stop === "room" || viewState.stop === "situational" ||
     (viewState.stop === "regional" && drillLevel >= REGIONAL_DRILL_MAX)
   );
   ```
   `neighborhood` is not in the exclusion list, so it evaluates to `true` — correct, no change needed.

**Verification**: Navigate `global → regional → neighborhood → plan` using `+` key. Each step must show a smooth animated camera move. At `neighborhood`, the board fills ~70% of the viewport height at ~45° pitch. No ghost markers visible.

---

### Phase 3 — Chat UX: Auto-scroll, Auto-focus, Floating Panel Note

*Independent of Phases 1–2. Three self-contained fixes to the conversation surface.*

**Files**: `ConversationThread.tsx`, `MessageInput.tsx`, `ChatPanel.tsx`

**Tasks**:

1. **`ConversationThread.tsx`** — Add auto-scroll to bottom:
   - Add a `bottomRef = useRef<HTMLDivElement>(null)` sentinel div after the message list
   - `useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])` — fires whenever `messages` array changes length

2. **`MessageInput.tsx`** — Auto-focus on mount:
   - The `inputRef` already exists and is used for post-send refocus
   - Add `useEffect(() => { inputRef.current?.focus() }, [])` — fires once on mount
   - This also serves FR-037: when `PersonalPanel` mounts (i.e., Personal stop activates), the input receives focus automatically

3. **`ChatPanel.tsx`** — "Full conversation at Personal stop" note:
   - Add `useClientState()` call to read `viewState.stop`
   - When `viewState.stop !== "personal"`, render a small banner below the header:
     ```
     Full conversation view available at the Personal stop (navigate with +/=)
     ```
   - The banner should be subtle (dim text, no border) — informational, not a blocker

**Verification**:
- Open Personal stop with prior messages — thread scrolls to bottom on mount without manual scroll
- Send a message — input clears and re-focuses; new message appears at bottom
- Open [C] chat from Plan stop — banner is visible. Close and open from Personal stop — banner absent.

---

### Phase 4 — Global Stop: Navigation Hint

*Independent of Phases 1–3. Adds the first-time hint overlay.*

**Files**: `NavHint.tsx` (new), `App.tsx`

**Tasks**:

1. **`NavHint.tsx`** — Create a small overlay component:
   - Renders when `visible` prop is `true`
   - Position: bottom-center, above the [C] button
   - Content: keyboard hints for the current context — at Global: `+ / = zoom in · Esc back`
   - Style: monospace, ~10px, dim text (~50% opacity), no background box (inline text only)
   - Auto-hides after first `+` / `=` or `Escape` keypress using local `useState`

2. **`App.tsx`** — Add `<NavHint visible={stop === "global"} />` inside the non-Personal branch, above `PanelView`

**Verification**: Open the client — hint text is visible at the bottom-center of the Global stop viewport. Press `+` — view advances to Regional and hint disappears. Return to Global via `Escape` — hint does not reappear (dismissed state persists in session).

---

### Phase 5 — Situational Panel: Last Paired Message

*Independent. Replaces the `NeighborPanel` conversation stub with the real last message.*

**Files**: `NeighborPanel.tsx`

**Tasks**:

1. Add `useA2AConversation` hook call inside `NeighborPanel`, gated on `pairedInCluster`:
   ```
   const worldApiUrl = import.meta.env.VITE_WORLD_API_URL ?? "";
   const humanId = useHumanSession();
   const pairedGhostId = pairedInCluster ? pairing!.ghostId : null;
   const { thread } = useA2AConversation(pairedGhostId, worldApiUrl, humanId);
   ```

2. Replace the stub section with the last message:
   ```
   const lastMessage = thread.messages[thread.messages.length - 1] ?? null;
   ```
   Render it as a compact quoted message: sender label (`Ghost` / `You`), first 120 chars of content, ellipsis if truncated.

3. Keep the conditional gated on `pairedInCluster` — no hook call when the paired ghost is outside the cluster

**Verification**: Navigate to Situational stop while paired ghost is in the 7-hex cluster. The "Conversation view unlocks at Partner scale" stub is replaced by the last message from the thread. If no messages exist, show "No messages yet." If the paired ghost is not in the cluster, section is absent.

---

### Phase 6 — Void Platter Boundary (FR-032)

*Lower priority — cosmetic polish. Can ship without this if time-constrained.*

**Files**: `hexViewport.ts`

**Context**: `voidNeighborH3s()` uses `gridDisk(centerH3, platterRadius)` to create a ring of cells around the map footprint. At res-15 with an irregular map shape, the disk is circular while the map is rectangular, producing void cells that visually extend beyond the map edge in some directions.

**Task**: Replace `gridDisk` with a set of cells derived from the map's K-ring boundary — iterate each tile's neighbors, collect any neighbor H3 that is NOT in the tile set, and return those edge-adjacent void cells (K=1 only). This produces a one-cell-wide edge halo that closely follows the actual map outline rather than a circle.

**Verification**: At Plan stop, the void platter wireframe forms a thin outline exactly around the map boundary — no wireframe artifacts extending into empty globe space.

---

### Phase 7 — Ghost Last-Move Direction (FR-045 annotation)

*Optional polish. Adds "last move direction" to the Personal stop ghost state annotation.*

**Files**: `types/ghostPosition.ts`, `context/ClientState.tsx`, `components/GhostCard/GhostCard.tsx`

**Context**: `GhostPosition` currently stores only `{ ghostId, h3Index }`. The Personal stop spec says ghost state annotation includes "last move direction." This field is not in the Colyseus schema — it must be derived client-side by comparing the previous and current `h3Index` using h3's `gridDistance` or a compass bearing computed from `cellToLatLng` differences.

**Task**: In `ClientState.tsx`, track `prevH3Index` per ghost alongside `h3Index`. When a ghost's `h3Index` changes, compute the bearing from old to new centroid using `cellToLatLng`, quantize to 8 compass directions, and store as `lastDirection: CompassDir | null`. Expose in `GhostCard` as a dim subtitle line (e.g., `↗ NE`).

**Verification**: With a live ghost running, navigate to Personal stop. The ghost's card shows a direction indicator that updates as the ghost moves. If the ghost has not moved since page load, direction shows as `—`.

## Data Model Changes

See `data-model.md` for entity details. The only structural change is to `CameraStop` (new `"neighborhood"` member) and the optional new `lastDirection` field on ghost state. Both are additive and backward-compatible.

## Interface Contracts

IC-005 and IC-006 are internal to `clients/intermedium/src/` — they cross no package, process, or language boundary. No formal contract artifact beyond what the spec documents is required by the constitution.

IC-005 **touchpoint checklist** (all in `clients/intermedium/src/`):
- [x] `types/viewState.ts` — type definition
- [x] `hooks/useViewState.ts` — sequence + predicate
- [x] `utils/hexViewport.ts` — pitch map + camera function
- [x] `components/SceneView/SceneView.tsx` — camera + layers
- [x] `components/PanelView/PanelView.tsx` — no-panel guard

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
  - Neighborhood stop (line ~103): add an implementation note confirming the stop is now added in spec-014, closing the gap between the RFC definition and the shipping implementation

**Feature specs**
- `specs/011-intermedium-client/spec.md`:
  - Add superseded note to FR-002 (ghost rendering — `ScatterplotLayer` per FR-031)
  - Add superseded note to FR-003 (six stops shipped → seven stops with neighborhood per FR-034)
  - Add superseded note to FR-009 (floating chat panel is secondary; `PersonalPanel` is the primary surface per FR-035)

**Client docs**
- `clients/intermedium/README.md`:
  - Architecture section: replace "PointCloudLayer" with "ScatterplotLayer" for ghost markers
  - Camera stops table: `neighborhood` row is already present — confirm its description matches the implemented camera target and pitch
  - Smoke test: add step 2a — navigate to Neighborhood stop via `+` from Regional

**Project-wide docs**
- `docs/architecture.md`: already correct (7-stop model referenced, no `PointCloudLayer` ghost reference); verify after implementation that no new inaccuracies were introduced
- `docs/project-overview.md`: already correct (lists all seven stops including neighborhood); no changes expected
