/**
 * Tiled {@link https://github.com/mapeditor/tiled/blob/master/src/libtiled/hexagonalrenderer.cpp HexagonalRenderer}
 * pixel ↔ tile math for `staggeraxis: "x"` hex maps (pointy-top staggered columns).
 */

import { cellToLatLng, gridRing } from "h3-js";

export interface HexRenderParams {
  readonly staggerEven: boolean;
  readonly sideLengthX: number;
  readonly sideLengthY: number;
  readonly sideOffsetX: number;
  readonly sideOffsetY: number;
  readonly columnWidth: number;
  readonly rowHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export function hexRenderParams(
  tileWidth: number,
  tileHeight: number,
  hexSideLength: number,
  staggeraxis: "x" | "y",
  staggerindex: "odd" | "even",
): HexRenderParams | undefined {
  if (staggeraxis !== "x") {
    return undefined;
  }
  const staggerEven = staggerindex === "even";
  const sideLengthX = hexSideLength;
  const sideLengthY = 0;
  const sideOffsetX = (tileWidth - sideLengthX) / 2;
  const sideOffsetY = (tileHeight - sideLengthY) / 2;
  const columnWidth = sideOffsetX + sideLengthX;
  const rowHeight = sideOffsetY + sideLengthY;
  const tw = columnWidth + sideOffsetX;
  const th = rowHeight + sideOffsetY;
  if (columnWidth <= 0 || rowHeight <= 0 || tw <= 0 || th <= 0) {
    return undefined;
  }
  return {
    staggerEven,
    sideLengthX,
    sideLengthY,
    sideOffsetX,
    sideOffsetY,
    columnWidth,
    rowHeight,
    tileWidth: tw,
    tileHeight: th,
  };
}

function doStaggerX(col: number, p: HexRenderParams): boolean {
  return Boolean((col & 1) ^ (p.staggerEven ? 1 : 0));
}

/** Top-left pixel of the tile's bounding rect (same as Tiled `tileToScreenCoords`). */
export function tileToScreenOrigin(col: number, row: number, p: HexRenderParams): { x: number; y: number } {
  let pixelY = row * (p.tileHeight + p.sideLengthY);
  if (doStaggerX(col, p)) {
    pixelY += p.rowHeight;
  }
  const pixelX = col * p.columnWidth;
  return { x: pixelX, y: pixelY };
}

/** Eight vertices of the hex in screen space, winding order matching Tiled. */
export function tileToScreenPolygon(col: number, row: number, p: HexRenderParams): Array<{ x: number; y: number }> {
  const topRight = tileToScreenOrigin(col, row, p);
  const { x: ox, y: oy } = topRight;
  return [
    { x: ox + 0, y: oy + p.rowHeight },
    { x: ox + 0, y: oy + p.sideOffsetY },
    { x: ox + p.sideOffsetX, y: oy + 0 },
    { x: ox + p.columnWidth, y: oy + 0 },
    { x: ox + p.tileWidth, y: oy + p.sideOffsetY },
    { x: ox + p.tileWidth, y: oy + p.rowHeight },
    { x: ox + p.columnWidth, y: oy + p.tileHeight },
    { x: ox + p.sideOffsetX, y: oy + p.tileHeight },
  ];
}

function lengthSquared(ax: number, ay: number): number {
  return ax * ax + ay * ay;
}

function pointInPolygon(px: number, py: number, poly: ReadonlyArray<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const dy = yj - yi;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (Math.abs(dy) < 1e-12 ? 1e-12 : dy) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/** All map tiles whose Tiled hex contains the pixel (for gutter / boundary detection). */
export function tilesContainingPixel(
  px: number,
  py: number,
  mapWidth: number,
  mapHeight: number,
  p: HexRenderParams,
): Array<{ col: number; row: number }> {
  const hits: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      if (pointInPolygon(px, py, tileToScreenPolygon(col, row, p))) {
        hits.push({ col, row });
      }
    }
  }
  return hits;
}

function pointNearPolygon(px: number, py: number, poly: ReadonlyArray<{ x: number; y: number }>, eps: number): boolean {
  if (pointInPolygon(px, py, poly)) {
    return true;
  }
  for (const q of poly) {
    if (lengthSquared(px - q.x, py - q.y) <= eps * eps) {
      return true;
    }
  }
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[i]!.x;
    const ay = poly[i]!.y;
    const bx = poly[j]!.x;
    const by = poly[j]!.y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-18) {
      continue;
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const nx = ax + t * dx;
    const ny = ay + t * dy;
    if (lengthSquared(px - nx, py - ny) <= eps * eps) {
      return true;
    }
  }
  return false;
}

/** Pixels — vertices may sit just outside the strict polygon from float authoring; match Tiled tolerance. */
const EDGE_SNAP_EPS = 4;

/**
 * Map pixel → grid `(col,row)`; strict point-in-hex first, then a small pixel tolerance so Tiled vertices
 * on shared hex edges (or sub-pixel float noise) still resolve deterministically.
 */
export function resolvePixelToColRow(
  px: number,
  py: number,
  mapWidth: number,
  mapHeight: number,
  p: HexRenderParams,
): { col: number; row: number } | "gutter" {
  const hits = tilesContainingPixel(px, py, mapWidth, mapHeight, p);
  if (hits.length > 0) {
    hits.sort((a, b) => (a.col !== b.col ? a.col - b.col : a.row - b.row));
    return hits[0]!;
  }

  const nearHits: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      if (pointNearPolygon(px, py, tileToScreenPolygon(col, row, p), EDGE_SNAP_EPS)) {
        nearHits.push({ col, row });
      }
    }
  }
  if (nearHits.length === 0) {
    return "gutter";
  }
  nearHits.sort((a, b) => (a.col !== b.col ? a.col - b.col : a.row - b.row));
  return nearHits[0]!;
}

/**
 * Pre-builds and returns a lookup: Tiled (col, row) → H3 index at resolution 15.
 *
 * Establishes a pixel-direction → H3-ring-index mapping once from the anchor cell
 * (using only `cellToLatLng` and `gridRing`, no `latLngToCell`), then traverses the
 * grid in row-major order with pure `gridRing` neighbour lookups.  Because each step
 * always moves to an adjacent H3 cell there are no metric-scale collisions.
 */
export function makeTileToH3(
  hexP: HexRenderParams,
  h3Anchor: string,
  mapWidth: number,
  mapHeight: number,
): (col: number, row: number) => string | null {
  // Build pixel-direction → ring-index map from the anchor's 6 neighbours.
  // gridRing returns neighbours in consistent IJ order within a face; the same
  // index therefore names the same geographic direction for every cell in the grid.
  const ring = gridRing(h3Anchor, 1);
  const [anchorLat, anchorLng] = cellToLatLng(h3Anchor);
  const cosLat = Math.cos((anchorLat * Math.PI) / 180);

  const dirToRingIdx = new Map<string, number>();
  for (let i = 0; i < ring.length; i++) {
    const [nLat, nLng] = cellToLatLng(ring[i]!);
    // Screen-space direction: x = east (+lng), y = south (-lat)
    const sx = (nLng - anchorLng) * cosLat;
    const sy = anchorLat - nLat;
    const mag = Math.hypot(sx, sy);

    // Match to one of the 6 Tiled pixel-step directions
    const candidates: [number, number][] = [
      [hexP.columnWidth, hexP.rowHeight],
      [hexP.columnWidth, -hexP.rowHeight],
      [-hexP.columnWidth, hexP.rowHeight],
      [-hexP.columnWidth, -hexP.rowHeight],
      [0, hexP.tileHeight],
      [0, -hexP.tileHeight],
    ];
    let bestKey = "";
    let bestCos = -Infinity;
    for (const [dx, dy] of candidates) {
      const cos = (sx * dx + sy * dy) / (mag * Math.hypot(dx, dy));
      if (cos > bestCos) {
        bestCos = cos;
        bestKey = `${dx},${dy}`;
      }
    }
    if (bestKey && !dirToRingIdx.has(bestKey)) {
      dirToRingIdx.set(bestKey, i);
    }
  }

  // Traverse in row-major order: each tile steps from its left (or top) neighbour
  // using the ring index that corresponds to that pixel direction.
  const lookup = new Map<string, string>();
  lookup.set("0,0", h3Anchor);

  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      if (col === 0 && row === 0) continue;

      const [prevCol, prevRow] = col > 0 ? [col - 1, row] : [0, row - 1];
      const prevH3 = lookup.get(`${prevCol},${prevRow}`);
      if (prevH3 === undefined) continue;

      const prevOrigin = tileToScreenOrigin(prevCol, prevRow, hexP);
      const curOrigin = tileToScreenOrigin(col, row, hexP);
      const dx = curOrigin.x - prevOrigin.x;
      const dy = curOrigin.y - prevOrigin.y;

      const ringIdx = dirToRingIdx.get(`${dx},${dy}`);
      if (ringIdx === undefined) continue;

      const next = gridRing(prevH3, 1)[ringIdx];
      if (next !== undefined) {
        lookup.set(`${col},${row}`, next);
      }
    }
  }

  return (col, row) => lookup.get(`${col},${row}`) ?? null;
}

/**
 * Pre-builds a reverse lookup: H3 index → Tiled (col, row) for every tile in the map.
 * Used by renderers that need to position items back in screen space.
 */
export function makeH3ToTile(
  hexP: HexRenderParams,
  h3Anchor: string,
  mapWidth: number,
  mapHeight: number,
): (h3: string) => { readonly col: number; readonly row: number } | null {
  const tileToH3 = makeTileToH3(hexP, h3Anchor, mapWidth, mapHeight);
  const lookup = new Map<string, { col: number; row: number }>();
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      const h3 = tileToH3(col, row);
      if (h3 !== null) lookup.set(h3, { col, row });
    }
  }
  return (h3) => lookup.get(h3) ?? null;
}
