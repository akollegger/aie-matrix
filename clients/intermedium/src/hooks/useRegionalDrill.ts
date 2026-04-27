import { useEffect, useMemo, useState } from "react";
import { cellToLatLng, cellToParent, isValidCell } from "h3-js";
import { zoomForCellsAcrossShortEdge, cellFitViewport } from "../utils/hexViewport.js";

/** R0 through R5 — six levels of parent-cell zoom. */
export const REGIONAL_DRILL_MAX = 5;

/**
 * ms between drill steps — matches the 500ms camera transition exactly so the
 * next level fires as soon as the previous animation completes. Total R0→R5: 2.5s.
 */
const STEP_DELAY_MS = 500;

/**
 * CPV (cells per viewport short edge) for each resolution level.
 * Lower = more context visible; higher = tighter on the cell.
 */
const CPV_PER_LEVEL = [2, 2, 2.5, 2.5, 3, 3] as const;

export interface RegionalDrillState {
  /** Current drill resolution level (0 = R0 visible, 5 = R5 visible). */
  readonly drillLevel: number;
  /** Camera target for the current drill level, or null if not yet ready. */
  readonly drillViewport: { readonly longitude: number; readonly latitude: number; readonly zoom: number } | null;
  /** The H3 parent cells to show, indexed 0..drillLevel. */
  readonly parentCells: readonly string[];
  /**
   * Easing function for the current step's camera transition:
   *   step 0 → ease-in  (first entry, camera starts from rest)
   *   steps 1–4 → linear (maintain momentum through the drill)
   *   step 5 → ease-out (final arrival, settle at R5)
   */
  readonly drillEasing: (t: number) => number;
}

/**
 * Drives the Global → Regional progressive drill-down animation.
 * Advances one parent-resolution level per STEP_DELAY_MS while `isActive`.
 * Resets to level 0 on deactivation so the animation replays on re-entry.
 */
export function useRegionalDrill(
  boardH3: string | null,
  isActive: boolean,
  vpW: number,
  vpH: number,
): RegionalDrillState {
  const [drillLevel, setDrillLevel] = useState(0);

  // Reset when leaving Regional.
  useEffect(() => {
    if (!isActive) setDrillLevel(0);
  }, [isActive]);

  // Advance one level at a time until DRILL_MAX.
  useEffect(() => {
    if (!isActive || drillLevel >= REGIONAL_DRILL_MAX) return;
    const t = setTimeout(() => setDrillLevel((l) => l + 1), STEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [isActive, drillLevel]);

  const drillEasing = useMemo((): ((t: number) => number) => {
    if (drillLevel === 0) return (t) => t * t * t;                  // ease-in
    if (drillLevel >= REGIONAL_DRILL_MAX) return (t) => 1 - Math.pow(1 - t, 3); // ease-out
    return (t) => t;                                                 // linear
  }, [drillLevel]);

  const { drillViewport, parentCells } = useMemo(() => {
    if (!boardH3 || !isActive || !isValidCell(boardH3)) {
      return { drillViewport: null, parentCells: [] };
    }
    const cells: string[] = [];
    for (let r = 0; r <= drillLevel; r++) {
      cells.push(cellToParent(boardH3, r));
    }
    const currentCell = cells[cells.length - 1]!;
    // Final step: fit the cell's bounding box to the full viewport (fills width correctly).
    // Intermediate steps: CPV-based zoom keeps each level visually consistent.
    const drillViewport =
      drillLevel >= REGIONAL_DRILL_MAX
        ? cellFitViewport(currentCell, vpW, vpH, 24)
        : (() => {
            const [lat, lng] = cellToLatLng(currentCell);
            const cpv = CPV_PER_LEVEL[drillLevel] ?? 3;
            const zoom = zoomForCellsAcrossShortEdge(currentCell, cpv, vpW, vpH);
            return { longitude: lng, latitude: lat, zoom };
          })();
    return {
      drillViewport,
      parentCells: cells,
    };
  }, [boardH3, drillLevel, isActive, vpW, vpH]);

  return { drillLevel, drillViewport, parentCells, drillEasing };
}
