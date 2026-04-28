import { ScatterplotLayer } from "@deck.gl/layers";
import { cellToLatLng } from "h3-js";
import type { GhostPosition } from "../types/ghostPosition.js";

export type GhostPickPoint = { readonly ghostId: string; readonly lng: number; readonly lat: number };

export function ghostDataForPick(ghosts: ReadonlyMap<string, GhostPosition>): GhostPickPoint[] {
  const out: GhostPickPoint[] = [];
  for (const g of ghosts.values()) {
    const [lat, lng] = cellToLatLng(g.h3Index);
    out.push({ ghostId: g.ghostId, lng, lat });
  }
  return out;
}

/**
 * Invisible(ish) hit target for “double a ghost” at Area/Neighbor scale.
 */
export function createGhostPickLayer(
  data: readonly GhostPickPoint[],
  id = "ghost-pick",
  pickable = true,
): ScatterplotLayer<GhostPickPoint> {
  return new ScatterplotLayer<GhostPickPoint>({
    id,
    data,
    pickable,
    opacity: 0.35,
    getPosition: (d) => [d.lng, d.lat, 0],
    getRadius: 22,
    radiusMinPixels: 18,
    radiusMaxPixels: 40,
    getFillColor: [0, 0, 0, 0] as [number, number, number, number],
    getLineColor: [120, 200, 255, 100] as [number, number, number, number],
    getLineWidth: 1,
    stroked: true,
    radiusUnits: "pixels",
  });
}
