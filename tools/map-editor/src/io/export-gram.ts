import type { MapEditorState } from "../state/editor-state"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return JSON.stringify(s)
}

function slugId(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function h3Lit(index: string): string {
  return `h3\`${index.replace(/^0[xX]/, "").toLowerCase()}\``
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function headerSection(state: MapEditorState): string {
  const { meta } = state
  const parts = [`kind: "matrix-map"`, `name: ${esc(meta.name)}`, `elevation: ${meta.elevation}`]
  if (meta.description) parts.splice(2, 0, `description: ${esc(meta.description)}`)
  return `{ ${parts.join(", ")} }`
}

function tileTypeSection(state: MapEditorState): string {
  return state.tileTypes
    .map(t => {
      const id = slugId(t.id)
      const parts: string[] = [`name: ${esc(t.name)}`]
      if (t.description) parts.push(`description: ${esc(t.description)}`)
      if (t.capacity !== undefined) parts.push(`capacity: ${t.capacity}`)
      if (t.style) parts.push(`style: css\`${t.style}\``)
      return `(${id}:TileType:${t.typeName} { ${parts.join(", ")} })`
    })
    .join("\n")
}

function itemTypeSection(state: MapEditorState): string {
  if (state.itemTypes.length === 0) return ""
  return state.itemTypes
    .map(t => {
      const id = slugId(t.id)
      const parts: string[] = [`name: ${esc(t.name)}`]
      if (t.description) parts.push(`description: ${esc(t.description)}`)
      if (t.glyph) parts.push(`glyph: char\`${t.glyph}\``)
      parts.push(`takeable: ${t.takeable}`)
      if (t.capacityCost !== undefined) parts.push(`capacityCost: ${t.capacityCost}`)
      if (t.style) parts.push(`style: css\`${t.style}\``)
      return `(${id}:ItemType:${t.typeName} { ${parts.join(", ")} })`
    })
    .join("\n")
}

function layerSection(state: MapEditorState): string {
  const lines: string[] = []
  const layerIds: string[] = []

  for (const layer of state.layers) {
    const layerId = slugId(layer.id)
    const elements: string[] = []

    if (layer.kind === "polygon") {
      for (const poly of layer.committed) {
        // geometry = defining vertices (corners); cells are derived and not stored
        const geomCells = poly.vertices?.length ? poly.vertices : poly.cells
        const verts = geomCells.map(v => h3Lit(v)).join(", ")
        elements.push(`(:Polygon:${poly.typeName} { geometry: [${verts}] })`)
      }
    } else if (layer.kind === "tile") {
      for (const tile of layer.tiles.values()) {
        const idx = tile.h3Index.replace(/^0[xX]/, "").toLowerCase()
        elements.push(`(:Tile:${tile.typeName} { geometry: [${h3Lit(idx)}] })`)
      }
      for (const portal of layer.portals) {
        const from = portal.fromH3.replace(/^0[xX]/, "").toLowerCase()
        const to = portal.toH3.replace(/^0[xX]/, "").toLowerCase()
        elements.push(`(:Portal { geometry: [${h3Lit(from)}, ${h3Lit(to)}], mode: ${esc(portal.mode)} })`)
      }
    } else if (layer.kind === "items") {
      for (const item of layer.items) {
        const idx = item.h3Index.replace(/^0[xX]/, "").toLowerCase()
        elements.push(`(:Item:${item.typeName} { geometry: [${h3Lit(idx)}] })`)
      }
    }

    const nameAttr = layer.name !== layer.id ? `, name: ${esc(layer.name)}` : ""
    const elemStr = elements.length > 0 ? ` | ${elements.join(", ")}` : ""
    lines.push(`[${layerId}:Layer {kind: "${layer.kind}"${nameAttr}}${elemStr}]`)
    layerIds.push(layerId)
  }

  if (layerIds.length > 0) {
    lines.push(`[layers:LayerStack | ${layerIds.join(", ")}]`)
  }

  return lines.join("\n")
}

function rulesSection(state: MapEditorState): string {
  if (state.rules.length === 0) return ""
  const typeNameToId = new Map(state.tileTypes.map(t => [t.typeName, slugId(t.id)]))
  const elements = state.rules.map(r => {
    const fromId = typeNameToId.get(r.fromTypeName) ?? slugId(r.fromTypeName)
    const toId = typeNameToId.get(r.toTypeName) ?? slugId(r.toTypeName)
    return `(${fromId})-[:GO]->(${toId})`
  })
  return `[rules:Rules | ${elements.join(", ")}]`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function exportGram(state: MapEditorState): string {
  const sections = [
    headerSection(state),
    tileTypeSection(state),
    itemTypeSection(state),
    layerSection(state),
    rulesSection(state),
  ].filter(s => s.length > 0)

  return sections.join("\n\n") + "\n"
}
