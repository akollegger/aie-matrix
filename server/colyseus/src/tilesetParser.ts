import { XMLParser } from "fast-xml-parser";

export interface ParsedTile {
  localTileId: number;
  tileClass: string;
  properties: Record<string, string>;
}

export function parseTsxTileset(xml: string): Map<number, ParsedTile> {
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
  const tilesArray = Array.isArray(tilesRaw)
    ? tilesRaw
    : tilesRaw
      ? [tilesRaw]
      : [];

  const byLocalId = new Map<number, ParsedTile>();

  for (const t of tilesArray) {
    const tile = t as Record<string, unknown>;
    const idAttr = tile["@_id"];
    if (idAttr === undefined) {
      continue;
    }
    const localId = Number(idAttr);
    const typeAttr = tile["@_type"];
    if (typeof typeAttr !== "string" || typeAttr.length === 0) {
      throw new Error(
        `Tile local id ${localId} missing Tiled type (tileClass)`,
      );
    }
    const properties: Record<string, string> = {};
    const props = tile.properties as { property?: unknown } | undefined;
    if (props?.property) {
      const propList = Array.isArray(props.property)
        ? props.property
        : [props.property];
      for (const p of propList) {
        const pr = p as Record<string, unknown>;
        const name = pr["@_name"];
        const value = pr["@_value"];
        if (typeof name === "string" && value !== undefined) {
          properties[name] = String(value);
        }
      }
    }
    byLocalId.set(localId, {
      localTileId: localId,
      tileClass: typeAttr,
      properties,
    });
  }

  return byLocalId;
}

export function localIdFromGid(gid: number, firstGid: number): number {
  return gid - firstGid;
}
