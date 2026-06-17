import { parseMapGram } from "@aie-matrix/map-gram";
import type { ItemTypeDef } from "@aie-matrix/map-gram";
import { COMPASS_DIRECTIONS } from "@aie-matrix/shared-types";
import type { Compass } from "@aie-matrix/shared-types";
import { assignCompassToNeighbors } from "./hexCompass.js";
import type { CellId, CellRecord, LoadedMap } from "./mapTypes.js";

/**
 * Load a `.map.gram` text document into a `LoadedMap`.
 *
 * Cells get `col: 0, row: 0` since those fields are Tiled artefacts with no
 * meaning in gram-authored maps. All routing uses `h3Index` and `neighbors`.
 */
export async function loadGramMap(gramText: string): Promise<LoadedMap> {
  const parsed = await parseMapGram(gramText);

  // Build navigable cell set for neighbor filtering
  const allH3 = new Set(parsed.cells.keys());
  // Index tileTypes by typeName once to avoid O(cells × tileTypes) lookups in the loop below
  const tileTypeByName = new Map<string, import("@aie-matrix/map-gram").TileTypeDef>();
  for (const def of parsed.tileTypes.values()) {
    tileTypeByName.set(def.typeName, def);
  }
  const graph = new Map<CellId, CellRecord>();

  for (const [h3Index, parsedCell] of parsed.cells) {
    const bearing = assignCompassToNeighbors(h3Index);
    const neighbors: Partial<Record<Compass, CellId>> = {};
    for (const dir of COMPASS_DIRECTIONS) {
      const nh3 = bearing[dir];
      if (nh3 !== undefined && allH3.has(nh3)) {
        neighbors[dir] = nh3;
      }
    }

    const tileDef = tileTypeByName.get(parsedCell.tileType);
    const cell: CellRecord = {
      col: 0,
      row: 0,
      h3Index,
      tileClass: parsedCell.tileType,
      neighbors,
      initialItemRefs: parsedCell.items,
    };
    if (tileDef?.capacity !== undefined) {
      cell.capacity = tileDef.capacity;
    }
    graph.set(h3Index, cell);
  }

  // Build itemSidecar from ItemType declarations (keyed by typeName to match cell.items)
  const itemSidecar = new Map<string, ItemTypeDef>();
  for (const def of parsed.itemTypes.values()) {
    itemSidecar.set(def.typeName, def);
  }

  const anchorH3 = [...parsed.cells.keys()].sort()[0] ?? "";

  return {
    width: 0,
    height: 0,
    anchorH3,
    cells: graph,
    itemSidecar,
    portals: parsed.portals,
    itemPlacements: parsed.itemPlacements,
    spawnGrants: parsed.spawnGrants,
  };
}
