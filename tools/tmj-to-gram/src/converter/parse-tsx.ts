import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

export interface TsxTileInfo {
  readonly localId: number;
  /** Tiled `type` attribute — tile class label or item ref key. */
  readonly typeLabel: string;
  readonly properties: Readonly<Record<string, string>>;
}

/** Local tile id → tile info for one .tsx file. */
export type TsxTileByLocalId = ReadonlyMap<number, TsxTileInfo>;

export async function parseTsxFile(path: string): Promise<TsxTileByLocalId> {
  const xml = await readFile(path, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const tileset = doc.tileset as Record<string, unknown> | undefined;
  if (!tileset) {
    throw new Error("TSX missing <tileset> root");
  }
  const tilesRaw = tileset.tile;
  const tilesArray = Array.isArray(tilesRaw) ? tilesRaw : tilesRaw ? [tilesRaw] : [];
  const byLocalId = new Map<number, TsxTileInfo>();

  for (const t of tilesArray) {
    const tile = t as Record<string, unknown>;
    const idAttr = tile["@_id"];
    if (idAttr === undefined) {
      continue;
    }
    const localId = Number(idAttr);
    if (!Number.isFinite(localId)) {
      continue;
    }
    const typeAttr = tile["@_type"];
    if (typeof typeAttr !== "string" || typeAttr.length === 0) {
      throw new Error(`Tile local id ${localId} missing Tiled type`);
    }
    const properties: Record<string, string> = {};
    const props = tile.properties as { property?: unknown } | undefined;
    if (props?.property) {
      const propList = Array.isArray(props.property) ? props.property : [props.property];
      for (const p of propList) {
        const pr = p as Record<string, unknown>;
        const name = pr["@_name"];
        const value = pr["@_value"];
        if (typeof name === "string" && value !== undefined) {
          properties[name] = String(value);
        }
      }
    }
    byLocalId.set(localId, { localId, typeLabel: typeAttr, properties });
  }

  return byLocalId;
}

export interface TilesetSlice {
  readonly firstgid: number;
  readonly sourcePath: string;
  readonly tiles: TsxTileByLocalId;
}

export function localIdFromGid(gid: number, firstgid: number): number {
  return gid - firstgid;
}

/** Pick the tileset ref with the greatest `firstgid` such that `firstgid <= gid`. */
export function resolveTilesetForGid(slices: readonly TilesetSlice[], gid: number): TilesetSlice | undefined {
  if (gid === 0) {
    return undefined;
  }
  let best: TilesetSlice | undefined;
  for (const s of slices) {
    if (gid >= s.firstgid) {
      if (!best || s.firstgid > best.firstgid) {
        best = s;
      }
    }
  }
  return best;
}

export function resolveGidToTypeLabel(slices: readonly TilesetSlice[], gid: number): TsxTileInfo | undefined {
  const slice = resolveTilesetForGid(slices, gid);
  if (!slice) {
    return undefined;
  }
  const local = localIdFromGid(gid, slice.firstgid);
  return slice.tiles.get(local);
}
