# Data Model: Intermedium Polish

**Feature**: 014-intermedium-polish

This feature introduces no new server-side entities or shared-type changes. All model changes are local to `clients/intermedium/src/`.

---

## Changed: `CameraStop` (additive)

**File**: `clients/intermedium/src/types/viewState.ts`

```typescript
// Before
export type ExteriorStop = "global" | "regional";

// After (IC-005)
export type ExteriorStop = "global" | "regional" | "neighborhood";
```

**Impact**: The `CameraStop` union (`ExteriorStop | InteriorStop | PersonalStop`) gains one member. Every exhaustive check over `CameraStop` must handle the new value. TypeScript's strict mode surfaces all unhandled cases at compile time.

**Affected call sites** (all in `clients/intermedium/src/`):

| File | Change needed |
|------|--------------|
| `hooks/useViewState.ts` | Add `"neighborhood"` to `STOP_SEQUENCE`; add to `isExteriorStop` predicate |
| `utils/hexViewport.ts` | Add `neighborhood: 45` to `STOP_PITCH`; add `neighborhoodView()` |
| `components/SceneView/SceneView.tsx` | Add `neighborhood` case in `computeMapCamera` and `layers` memo |
| `components/PanelView/PanelView.tsx` | Add `neighborhood` to no-panel guard |

---

## Optional New Field: `lastDirection` on ghost state

**File**: `clients/intermedium/src/types/ghostPosition.ts` (and `ClientState.tsx`)

**Proposed addition** (Phase 7, optional):

```typescript
export type CompassDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface GhostPosition {
  readonly ghostId: string;
  readonly h3Index: string;
  readonly lastDirection?: CompassDir;  // derived client-side from consecutive h3Index values
}
```

**Derivation**: When Colyseus fires an `onChange` for `ghostTiles`, compare previous and current `h3Index` centroids using `cellToLatLng`, compute `Math.atan2(ΔlngCos, Δlat)`, and snap to the nearest of 8 compass headings. Stored in `ClientState` alongside the ghost position.

**Downstream impact**: `GhostCard` reads `position.lastDirection` for a dim subtitle annotation. No server or shared-type changes.

---

## No changes to

- `@aie-matrix/shared-types` — `WorldSpectatorState`, `CellRecord`, `ItemDefinition`: unchanged
- Colyseus `ghostTiles` schema: unchanged (client-only enhancement)
- HTTP map API (`/maps/:id?format=gram`): unchanged
- Ghost house A2A API: unchanged (existing `useA2AConversation` hook reused at Situational stop)
