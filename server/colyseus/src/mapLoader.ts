import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Compass, ItemDefinition, ItemSidecar } from "@aie-matrix/shared-types";
import { COMPASS_DIRECTIONS } from "@aie-matrix/shared-types";
import { getResolution, isValidCell, localIjToCell } from "h3-js";
import { assignCompassToNeighbors } from "./hexCompass.js";
import type { CellId, CellRecord, LoadedMap } from "./mapTypes.js";
import { localIdFromGid, parseTsxTileset } from "./tilesetParser.js";

interface TmjProperty {
  name: string;
  type?: string;
  value: string | number | boolean | undefined;
}

interface TmjTilesetRef {
  firstgid: number;
  source: string;
}

interface TmjLayer {
  data: number[];
  width: number;
  height: number;
  name?: string;
}

interface TmjMap {
  width: number;
  height: number;
  layers?: TmjLayer[];
  tilesets?: TmjTilesetRef[];
  properties?: TmjProperty[];
}

export class MapLoadError extends Error {
  override readonly name = "MapLoadError";
  constructor(message: string) {
    super(message);
  }
}

function gidAt(map: TmjLayer, col: number, row: number): number {
  return map.data[row * map.width + col]!;
}

function getPropertyString(props: TmjProperty[] | undefined, name: string): string | undefined {
  const p = props?.find((x) => x.name === name);
  if (!p) {
    return undefined;
  }
  if (p.value === undefined || p.value === null) {
    return undefined;
  }
  return String(p.value).trim();
}

function getPropertyInt(props: TmjProperty[] | undefined, name: string): number | undefined {
  const p = props?.find((x) => x.name === name);
  if (!p || p.value === undefined || p.value === null) {
    return undefined;
  }
  if (typeof p.value === "number" && Number.isFinite(p.value)) {
    return p.value;
  }
  const n = parseInt(String(p.value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** When `type` is set on a Tiled custom property, it must match IC-009 (string vs int). */
function assertTiledPropertyType(
  props: TmjProperty[] | undefined,
  name: string,
  expectedType: string,
  mapLabel: string,
): void {
  const p = props?.find((x) => x.name === name);
  if (p && p.type !== undefined && p.type !== expectedType) {
    throw new MapLoadError(
      `${mapLabel}: property "${name}" must be Tiled type "${expectedType}" (got "${p.type}")`,
    );
  }
}

async function loadItemSidecar(
  tmAbsolutePath: string,
  itemsPath: string | undefined,
): Promise<Map<string, ItemDefinition>> {
  let sidecarPath: string;
  let explicitPath = false;

  if (itemsPath) {
    sidecarPath = itemsPath;
    explicitPath = true;
  } else {
    const base = basename(tmAbsolutePath, extname(tmAbsolutePath));
    sidecarPath = join(dirname(tmAbsolutePath), `${base}.items.json`);
  }

  try {
    await access(sidecarPath);
  } catch {
    if (explicitPath) {
      throw new MapLoadError(
        `AIE_MATRIX_ITEMS points to "${sidecarPath}" which does not exist`,
      );
    }
    return new Map();
  }

  const raw = await readFile(sidecarPath, "utf8");
  let parsed: ItemSidecar;
  try {
    parsed = JSON.parse(raw) as ItemSidecar;
  } catch {
    throw new MapLoadError(`${basename(sidecarPath)}: invalid JSON in items sidecar`);
  }

  const result = new Map<string, ItemDefinition>();
  for (const [ref, def] of Object.entries(parsed)) {
    result.set(ref, def);
  }
  return result;
}

/**
 * Load a Tiled `.tmj` hex map + external `.tsx` tileset and derive a compass-labeled graph
 * keyed by H3 res-15 indices. Optionally loads an `*.items.json` sidecar.
 */
export async function loadHexMap(
  tmAbsolutePath: string,
  options?: { itemsPath?: string },
): Promise<LoadedMap> {
  const mapLabel = basename(tmAbsolutePath);
  const raw = await readFile(tmAbsolutePath, "utf8");
  let tmj: TmjMap;
  try {
    tmj = JSON.parse(raw) as TmjMap;
  } catch {
    throw new MapLoadError(`${mapLabel}: invalid JSON`);
  }

  const itemSidecar = await loadItemSidecar(tmAbsolutePath, options?.itemsPath);

  const layer = tmj.layers?.[0];
  if (!layer?.data?.length) {
    throw new MapLoadError(`${mapLabel} missing tile layer data`);
  }
  if (layer.width !== tmj.width || layer.height !== tmj.height) {
    throw new MapLoadError(`${mapLabel}: layer width/height mismatch with map dimensions`);
  }

  assertTiledPropertyType(tmj.properties, "h3_anchor", "string", mapLabel);
  assertTiledPropertyType(tmj.properties, "h3_resolution", "int", mapLabel);

  const anchorRaw = getPropertyString(tmj.properties, "h3_anchor");
  if (anchorRaw === undefined || anchorRaw.length === 0) {
    throw new MapLoadError(
      `${mapLabel}: missing required map property h3_anchor (add a string custom property in Tiled, or see proposals/rfc/0004-h3-geospatial-coordinate-system.md)`,
    );
  }

  if (!isValidCell(anchorRaw)) {
    throw new MapLoadError(
      `${mapLabel}: h3_anchor "${anchorRaw}" is not a valid H3 cell index — generate one with h3.latLngToCell(lat, lng, 15)`,
    );
  }

  const resProp = getPropertyInt(tmj.properties, "h3_resolution");
  const resolution = resProp ?? 15;
  if (resolution !== 15) {
    throw new MapLoadError(
      `${mapLabel}: h3_resolution must be 15 (got ${resolution}). Only resolution 15 is supported.`,
    );
  }

  if (getResolution(anchorRaw) !== 15) {
    throw new MapLoadError(
      `${mapLabel}: h3_anchor must be a resolution-15 index (use h3-js latLngToCell(lat, lng, 15) to generate one)`,
    );
  }

  const tilesetRef = tmj.tilesets?.[0];
  if (!tilesetRef?.source || tilesetRef.firstgid === undefined) {
    throw new MapLoadError(`${mapLabel} missing tileset reference`);
  }
  const tsxPath = join(dirname(tmAbsolutePath), tilesetRef.source);
  const tsxXml = await readFile(tsxPath, "utf8");
  const tiles = parseTsxTileset(tsxXml);

  const anchorH3 = anchorRaw;

  const staged: {
    col: number;
    row: number;
    gid: number;
    tileClass: string;
    h3Index: string;
    capacity?: number;
    classItemRefs: string[];
  }[] = [];

  for (let row = 0; row < tmj.height; row++) {
    for (let col = 0; col < tmj.width; col++) {
      const gid = gidAt(layer, col, row);
      if (gid === 0) {
        continue;
      }
      const localId = localIdFromGid(gid, tilesetRef.firstgid);
      const tile = tiles.get(localId);
      if (!tile?.tileClass) {
        throw new MapLoadError(
          `${mapLabel}: missing tile class for gid ${gid} (local ${localId}) at col=${col} row=${row} — tileset ${tsxPath}`,
        );
      }
      let h3Index: string;
      try {
        h3Index = localIjToCell(anchorH3, { i: col, j: row });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new MapLoadError(`${mapLabel}: localIjToCell failed at col=${col} row=${row}: ${detail}`);
      }

      const capacityProp = tile.properties["capacity"];
      const capacity =
        capacityProp !== undefined && capacityProp !== ""
          ? parseInt(capacityProp, 10)
          : undefined;

      const itemsProp = tile.properties["items"];
      const classItemRefs: string[] = [];
      if (itemsProp) {
        for (const ref of itemsProp.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (itemSidecar.has(ref)) {
            classItemRefs.push(ref);
          } else {
            console.warn(
              `${mapLabel}: tile class "${tile.tileClass}" declares itemRef "${ref}" which is not in the items sidecar — skipping`,
            );
          }
        }
      }

      staged.push({ col, row, gid, tileClass: tile.tileClass, h3Index, capacity, classItemRefs });
    }
  }

  const navigable = new Set(staged.map((s) => s.h3Index));
  const graph = new Map<CellId, CellRecord>();

  for (const s of staged) {
    if (graph.has(s.h3Index)) {
      throw new MapLoadError(
        `${mapLabel}: duplicate H3 cell ${s.h3Index} at col=${s.col} row=${s.row}`,
      );
    }

    const bearing = assignCompassToNeighbors(s.h3Index);
    const neighbors: Partial<Record<Compass, CellId>> = {};
    for (const dir of COMPASS_DIRECTIONS) {
      const nh3 = bearing[dir];
      if (nh3 !== undefined && navigable.has(nh3)) {
        neighbors[dir] = nh3;
      }
    }

    const cell: CellRecord = {
      col: s.col,
      row: s.row,
      h3Index: s.h3Index,
      tileClass: s.tileClass,
      neighbors,
      initialItemRefs: [...s.classItemRefs],
    };
    if (s.capacity !== undefined) {
      cell.capacity = s.capacity;
    }
    graph.set(s.h3Index, cell);
  }

  // Item-placement layer: find by name, iterate same grid-to-H3 logic
  const placementLayer = tmj.layers?.find((l) => l.name === "item-placement");
  if (placementLayer) {
    for (let row = 0; row < tmj.height; row++) {
      for (let col = 0; col < tmj.width; col++) {
        const gid = gidAt(placementLayer, col, row);
        if (gid === 0) {
          continue;
        }
        const localId = localIdFromGid(gid, tilesetRef.firstgid);
        const tile = tiles.get(localId);
        if (!tile) {
          continue;
        }
        const ref = tile.tileClass;
        let h3Index: string;
        try {
          h3Index = localIjToCell(anchorH3, { i: col, j: row });
        } catch {
          continue;
        }
        const cell = graph.get(h3Index);
        if (!cell) {
          continue;
        }
        if (itemSidecar.has(ref)) {
          cell.initialItemRefs.push(ref);
        } else {
          console.warn(
            `${mapLabel}: item-placement layer references itemRef "${ref}" which is not in the items sidecar — skipping`,
          );
        }
      }
    }
  }

  return {
    width: tmj.width,
    height: tmj.height,
    anchorH3,
    cells: graph,
    itemSidecar,
  };
}
