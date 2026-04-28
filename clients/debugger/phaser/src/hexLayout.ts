/**
 * Flat-top odd-q staggered-x layout (Tiled `staggeraxis: x`, `staggerindex: odd`).
 * Matches `server/colyseus/src/hexCompass.ts` / `server/world-api/README.md` grid indexing.
 */
export function cellTopLeft(
  col: number,
  row: number,
  tileWidth: number,
  tileHeight: number,
): { x: number; y: number } {
  const x = col * (tileWidth * 0.75);
  const y = row * tileHeight + (col % 2) * (tileHeight * 0.5);
  return { x, y };
}

export function cellCenter(
  col: number,
  row: number,
  tileWidth: number,
  tileHeight: number,
): { x: number; y: number } {
  const { x, y } = cellTopLeft(col, row, tileWidth, tileHeight);
  return { x: x + tileWidth * 0.5, y: y + tileHeight * 0.5 };
}
