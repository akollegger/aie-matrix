import { Gram } from "@relateby/pattern";
import { Effect, HashMap, HashSet, Option } from "effect";
import { isValidCell } from "h3-js";
import { computeCellsFromVertices } from "./expand-polygon.js";
import type {
  ItemTypeDef,
  ParsedCell,
  ParsedMap,
  ParsedPortal,
  ParsedRule,
  TileTypeDef,
} from "./types.js";
import { MapGramParseError } from "./types.js";

// ---------------------------------------------------------------------------
// AST helpers (mirrors tools/map-editor/src/io/import-gram.ts)
// ---------------------------------------------------------------------------

type PropMap = HashMap.HashMap<
  string,
  { _tag: string; value?: unknown; content?: string; tag?: string; items?: ReadonlyArray<unknown> }
>;

const CATEGORY_LABELS = new Set([
  "TileType", "ItemType", "Tile", "Polygon", "Item", "Portal",
  "Layer", "LayerStack", "Rules",
]);

function getNonCategoryLabel(labels: HashSet.HashSet<string>): string | undefined {
  for (const l of HashSet.values(labels)) {
    if (!CATEGORY_LABELS.has(l)) return l;
  }
  return undefined;
}

function strProp(props: PropMap, key: string): string | undefined {
  const v = HashMap.get(props, key);
  if (Option.isNone(v) || v.value._tag !== "StringVal") return undefined;
  return v.value.value as string;
}

function intProp(props: PropMap, key: string): number | undefined {
  const v = HashMap.get(props, key);
  if (Option.isNone(v) || v.value._tag !== "IntVal") return undefined;
  return v.value.value as number;
}

function boolProp(props: PropMap, key: string): boolean | undefined {
  const v = HashMap.get(props, key);
  if (Option.isNone(v) || v.value._tag !== "BoolVal") return undefined;
  return v.value.value as boolean;
}

function cssTagProp(props: PropMap, key: string): string | undefined {
  const v = HashMap.get(props, key);
  if (Option.isNone(v) || v.value._tag !== "TaggedStringVal" || (v.value.tag as string) !== "css") return undefined;
  return v.value.content as string;
}

function charTagProp(props: PropMap, key: string): string | undefined {
  const v = HashMap.get(props, key);
  if (Option.isNone(v) || v.value._tag !== "TaggedStringVal" || (v.value.tag as string) !== "char") return undefined;
  return v.value.content as string;
}

function getH3Array(props: PropMap): string[] {
  const v = HashMap.get(props, "geometry");
  if (Option.isNone(v) || v.value._tag !== "ArrayVal") return [];
  const result: string[] = [];
  for (const item of v.value.items as ReadonlyArray<{ _tag: string; tag?: string; content?: string }>) {
    if (item._tag === "TaggedStringVal" && item.tag === "h3" && item.content) {
      result.push(item.content);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal layer representation
// ---------------------------------------------------------------------------

type LayerKind = "polygon" | "tile" | "items";

interface LayerData {
  kind: LayerKind;
  cells: Map<string, string>; // h3Index → tileType
  items: Map<string, string[]>; // h3Index → [itemTypeName, ...]
  portals: ParsedPortal[];
}

// ---------------------------------------------------------------------------
// Public parse function
// ---------------------------------------------------------------------------

/**
 * Parse a `.map.gram` text document into a structured map representation.
 *
 * Performs Gram validation, walks the AST, expands polygon fills, and applies
 * layers in LayerStack order (polygon fill → tile override → items overlay).
 *
 * @throws {MapGramParseError} for gram syntax errors, missing LayerStack, or
 *   invalid H3 indices. Polygons with bad vertex counts are warned and skipped.
 */
export async function parseMapGram(gramText: string): Promise<ParsedMap> {
  // Step 1: parse the gram document
  let parseResult: { header: Record<string, unknown> | null; patterns: Array<unknown> };
  try {
    parseResult = await Effect.runPromise(
      Gram.parseWithHeader(gramText) as Effect.Effect<
        { header: Record<string, unknown> | null; patterns: Array<unknown> }
      >,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new MapGramParseError("gram-syntax", msg);
  }

  const { header, patterns } = parseResult;

  const name = typeof header?.["name"] === "string" ? header["name"] : "unnamed";
  const elevation = typeof header?.["elevation"] === "number" ? header["elevation"] : 0;

  const tileTypes = new Map<string, TileTypeDef>();
  const itemTypes = new Map<string, ItemTypeDef>();

  const layersById = new Map<string, LayerData>();
  const layerOrder: string[] = [];
  const ruleRefs: Array<{ fromId: string; toId: string }> = [];

  // Step 2: walk all top-level patterns
  for (const rawPattern of patterns) {
    const pattern = rawPattern as {
      value: { identity: string; labels: HashSet.HashSet<string>; properties: PropMap };
      elements: Array<{
        value: { identity: string; labels: HashSet.HashSet<string>; properties: PropMap };
        elements: Array<{ value: { identity: string } }>;
      }>;
    };

    const subject = pattern.value;
    const labels = subject.labels;
    const props = subject.properties;
    const id = subject.identity;

    // TileType declarations
    if (HashSet.has(labels, "TileType")) {
      const typeName = getNonCategoryLabel(labels);
      if (!typeName) continue;
      const desc = strProp(props, "description");
      const capacity = intProp(props, "capacity");
      const style = cssTagProp(props, "style");
      tileTypes.set(id, {
        identity: id,
        typeName,
        name: strProp(props, "name") ?? typeName,
        ...(desc !== undefined ? { description: desc } : {}),
        ...(capacity !== undefined ? { capacity } : {}),
        ...(style !== undefined ? { style } : {}),
      });

    // ItemType declarations
    } else if (HashSet.has(labels, "ItemType")) {
      const typeName = getNonCategoryLabel(labels);
      if (!typeName) continue;
      const desc = strProp(props, "description");
      const glyph = charTagProp(props, "glyph");
      const takeable = boolProp(props, "takeable");
      const capacityCost = intProp(props, "capacityCost");
      itemTypes.set(id, {
        identity: id,
        typeName,
        name: strProp(props, "name") ?? typeName,
        ...(desc !== undefined ? { description: desc } : {}),
        ...(glyph !== undefined ? { glyph } : {}),
        ...(takeable !== undefined ? { takeable } : {}),
        ...(capacityCost !== undefined ? { capacityCost } : {}),
      });

    // LayerStack — collect ordered layer IDs
    } else if (HashSet.has(labels, "LayerStack")) {
      for (const elemPattern of pattern.elements) {
        const elemId = elemPattern.value.identity;
        if (elemId) layerOrder.push(elemId);
      }

    // Rules — collect (fromTypeId)-[:GO]->(toTypeId) pairs
    } else if (HashSet.has(labels, "Rules")) {
      for (const elemPattern of pattern.elements) {
        if (elemPattern.elements.length === 2) {
          const fromId = elemPattern.elements[0]?.value.identity ?? "";
          const toId = elemPattern.elements[1]?.value.identity ?? "";
          if (fromId && toId) ruleRefs.push({ fromId, toId });
        }
      }

    // Layer walks — collect elements per layer
    } else if (HashSet.has(labels, "Layer")) {
      const walkId = id;
      const kindStr = strProp(props, "kind") ?? "tile";
      const kind: LayerKind =
        kindStr === "polygon" ? "polygon" : kindStr === "items" ? "items" : "tile";

      const layerData: LayerData = {
        kind,
        cells: new Map(),
        items: new Map(),
        portals: [],
      };

      for (const elemPattern of pattern.elements) {
        const elem = elemPattern.value;
        if (elem.identity !== "") continue; // only anonymous nodes
        const elemLabels = elem.labels;
        const elemProps = elem.properties;
        const h3s = getH3Array(elemProps);

        if (HashSet.has(elemLabels, "Tile")) {
          // Individual tile override
          const typeName = getNonCategoryLabel(elemLabels);
          if (!typeName || h3s.length === 0) continue;
          const h3 = h3s[0]!;
          if (!isValidCell(h3)) throw new MapGramParseError("invalid-h3", `Invalid H3 index: ${h3}`);
          layerData.cells.set(h3, typeName);

        } else if (HashSet.has(elemLabels, "Polygon")) {
          // Polygon fill — expand vertices to cells
          const typeName = getNonCategoryLabel(elemLabels);
          if (!typeName) continue;
          if (h3s.length < 3) {
            console.warn(`[map-gram] Polygon:${typeName} has ${h3s.length} vertices (minimum 3) — skipped`);
            continue;
          }
          for (const h3 of h3s) {
            if (!isValidCell(h3)) throw new MapGramParseError("invalid-h3", `Invalid H3 index in Polygon:${typeName}: ${h3}`);
          }
          const filled = computeCellsFromVertices(h3s);
          if (filled.length === 0) {
            console.warn(`[map-gram] Polygon:${typeName} produced 0 cells — skipped`);
            continue;
          }
          for (const h3 of filled) {
            layerData.cells.set(h3, typeName);
          }

        } else if (HashSet.has(elemLabels, "Portal")) {
          if (h3s.length < 2) continue;
          const fromCell = h3s[0]!;
          const toCell = h3s[1]!;
          if (!isValidCell(fromCell) || !isValidCell(toCell)) {
            throw new MapGramParseError("invalid-h3", `Invalid H3 index in Portal: ${fromCell} or ${toCell}`);
          }
          layerData.portals.push({
            fromCell,
            toCell,
            mode: strProp(elemProps, "mode") ?? "Door",
          });

        } else if (HashSet.has(elemLabels, "Item")) {
          const typeName = getNonCategoryLabel(elemLabels);
          if (!typeName || h3s.length === 0) continue;
          const h3 = h3s[0]!;
          if (!isValidCell(h3)) throw new MapGramParseError("invalid-h3", `Invalid H3 index in Item:${typeName}: ${h3}`);
          const existing = layerData.items.get(h3) ?? [];
          existing.push(typeName);
          layerData.items.set(h3, existing);
        }
      }

      layersById.set(walkId, layerData);
    }
  }

  // Step 3: require LayerStack
  if (layerOrder.length === 0) {
    throw new MapGramParseError(
      "missing-layer-stack",
      "No LayerStack found in .map.gram document — add [layers:LayerStack | ...] declaring the layer order",
    );
  }

  // Step 4: resolve movement rules
  const rules: ParsedRule[] = [];
  for (const { fromId, toId } of ruleRefs) {
    const fromType = tileTypes.get(fromId);
    const toType = tileTypes.get(toId);
    if (fromType && toType) {
      rules.push({ fromType: fromType.identity, toType: toType.identity });
    }
  }

  // Step 5: apply layers in LayerStack order
  const cells = new Map<string, ParsedCell>();
  const portals: ParsedPortal[] = [];

  const orderedLayers = layerOrder
    .map((layerId) => layersById.get(layerId))
    .filter((l): l is LayerData => l != null);

  for (const layer of orderedLayers) {
    // Apply cells (tile overrides win over earlier polygon fills)
    for (const [h3, tileType] of layer.cells) {
      const existing = cells.get(h3);
      if (existing) {
        existing.tileType = tileType;
      } else {
        cells.set(h3, { h3Index: h3, tileType, items: [] });
      }
    }
    // Attach items (creates implicit "open" cell if needed)
    for (const [h3, itemNames] of layer.items) {
      let cell = cells.get(h3);
      if (!cell) {
        cell = { h3Index: h3, tileType: "open", items: [] };
        cells.set(h3, cell);
      }
      cell.items.push(...itemNames);
    }
    // Collect portals
    portals.push(...layer.portals);
  }

  return { name, elevation, tileTypes, itemTypes, cells, portals, rules };
}
