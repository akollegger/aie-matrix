import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { WorldTile } from "../types/worldTile.js";

/** H3 focus ring (single cell) or 7+ cluster; FR-019, Neighbour scale. */
export function createSelectionH3Layer(
  h3List: readonly string[],
  viewTiles: ReadonlyMap<string, WorldTile>,
  options: { id?: string } = {},
): H3HexagonLayer<WorldTile> {
  const data: WorldTile[] = [];
  for (const h3 of h3List) {
    const t = viewTiles.get(h3);
    if (t) {
      data.push(t);
    } else {
      data.push({
        h3Index: h3,
        tileType: "open",
        items: Object.freeze([]),
        neighbors: Object.freeze([]),
      });
    }
  }
  return new H3HexagonLayer<WorldTile>({
    id: options.id ?? "selection-hex",
    data,
    pickable: false,
    extruded: false,
    getHexagon: (d) => d.h3Index,
    stroked: true,
    filled: true,
    getFillColor: [255, 200, 60, 35] as [number, number, number, number],
    getLineColor: [255, 220, 80, 255] as [number, number, number, number],
    getLineWidth: 2,
    lineWidthMinPixels: 2,
  });
}
