import type { CellEmission } from "./cell-emission.js";
import type { ItemInstanceEmission, ItemTypeEntry } from "./item-emission.js";

/** Minimal polygon area data needed by the serializer (subset of TileAreaPolygon). */
interface TileAreaInput {
  readonly id: number;
  readonly typeLabel: string;
  readonly vertexCells: readonly string[];
  readonly layoutShapeHexes: ReadonlySet<string>;
}

export interface SerializeGramInput {
  readonly mapId: string;
  readonly elevation: number;
  /** Tile type labels in first-encounter order (IC-001 determinism). */
  readonly tileTypeOrder: readonly string[];
  readonly tileMeta: ReadonlyMap<string, { readonly color?: string }>;
  readonly itemTypes: readonly ItemTypeEntry[];
  /** Polygon tile areas from Tiled; each emitted as a Polygon element in the polygon Layer. */
  readonly tileAreas: readonly TileAreaInput[];
  /** Layout cells NOT implied by any polygon (cell.h3Index not in any tileArea.layoutShapeHexes). */
  readonly cells: readonly CellEmission[];
  readonly items: readonly ItemInstanceEmission[];
}

function slugTypeId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function esc(s: string): string {
  return JSON.stringify(s);
}

/** H3 cell id as `TaggedStringVal`-compatible surface form (`h3` + backticks). */
export function formatH3LocationLiteral(h3Index: string): string {
  const hex = h3Index.replace(/^0[xX]/, "").toLowerCase();
  return `h3\`${hex}\``;
}

function tileTypeLine(label: string, meta: ReadonlyMap<string, { readonly color?: string }>): string {
  const id = slugTypeId(label);
  const m = meta.get(label) ?? {};
  const parts: string[] = [`name: ${esc(label)}`];
  if (m.color !== undefined && m.color.length > 0) {
    parts.push(`color: ${esc(m.color)}`);
  }
  return `(${id}:TileType:${label} { ${parts.join(", ")} })`;
}

function itemTypeLine(e: ItemTypeEntry): string {
  const parts: string[] = [`name: ${esc(e.name)}`];
  if (e.color !== undefined && e.color.length > 0) {
    parts.push(`color: ${esc(e.color)}`);
  }
  if (e.glyph !== undefined && e.glyph.length > 0) {
    parts.push(`glyph: ${esc(e.glyph)}`);
  }
  return `(${e.typeId}:ItemType:${e.label} { ${parts.join(", ")} })`;
}

function polygonLayerSection(areas: readonly TileAreaInput[]): string {
  const elements = areas.map((area) => {
    const geom = area.vertexCells.map(formatH3LocationLiteral).join(", ");
    return `(:Polygon:${area.typeLabel} { geometry: [${geom}] })`;
  });
  return `[polygons:Layer {kind: "polygon", name: "Polygons"} | ${elements.join(", ")}]`;
}

function tileLayerSection(cells: readonly CellEmission[]): string {
  const elements = cells.map((c) => `(:Tile:${c.typeLabel} { geometry: [${formatH3LocationLiteral(c.h3Index)}] })`);
  return `[tiles:Layer {kind: "tile", name: "Tiles"} | ${elements.join(", ")}]`;
}

function itemsLayerSection(items: readonly ItemInstanceEmission[]): string {
  const elements = items.map((i) => `(:Item:${i.typeLabel} { geometry: [${formatH3LocationLiteral(i.h3Index)}] })`);
  return `[items:Layer {kind: "items", name: "Items"} | ${elements.join(", ")}]`;
}

function layerStackSection(layerIds: readonly string[]): string {
  return `[layers:LayerStack | ${layerIds.join(", ")}]`;
}

function rulesSection(tileTypeOrder: readonly string[]): string {
  const ruleLines = tileTypeOrder.map((label) => {
    const id = slugTypeId(label);
    return `(${id})-[:GO]->(${id})`;
  });
  return `[rules:Rules | ${ruleLines.join(", ")}]`;
}

export function serializeGram(input: SerializeGramInput): string {
  const header = `{ kind: "matrix-map", name: ${esc(input.mapId)}, elevation: ${input.elevation} }`;
  const sections: string[] = [header];

  const tileLines = input.tileTypeOrder.map((label) => tileTypeLine(label, input.tileMeta));
  if (tileLines.length > 0) {
    sections.push(tileLines.join("\n"));
  }

  const itLines = input.itemTypes.map(itemTypeLine);
  if (itLines.length > 0) {
    sections.push(itLines.join("\n"));
  }

  // Collect all H3 cells implied by polygons (these are omitted from the tile layer)
  const impliedByPolygon = new Set<string>();
  for (const area of input.tileAreas) {
    for (const h3 of area.layoutShapeHexes) {
      impliedByPolygon.add(h3);
    }
  }

  // Determine which layout cells are NOT covered by any polygon
  const standaloneCell = input.cells.filter((c) => !impliedByPolygon.has(c.h3Index));

  // Build and collect layer IDs in order
  const layerIds: string[] = [];

  if (input.tileAreas.length > 0) {
    sections.push(polygonLayerSection(input.tileAreas));
    layerIds.push("polygons");
  }

  if (standaloneCell.length > 0) {
    sections.push(tileLayerSection(standaloneCell));
    layerIds.push("tiles");
  }

  if (input.items.length > 0) {
    sections.push(itemsLayerSection(input.items));
    layerIds.push("items");
  }

  sections.push(layerStackSection(layerIds));
  sections.push(rulesSection(input.tileTypeOrder));

  return sections.join("\n\n") + "\n";
}

export function buildTileMetaFromSlices(
  slices: readonly { readonly tiles: ReadonlyMap<number, { readonly typeLabel: string; readonly properties: Readonly<Record<string, string>> }> }[],
): Map<string, { color?: string }> {
  const meta = new Map<string, { color?: string }>();
  for (const s of slices) {
    for (const t of s.tiles.values()) {
      if (!meta.has(t.typeLabel)) {
        const c = t.properties.color;
        meta.set(t.typeLabel, c !== undefined && c.length > 0 ? { color: c } : {});
      }
    }
  }
  return meta;
}
