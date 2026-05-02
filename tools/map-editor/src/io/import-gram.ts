import { Gram } from "@relateby/pattern"
import { Effect, HashMap, HashSet, Option } from "effect"
import { computeCellsFromVertices } from "../map/polygon-geometry"
import { makeInitialState } from "../state/editor-reducer"
import type {
  ItemsLayerState,
  MapEditorState,
  MapLayer,
  PolygonLayerState,
  TileLayerState,
} from "../state/editor-state"
import type { ItemType, MovementRule, Portal, TileType } from "../types/map-gram"
import { h3Index } from "../types/map-gram"

export interface ImportResult {
  state: MapEditorState
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = new Set([
  "TileType", "ItemType", "Tile", "Polygon", "Item", "Portal", "Layer", "LayerStack",
])

function getNonCategoryLabel(labels: HashSet.HashSet<string>): string | undefined {
  for (const l of HashSet.values(labels)) {
    if (!CATEGORY_LABELS.has(l)) return l
  }
  return undefined
}

type Props = HashMap.HashMap<string, { _tag: string; value?: unknown; content?: string; tag?: string; items?: ReadonlyArray<unknown> }>

function strProp(props: Props, key: string): string | undefined {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "StringVal") return undefined
  return v.value.value as string
}

function intProp(props: Props, key: string): number | undefined {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "IntVal") return undefined
  return v.value.value as number
}

function boolProp(props: Props, key: string): boolean | undefined {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "BoolVal") return undefined
  return v.value.value as boolean
}

function cssTagProp(props: Props, key: string): string | undefined {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "TaggedStringVal" || v.value.tag !== "css") return undefined
  return v.value.content as string
}

function charTagProp(props: Props, key: string): string | undefined {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "TaggedStringVal" || v.value.tag !== "char") return undefined
  return v.value.content as string
}

function getH3ArrayByKey(props: Props, key: string): string[] {
  const v = HashMap.get(props, key)
  if (Option.isNone(v) || v.value._tag !== "ArrayVal") return []
  const result: string[] = []
  for (const item of v.value.items as ReadonlyArray<{ _tag: string; tag?: string; content?: string }>) {
    if (item._tag === "TaggedStringVal" && item.tag === "h3" && item.content) {
      result.push(item.content)
    }
  }
  return result
}

function getH3Array(props: Props): string[] {
  return getH3ArrayByKey(props, "geometry")
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function importGram(text: string): Promise<ImportResult> {
  const base = makeInitialState()
  const warnings: string[] = []

  const { header, patterns } = await Effect.runPromise(Gram.parseWithHeader(text))

  if (header) {
    if (header["kind"] !== "matrix-map") {
      warnings.push(`Unexpected kind: ${String(header["kind"])}`)
    }
    const name = typeof header["name"] === "string" ? header["name"] : base.meta.name
    const description = typeof header["description"] === "string" ? header["description"] : undefined
    const elevation = typeof header["elevation"] === "number" ? header["elevation"] : 0
    base.meta = { kind: "matrix-map", name, elevation, ...(description ? { description } : {}) }
  } else {
    warnings.push("No valid header found")
  }

  const seenTileTypes = new Map<string, TileType>()
  const itemTypes: ItemType[] = []
  let portalCounter = 0

  // First pass: collect type definitions and build layers
  const layersById = new Map<string, MapLayer>()
  const layerOrder: string[] = []
  const collectedRuleIds: { fromId: string; toId: string }[] = []

  for (const pattern of patterns) {
    const subject = pattern.value
    const labels = subject.labels
    const props = subject.properties as unknown as Props

    if (HashSet.has(labels, "TileType")) {
      const id = subject.identity
      const typeName = getNonCategoryLabel(labels)
      if (!typeName) { warnings.push(`TileType node ${id} has no type label`); continue }
      seenTileTypes.set(id, {
        id,
        typeName,
        name: strProp(props, "name") ?? typeName,
        ...(strProp(props, "description") !== undefined ? { description: strProp(props, "description") } : {}),
        ...(intProp(props, "capacity") !== undefined ? { capacity: intProp(props, "capacity") } : {}),
        ...(cssTagProp(props, "style") !== undefined ? { style: cssTagProp(props, "style") } : {}),
      })

    } else if (HashSet.has(labels, "ItemType")) {
      const id = subject.identity
      const typeName = getNonCategoryLabel(labels)
      if (!typeName) { warnings.push(`ItemType node ${id} has no type label`); continue }
      itemTypes.push({
        id,
        typeName,
        name: strProp(props, "name") ?? typeName,
        glyph: charTagProp(props, "glyph") ?? "?",
        takeable: boolProp(props, "takeable") ?? false,
        ...(strProp(props, "description") !== undefined ? { description: strProp(props, "description") } : {}),
        ...(intProp(props, "capacityCost") !== undefined ? { capacityCost: intProp(props, "capacityCost") } : {}),
        ...(cssTagProp(props, "style") !== undefined ? { style: cssTagProp(props, "style") } : {}),
      })

    } else if (HashSet.has(labels, "LayerStack")) {
      for (const elemPattern of pattern.elements) {
        const elemId = elemPattern.value.identity
        if (elemId) layerOrder.push(elemId)
      }

    } else if (HashSet.has(labels, "Rules")) {
      // Each element is a relationship: (fromId)-[:GO]->(toId)
      // Relationship patterns have exactly 2 sub-elements: source and target nodes
      for (const elemPattern of pattern.elements) {
        if (elemPattern.elements.length === 2) {
          const fromId = elemPattern.elements[0]?.value.identity ?? ""
          const toId = elemPattern.elements[1]?.value.identity ?? ""
          if (fromId && toId) collectedRuleIds.push({ fromId, toId })
        }
      }

    } else if (HashSet.has(labels, "Layer")) {
      const walkId = subject.identity
      const kindProp = strProp(props, "kind") ?? "tile"
      const nameProp = strProp(props, "name") ?? walkId

      // Accumulators for this layer
      const tiles = new Map<ReturnType<typeof h3Index>, import("../types/map-gram").TileInstance>()
      const portals: Portal[] = []
      const polygons: import("../types/map-gram").PolygonShape[] = []
      const items: import("../types/map-gram").ItemInstance[] = []

      for (const elemPattern of pattern.elements) {
        const elem = elemPattern.value
        if (elem.identity !== "") continue
        const elemLabels = elem.labels
        const elemProps = elem.properties as unknown as Props
        const h3s = getH3Array(elemProps)

        if (HashSet.has(elemLabels, "Tile")) {
          const typeName = getNonCategoryLabel(elemLabels)
          if (!typeName) { warnings.push("Tile element has no type label — skipped"); continue }
          if (h3s.length === 0) { warnings.push(`Tile:${typeName} has no geometry — skipped`); continue }
          const idx = h3Index(h3s[0]!)
          tiles.set(idx, { h3Index: idx, typeName })

        } else if (HashSet.has(elemLabels, "Polygon")) {
          const typeName = getNonCategoryLabel(elemLabels)
          if (!typeName) { warnings.push("Polygon element has no type label — skipped"); continue }
          if (h3s.length < 3) {
            warnings.push(`Polygon:${typeName} has fewer than 3 vertices — skipped`)
            continue
          }
          // geometry contains the defining vertices; sides derived from vertex count
          const sides = h3s.length
          const vertices = h3s.map(h3Index)
          const cells = computeCellsFromVertices(h3s).map(h3Index)
          polygons.push({ id: `poly-${uid()}`, typeName, cells, sides, vertices })

        } else if (HashSet.has(elemLabels, "Portal")) {
          if (h3s.length < 2) { warnings.push("Portal has fewer than 2 geometry entries — skipped"); continue }
          const mode = strProp(elemProps, "mode") ?? "Door"
          const portal: Portal = {
            id: `portal-${++portalCounter}`,
            fromH3: h3Index(h3s[0]!),
            toH3: h3Index(h3s[1]!),
            mode,
          }
          portals.push(portal)

        } else if (HashSet.has(elemLabels, "Item")) {
          const typeName = getNonCategoryLabel(elemLabels)
          if (!typeName) { warnings.push("Item element has no type label — skipped"); continue }
          if (h3s.length === 0) { warnings.push(`Item:${typeName} has no geometry — skipped`); continue }
          const idx = h3Index(h3s[0]!)
          items.push({ id: `item-${uid()}`, typeName, h3Index: idx })
        }
      }

      let layer: MapLayer
      if (kindProp === "polygon") {
        layer = { id: walkId, name: nameProp, kind: "polygon", visible: true, locked: false, committed: polygons } as PolygonLayerState
      } else if (kindProp === "items") {
        layer = { id: walkId, name: nameProp, kind: "items", visible: true, locked: false, items } as ItemsLayerState
      } else {
        layer = { id: walkId, name: nameProp, kind: "tile", visible: true, locked: false, tiles, portals } as TileLayerState
      }
      layersById.set(walkId, layer)
    }
  }

  // Resolve movement rules
  const rules: MovementRule[] = []
  for (const { fromId, toId } of collectedRuleIds) {
    const fromType = seenTileTypes.get(fromId)
    const toType = seenTileTypes.get(toId)
    if (fromType && toType) {
      rules.push({ fromTypeName: fromType.typeName, toTypeName: toType.typeName })
    } else {
      warnings.push(`Rule references unknown type: ${fromId} -> ${toId}`)
    }
  }
  if (rules.length > 0) base.rules = rules

  // Apply type definitions
  if (seenTileTypes.size > 0) {
    const incomingFloor = seenTileTypes.get("floor")
    base.tileTypes = incomingFloor
      ? Array.from(seenTileTypes.values())
      : [base.tileTypes[0]!, ...Array.from(seenTileTypes.values())]
  }
  base.itemTypes = itemTypes

  // Apply layers in LayerStack order (or pattern order if no LayerStack)
  if (layersById.size > 0) {
    const ordered = layerOrder.length > 0
      ? layerOrder.map(id => layersById.get(id)).filter((l): l is MapLayer => l != null)
      : Array.from(layersById.values())
    if (ordered.length > 0) {
      base.layers = ordered
      // Activate the topmost layer
      const topLayer = ordered[ordered.length - 1]!
      base.ui = {
        ...base.ui,
        activeLayerId: topLayer.id,
        activeTool: topLayer.kind === "polygon" ? "polygon" : topLayer.kind === "items" ? "place-item" : "paint",
      }
    }
  }

  return { state: base, warnings }
}
