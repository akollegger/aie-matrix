import type { CellEmission } from "./cell-emission.js";
import type { ItemInstanceEmission, ItemTypeEntry } from "./item-emission.js";

export interface SerializeGramInput {
  readonly mapId: string;
  readonly elevation: number;
  /** Tile type labels in first-encounter order (IC-001 determinism). */
  readonly tileTypeOrder: readonly string[];
  readonly tileMeta: ReadonlyMap<string, { readonly color?: string }>;
  readonly itemTypes: readonly ItemTypeEntry[];
  readonly polygonLines: readonly string[];
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

function cellLine(c: CellEmission): string {
  return `(${c.id}:${c.typeLabel} { location: ${formatH3LocationLiteral(c.h3Index)} })`;
}

function itemInstLine(i: ItemInstanceEmission): string {
  return `(${i.id}:${i.typeLabel} { location: ${formatH3LocationLiteral(i.h3Index)} })`;
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

  if (input.polygonLines.length > 0) {
    sections.push(input.polygonLines.join("\n"));
  }

  const cellLines = [...input.cells].map(cellLine);
  if (cellLines.length > 0) {
    sections.push(cellLines.join("\n"));
  }

  const instLines = input.items.map(itemInstLine);
  if (instLines.length > 0) {
    sections.push(instLines.join("\n"));
  }

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
