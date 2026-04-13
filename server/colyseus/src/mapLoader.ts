import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Compass } from "@aie-matrix/shared-types";
import { COMPASS_DIRECTIONS } from "@aie-matrix/shared-types";
import { neighborOddq } from "./hexCompass.js";
import { makeCellId, type CellId, type CellRecord, type LoadedMap } from "./mapTypes.js";
import { localIdFromGid, parseTsxTileset } from "./tilesetParser.js";

interface TmjTilesetRef {
  firstgid: number;
  source: string;
}

interface TmjLayer {
  data: number[];
  width: number;
  height: number;
}

interface TmjMap {
  width: number;
  height: number;
  layers: TmjLayer[];
  tilesets: TmjTilesetRef[];
}

function gidAt(map: TmjLayer, col: number, row: number): number {
  return map.data[row * map.width + col];
}

/**
 * Load a Tiled `.tmj` hex map + external `.tsx` tileset and derive a compass-labeled graph.
 */
export async function loadHexMap(tmAbsolutePath: string): Promise<LoadedMap> {
  const raw = await readFile(tmAbsolutePath, "utf8");
  const tmj = JSON.parse(raw) as TmjMap;
  const layer = tmj.layers?.[0];
  if (!layer?.data?.length) {
    throw new Error(`Map ${tmAbsolutePath} missing tile layer data`);
  }
  if (layer.width !== tmj.width || layer.height !== tmj.height) {
    throw new Error("Layer width/height mismatch with map dimensions");
  }
  const tilesetRef = tmj.tilesets?.[0];
  if (!tilesetRef?.source || tilesetRef.firstgid === undefined) {
    throw new Error("Map missing tileset reference");
  }
  const tsxPath = join(dirname(tmAbsolutePath), tilesetRef.source);
  const tsxXml = await readFile(tsxPath, "utf8");
  const tiles = parseTsxTileset(tsxXml);

  const cells = new Map<CellId, { col: number; row: number; gid: number; tileClass: string }>();

  for (let row = 0; row < tmj.height; row++) {
    for (let col = 0; col < tmj.width; col++) {
      const gid = gidAt(layer, col, row);
      if (gid === 0) {
        continue;
      }
      const localId = localIdFromGid(gid, tilesetRef.firstgid);
      const tile = tiles.get(localId);
      if (!tile?.tileClass) {
        throw new Error(
          `Missing tile class for gid ${gid} (local ${localId}) at cell ${col},${row} — tileset ${tsxPath}`,
        );
      }
      cells.set(makeCellId(col, row), {
        col,
        row,
        gid,
        tileClass: tile.tileClass,
      });
    }
  }

  const graph = new Map<CellId, CellRecord>();

  for (const [id, cell] of cells) {
    const neighbors: Partial<Record<Compass, CellId>> = {};
    for (const dir of COMPASS_DIRECTIONS) {
      const { col: nc, row: nr } = neighborOddq(cell.col, cell.row, dir);
      if (nc < 0 || nr < 0 || nc >= tmj.width || nr >= tmj.height) {
        continue;
      }
      const ng = gidAt(layer, nc, nr);
      if (ng === 0) {
        continue;
      }
      const nid = makeCellId(nc, nr);
      if (!cells.has(nid)) {
        continue;
      }
      neighbors[dir] = nid;
    }
    graph.set(id, {
      col: cell.col,
      row: cell.row,
      tileClass: cell.tileClass,
      neighbors,
    });
  }

  return { width: tmj.width, height: tmj.height, cells: graph };
}
