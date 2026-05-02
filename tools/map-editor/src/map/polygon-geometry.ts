import { cellToLatLng, gridDisk, POLYGON_TO_CELLS_FLAGS, polygonToCellsExperimental } from "h3-js"

// ---------------------------------------------------------------------------
// Border / anchor helpers
// ---------------------------------------------------------------------------

export function polygonBorderCells(cells: string[]): string[] {
  const cellSet = new Set(cells)
  return cells.filter(cell =>
    gridDisk(cell, 1).some(n => n !== cell && !cellSet.has(n))
  )
}

function angleDiff(a: number, b: number): number {
  const d = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

/** Return exactly `sides` border cells as outline anchors (one per vertex direction). */
export function polygonAnchorCells(cells: string[], sides: number): string[] {
  const border = polygonBorderCells(cells)
  if (border.length === 0) return []

  if (sides === 4) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const c of border) {
      const [lat, lng] = cellToLatLng(c)
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    const corners: [number, number][] = [
      [maxLat, minLng], [maxLat, maxLng], [minLat, maxLng], [minLat, minLng],
    ]
    return corners.map(([tLat, tLng]) => {
      let best = border[0]!
      let bestDist = Infinity
      for (const cell of border) {
        const [lat, lng] = cellToLatLng(cell)
        const d = (lat - tLat) ** 2 + (lng - tLng) ** 2
        if (d < bestDist) { bestDist = d; best = cell }
      }
      return best
    }).filter((c, i, arr) => arr.indexOf(c) === i)
  }

  let sumLat = 0, sumLng = 0
  for (const c of cells) { const [la, lo] = cellToLatLng(c); sumLat += la; sumLng += lo }
  const cLat = sumLat / cells.length, cLng = sumLng / cells.length
  return Array.from({ length: sides }, (_, i) => (2 * Math.PI / sides) * i)
    .map(target => {
      let best = border[0]!
      let bestDist = Infinity
      for (const cell of border) {
        const [lat, lng] = cellToLatLng(cell)
        const d = angleDiff(Math.atan2(lng - cLng, lat - cLat), target)
        if (d < bestDist) { bestDist = d; best = cell }
      }
      return best
    })
    .filter((c, i, arr) => arr.indexOf(c) === i)
}

// ---------------------------------------------------------------------------
// Vertex-based cell computation
// ---------------------------------------------------------------------------

/**
 * Given N vertex H3 cells (any order), return all H3 cells that overlap the
 * convex polygon they define.  Uses h3-js `containmentOverlapping` mode so
 * cells are included whenever any part of the cell (not just its centroid)
 * overlaps the polygon — matching the user expectation that a vertex cell is
 * always part of its polygon.
 */
export function computeCellsFromVertices(vertices: string[]): string[] {
  if (vertices.length < 3) return vertices

  const vPoints = vertices.map(v => cellToLatLng(v)) // [[lat, lng], ...]
  const cLat = vPoints.reduce((s, [la]) => s + la, 0) / vPoints.length
  const cLng = vPoints.reduce((s, [, lo]) => s + lo, 0) / vPoints.length

  // Sort by angle from centroid so the ring is non-self-intersecting
  const sorted = [...vPoints].sort((a, b) =>
    Math.atan2(a[0]! - cLat, a[1]! - cLng) - Math.atan2(b[0]! - cLat, b[1]! - cLng)
  )

  return polygonToCellsExperimental(
    [...sorted, sorted[0]!],           // closed ring in [lat, lng] format
    15,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
  )
}
