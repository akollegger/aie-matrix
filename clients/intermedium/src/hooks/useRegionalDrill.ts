import { useEffect, useMemo, useState } from "react";
import { cellToLatLng, cellToParent, isValidCell } from "h3-js";
import { zoomForCellsAcrossShortEdge } from "../utils/hexViewport.js";

/** R0 through R5 — six levels of parent-cell zoom. */
export const REGIONAL_DRILL_MAX = 5;

/**
 * ms between drill steps: 500ms camera animation + 200ms pause before next reveal.
 * Total R0→R5: 5 × 700ms = 3.5 seconds.
 */
const STEP_DELAY_MS = 700;

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

  const { drillViewport, parentCells } = useMemo(() => {
    if (!boardH3 || !isActive || !isValidCell(boardH3)) {
      return { drillViewport: null, parentCells: [] };
    }
    const cells: string[] = [];
    for (let r = 0; r <= drillLevel; r++) {
      cells.push(cellToParent(boardH3, r));
    }
    const currentCell = cells[cells.length - 1]!;
    const [lat, lng] = cellToLatLng(currentCell);
    const cpv = CPV_PER_LEVEL[drillLevel] ?? 3;
    const zoom = zoomForCellsAcrossShortEdge(currentCell, cpv, vpW, vpH);
    return {
      drillViewport: { longitude: lng, latitude: lat, zoom },
      parentCells: cells,
    };
  }, [boardH3, drillLevel, isActive, vpW, vpH]);

  return { drillLevel, drillViewport, parentCells };
}
