import { ScatterplotLayer } from "@deck.gl/layers";
import { cellToLatLng } from "h3-js";
import type { GhostPosition } from "../types/ghostPosition.js";

type GhostPoint = { readonly ghostId: string; readonly position: [number, number, number] };

export function createGhostPointCloudLayer(
  ghosts: ReadonlyMap<string, GhostPosition>,
  selectedGhostId?: string | null,
): ScatterplotLayer<GhostPoint>[] {
  const data: GhostPoint[] = [];
  for (const g of ghosts.values()) {
    const [lat, lng] = cellToLatLng(g.h3Index);
    data.push({ ghostId: g.ghostId, position: [lng, lat, 0] });
  }
  const base = new ScatterplotLayer<GhostPoint>({
    id: "ghost-point-cloud",
    data,
    pickable: false,
    getPosition: (d) => d.position,
    getRadius: 0.25,
    radiusUnits: "meters",
    radiusMinPixels: 4,
    radiusMaxPixels: 22,
    getFillColor: [120, 200, 255, 220],
    stroked: true,
    getLineColor: [180, 230, 255, 255],
    getLineWidth: 1,
    lineWidthUnits: "pixels",
  });

  if (!selectedGhostId) return [base];

  const sel = ghosts.get(selectedGhostId);
  const ringData: GhostPoint[] = [];
  if (sel) {
    const [lat, lng] = cellToLatLng(sel.h3Index);
    ringData.push({ ghostId: sel.ghostId, position: [lng, lat, 0] });
  }
  const ring = new ScatterplotLayer<GhostPoint>({
    id: "ghost-selected-ring",
    data: ringData,
    pickable: false,
    getPosition: (d) => d.position,
    getRadius: 0.25,
    radiusUnits: "meters",
    radiusMinPixels: 8,
    radiusMaxPixels: 28,
    getFillColor: [255, 255, 255, 0],
    stroked: true,
    getLineColor: [255, 255, 255, 220],
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    updateTriggers: { data: selectedGhostId },
  });

  return [base, ring];
}
