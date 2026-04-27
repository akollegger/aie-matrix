import { useEffect, useMemo, useState } from "react";
import { cellToLatLng, cellToParent, isValidCell } from "h3-js";
import { zoomForCellsAcrossShortEdge, cellFitViewport, mapViewFromTileBounds, type MapViewport } from "../utils/hexViewport.js";
import type { WorldTile } from "../types/worldTile.js";

/**
 * Total drill levels:
 *   0–5  parent-ring drill  (R0 globe → R5 city-region)
 *   6    pan to venueR10    (board's R10 cell fills screen)
 *   7    zoom to venueR12   (R12 mesh appears)
 *   8    board tiles        (R15 tiles with minimal extrusion)
 */
export const REGIONAL_DRILL_MAX = 8;

/** Last level of the parent-ring phase before venue zoom begins. */
export const PARENT_DRILL_MAX = 5;

/** ms per step — matches transition duration so next fires as soon as animation completes. */
const STEP_DELAY_MS = 500;

/** CPV for parent-ring levels 0–4 (level 5 uses cellFitViewport). */
const CPV_PER_LEVEL = [2, 2, 2.5, 2.5, 3] as const;

export interface RegionalDrillState {
  readonly drillLevel: number;
  readonly drillViewport: MapViewport | null;
  /** R0..min(drillLevel,5) parent cells for nested ring layers. */
  readonly parentCells: readonly string[];
  /** R10 parent of the board — available from drillLevel ≥ 6. */
  readonly venueR10: string | null;
  /** R12 parent of the board — available from drillLevel ≥ 7. */
  readonly venueR12: string | null;
  /**
   * Easing per step:
   *   0 → ease-in  (entering from rest)
   *   1–7 → linear (continuous momentum)
   *   8 → ease-out (settle at board)
   */
  readonly drillEasing: (t: number) => number;
}

export function useRegionalDrill(
  boardH3: string | null,
  tiles: ReadonlyMap<string, WorldTile>,
  isActive: boolean,
  vpW: number,
  vpH: number,
): RegionalDrillState {
  const [drillLevel, setDrillLevel] = useState(0);

  useEffect(() => {
    if (!isActive) setDrillLevel(0);
  }, [isActive]);

  useEffect(() => {
    if (!isActive || drillLevel >= REGIONAL_DRILL_MAX) return;
    const t = setTimeout(() => setDrillLevel((l) => l + 1), STEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [isActive, drillLevel]);

  const drillEasing = useMemo((): ((t: number) => number) => {
    if (drillLevel === 0) return (t) => t * t * t;                       // ease-in
    if (drillLevel >= REGIONAL_DRILL_MAX) return (t) => 1 - Math.pow(1 - t, 3); // ease-out
    return (t) => t;                                                      // linear
  }, [drillLevel]);

  const result = useMemo(() => {
    if (!boardH3 || !isActive || !isValidCell(boardH3)) {
      return { drillViewport: null, parentCells: [], venueR10: null, venueR12: null };
    }

    // Parent cells R0..min(drillLevel, PARENT_DRILL_MAX)
    const parentCells: string[] = [];
    for (let r = 0; r <= Math.min(drillLevel, PARENT_DRILL_MAX); r++) {
      parentCells.push(cellToParent(boardH3, r));
    }

    // Venue cells for levels 6+
    const venueR10 = drillLevel >= 6 ? cellToParent(boardH3, 10) : null;
    const venueR12 = drillLevel >= 7 ? cellToParent(boardH3, 12) : null;

    // Camera viewport per level
    let drillViewport: MapViewport | null = null;

    if (drillLevel <= PARENT_DRILL_MAX) {
      const cell = parentCells[drillLevel] ?? parentCells[parentCells.length - 1]!;
      if (drillLevel === PARENT_DRILL_MAX) {
        drillViewport = cellFitViewport(cell, vpW, vpH, 24);
      } else {
        const cpv = CPV_PER_LEVEL[drillLevel] ?? 3;
        const [lat, lng] = cellToLatLng(cell);
        const zoom = zoomForCellsAcrossShortEdge(cell, cpv, vpW, vpH);
        drillViewport = { longitude: lng, latitude: lat, zoom };
      }
    } else if (drillLevel === 6 && venueR10) {
      drillViewport = cellFitViewport(venueR10, vpW, vpH, 24);
    } else if (drillLevel === 7 && venueR12) {
      drillViewport = cellFitViewport(venueR12, vpW, vpH, 24);
    } else if (drillLevel >= 8) {
      drillViewport = mapViewFromTileBounds(tiles, vpW, vpH);
      if (!drillViewport && venueR12) {
        drillViewport = cellFitViewport(venueR12, vpW, vpH, 24);
      }
    }

    return { drillViewport, parentCells, venueR10, venueR12 };
  }, [boardH3, drillLevel, isActive, tiles, vpW, vpH]);

  return { drillLevel, drillEasing, ...result };
}
