import { cellToLatLng, POLYGON_TO_CELLS_FLAGS, polygonToCellsExperimental } from "h3-js";

/**
 * Given N vertex H3 cells (res-15), return all H3 cells that overlap the
 * convex polygon they define.
 *
 * Mirrors the reference implementation in tools/map-editor/src/map/polygon-geometry.ts.
 * Vertices are sorted by angle from the centroid before the polygon ring is
 * built, preventing self-intersecting rings.
 *
 * Returns the vertex array unchanged when fewer than 3 vertices are given.
 */
export function computeCellsFromVertices(vertices: string[]): string[] {
  if (vertices.length < 3) return [...vertices];

  const vPoints = vertices.map((v) => cellToLatLng(v)); // [[lat, lng], ...]
  const cLat = vPoints.reduce((s, [la]) => s + la!, 0) / vPoints.length;
  const cLng = vPoints.reduce((s, [, lo]) => s + lo!, 0) / vPoints.length;

  const sorted = [...vPoints].sort(
    (a, b) =>
      Math.atan2(a[0]! - cLat, a[1]! - cLng) -
      Math.atan2(b[0]! - cLat, b[1]! - cLng),
  );

  return polygonToCellsExperimental(
    [...sorted, sorted[0]!],
    15,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
  );
}
