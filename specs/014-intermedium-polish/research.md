# Research: Intermedium Polish

**Feature**: 014-intermedium-polish  
**Phase**: 0 — Pre-plan investigation

## Findings

---

### R-001: Ghost Rendering Layer

**Decision**: `ScatterplotLayer` is the correct layer for ghost markers in a `_GlobeView` scene.

**Rationale**: `PointCloudLayer` with `COORDINATE_SYSTEM.LNGLAT` misprojected in deck.gl's experimental `_GlobeView` — all 16 expanded points from each ghost scattered to random screen positions. `ScatterplotLayer` uses the standard globe-aware coordinate projection and places markers correctly at H3 cell centroids. One dot per ghost, no point expansion needed.

**Alternatives considered**: Keeping `PointCloudLayer` with `COORDINATE_SYSTEM.CARTESIAN` — rejected because ghost positions are given as lat/lng and converting to Cartesian in the client would require knowing the globe's world scale, adding coupling. `ScatterplotLayer` is the idiomatic choice.

**Status**: ✅ Already implemented in `clients/intermedium/src/layers/ghostPointCloudLayer.ts`. No further work required; FR-031 locks this choice.

---

### R-002: Neighborhood Stop Camera Target

**Decision**: Use the R12 parent cell of the first board H3 as the bounding box for the Neighborhood view, fitted to the viewport using `cellFitViewport()`, with `pitch: 45`.

**Rationale**: The venue zoom sequence in `SceneView.tsx` already computes `venueCellR12 = cellToParent(firstBoardH3, 12)` and uses `cellFitViewport(venueCellR12, vp.w, vp.h)` at drill level 8 (the regional end-state). The Neighborhood stop should arrive at the same zoom/center that level-8 of the venue zoom reaches — but with 45° pitch instead of 0°. Reusing this exact camera position means the Regional → Neighborhood → Plan arc matches what the venue zoom animation was already driving toward.

**Alternatives considered**: A custom "fit the board to 70% of viewport height" computation — rejected because `cellFitViewport(venueCellR12)` already achieves this and sharing the calculation avoids drift between the animation and the static stop target.

---

### R-003: Neighborhood Stop Layer Set

**Decision**: Use `buildRegionalEndLayers()` for the Neighborhood stop layer set (same stable IDs as the regional end-state).

**Rationale**: `buildRegionalEndLayers()` is already called at Regional drill level 5 AND at Plan venue-zoom step 6, specifically to provide a visually unchanged layer set across a camera-only move. Using the same function at Neighborhood means Regional (drill complete) → Neighborhood → Plan (venue zoom start) all show the same globe+rings+R9+landmark layers. The only change across these three states is camera position and pitch — no visual layer pop. The flat board tiles appear only when the venue zoom reaches step 8 (Plan interior view).

**Alternatives considered**: A distinct Neighborhood layer set (e.g., showing the R12 grid) — deferred; the additional visual complexity is not required by the spec and would introduce a layer ID change at the Regional/Neighborhood boundary.

---

### R-004: PersonalPanel Chat Integration

**Decision**: `PersonalPanel` already renders `ConversationThread` and `MessageInput` inline — FR-035 is architecturally satisfied. The three gaps are: no auto-scroll (FR-036), no auto-focus (FR-037), and the floating `ChatPanel` has no redirect note (FR-038).

**Rationale**: Reading `PersonalPanel.tsx`:
```tsx
<ConversationThread thread={thread} />
<MessageInput isAvailable={thread.isAvailable} onSend={sendMessage} />
```
The thread is inline in the Personal panel. The `ChatPanel` full-screen overlay (opened via [C]) is a separate component with ghost list + detail pane — a richer secondary surface that is appropriate to keep for non-Personal stops.

**Gap detail**:
- FR-036 auto-scroll: `ConversationThread` renders a list of divs but no `useEffect` scrolling a ref to the bottom
- FR-037 auto-focus: `MessageInput` has `inputRef` but no mount-time focus effect
- FR-038 redirect note: `ChatPanel` has no `viewState.stop` awareness

---

### R-005: Situational Panel Last Message

**Decision**: Add `useA2AConversation` hook call inside `NeighborPanel`, gated on `pairedInCluster`, to retrieve the last message from the paired ghost's thread.

**Rationale**: The `NeighborPanel` currently shows a stub: `"Conversation view unlocks at Partner scale (US3)"`. This was a placeholder from spec-011's MVP. The hook `useA2AConversation` is already in use in `PersonalPanel` and `ChatPanel` — reusing it at Situational involves no new server contracts, only adding another hook consumer. The hook polls HTTP at 5s intervals; the added polling at Situational stop is acceptable since only one extra call is in flight (paired ghost only, gated on cluster membership).

**Alternatives considered**: Lifting the conversation hook to a shared context — deferred; only two consumers and the hook already handles null ghostId gracefully.

---

### R-006: Global Stop Navigation Hint

**Decision**: Add a new `NavHint` component that renders keyboard hints as dim monospace text at the bottom-center of the viewport. Visible at Global stop; auto-dismisses after first navigation interaction.

**Rationale**: The Global stop has no interactive tiles, no panel, and no ghost markers — there is nothing to click. Without a hint, first-time users must guess keyboard shortcuts or find documentation. A small, dismissible text line is the minimum viable affordance. No tooltip library needed; a plain `div` with `position: absolute` and `pointer-events: none` is sufficient.

**Alternatives considered**: An onboarding modal — rejected as too heavy for what is essentially one keypress. A permanent HUD — rejected because it would clutter all stops; dismissal after first use is the right default.

---

### R-007: Void Platter Boundary

**Decision**: Replace `gridDisk` expansion with a K=1 neighbor edge approach — collect H3 neighbors of every map tile that are not themselves map tiles.

**Rationale**: `gridDisk(centerH3, platterRadius)` creates a circular disk. At res-15, the map is rectangular (conference hall floor plan), so the circular disk leaves visible artifacts in the corners (disk extends beyond the map boundary in some directions, is narrower in others). The edge-neighbor approach follows the actual map outline, producing a one-cell-wide halo that matches the tile footprint.

**Implementation note**: `h3-js` `gridDisk(h, 1)` returns the 6 neighbors of a cell. For each tile, collect `gridDisk(tile.h3Index, 1).filter(n => !tileSet.has(n))`. Deduplicate with a `Set`. This replaces the current function body in `voidNeighborH3s()`.

**Status**: Lower priority — the user noted the platter was visible but not blocking in the current demo. Flag for Phase 6.

---

### R-008: Ghost Last-Move Direction

**Decision**: Compute client-side from consecutive `h3Index` values using a bearing from old centroid to new centroid, quantized to 8 compass directions.

**Rationale**: The Colyseus `WorldSpectatorState.ghostTiles` schema only stores current `h3Index` — no history or direction field. The client receives `onChange` events when a ghost moves; the previous value is accessible in the `onChange` callback. Computing `bearing = atan2(ΔlngCos, Δlat)` and snapping to N/NE/E/SE/S/SW/W/NW is straightforward with `cellToLatLng` from h3-js.

**Status**: Optional enhancement (Phase 7). Not blocking for the core polish items.
