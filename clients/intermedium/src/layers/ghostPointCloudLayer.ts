import { COORDINATE_SYSTEM } from "deck.gl";
import { PointCloudLayer } from "@deck.gl/layers";
import { cellToLatLng } from "h3-js";
import type { GhostPosition } from "../types/ghostPosition.js";

type CloudPoint = { readonly ghostId: string; readonly position: [number, number, number] };

/**
 * Volumetric-ish cluster: several points at/near the H3 centroid (US1 point-cloud ghosts).
 */
function expandGhostToPoints(ghost: GhostPosition, seed: number): CloudPoint[] {
  const [lat, lng] = cellToLatLng(ghost.h3Index);
  const out: CloudPoint[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t = seed + i * 17.17;
    const jx = Math.sin(t) * 0.00012;
    const jy = Math.cos(t * 0.7) * 0.00012;
    const jz = 1.5 + (i % 5) * 0.4;
    out.push({
      ghostId: ghost.ghostId,
      position: [lng + jx, lat + jy, jz],
    });
  }
  return out;
}

let seedCounter = 0;

export function createGhostPointCloudLayer(
  ghosts: ReadonlyMap<string, GhostPosition>,
): PointCloudLayer<CloudPoint> {
  const data: CloudPoint[] = [];
  for (const g of ghosts.values()) {
    data.push(...expandGhostToPoints(g, seedCounter++));
  }
  return new PointCloudLayer<CloudPoint>({
    id: "ghost-point-cloud",
    data,
    pickable: false,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    pointSize: 2.2,
    sizeUnits: "pixels",
    getPosition: (d) => d.position,
    getColor: () => [120, 200, 255, 220],
  });
}
