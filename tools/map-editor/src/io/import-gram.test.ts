import { describe, expect, it } from "vitest"
import { editorReducer, makeInitialState } from "../state/editor-reducer"
import type { ItemsLayerState, PolygonLayerState, TileLayerState } from "../state/editor-state"
import { h3Index } from "../types/map-gram"
import { exportGram } from "./export-gram"
import { importGram } from "./import-gram"

const CELL_A = h3Index("8f283082aa20c00")
const CELL_B = h3Index("8f283082aa20c01")
const CELL_C = h3Index("8f283082aa20c02")

function buildTestState() {
  let state = makeInitialState() // "ground" tile layer active
  state = editorReducer(state, { type: "UPDATE_META", payload: { name: "test-map", elevation: 2 } })
  state = editorReducer(state, {
    type: "CREATE_TILE_TYPE",
    tileType: { id: "carpet", typeName: "Carpet", name: "Carpet", style: "background: #336" },
  })
  // Paint tiles on the ground tile layer
  state = editorReducer(state, { type: "PAINT_CELL", h3: CELL_A })
  state = editorReducer(state, { type: "SET_ACTIVE_TYPE", typeId: "carpet" })
  state = editorReducer(state, { type: "PAINT_CELL", h3: CELL_B })
  // Add a polygon layer and confirm a polygon
  state = editorReducer(state, { type: "ADD_LAYER", kind: "polygon", name: "Regions" })
  state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: CELL_A })
  state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: CELL_B })
  state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: CELL_C })
  state = editorReducer(state, { type: "CONFIRM_POLYGON" })
  return state
}

describe("round-trip export → import", () => {
  it("preserves map metadata", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    expect(imported.meta.name).toBe("test-map")
    expect(imported.meta.elevation).toBe(2)
  })

  it("preserves tile type count", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    expect(imported.tileTypes.length).toBe(original.tileTypes.length)
  })

  it("preserves explicit tile instances", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    const origTileLayer = original.layers.find(l => l.kind === "tile") as TileLayerState
    const importedTileLayer = imported.layers.find(l => l.kind === "tile") as TileLayerState
    expect(importedTileLayer.tiles.size).toBe(origTileLayer.tiles.size)
  })

  it("preserves polygon shapes", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    const importedPolyLayer = imported.layers.find(l => l.kind === "polygon") as PolygonLayerState
    expect(importedPolyLayer.committed.length).toBe(1)
    // cells are recomputed from vertices on import; count ≥ vertex count
    expect(importedPolyLayer.committed[0]!.cells.length).toBeGreaterThanOrEqual(3)
  })

  it("returns no warnings for clean gram", async () => {
    const original = makeInitialState()
    const gram = exportGram(original)
    const { warnings } = await importGram(gram)
    expect(warnings).toHaveLength(0)
  })

  it("preserves portal relationships", async () => {
    let state = makeInitialState()
    state = editorReducer(state, { type: "PAINT_CELL", h3: CELL_A })
    state = editorReducer(state, { type: "PAINT_CELL", h3: CELL_B })
    state = editorReducer(state, { type: "SELECT_PORTAL_FROM", h3: CELL_A })
    state = editorReducer(state, { type: "CREATE_PORTAL", h3: CELL_B })
    const gram = exportGram(state)
    const { state: imported } = await importGram(gram)
    const tileLayer = imported.layers.find(l => l.kind === "tile") as TileLayerState
    expect(tileLayer.portals).toHaveLength(1)
    expect(tileLayer.portals[0]!.mode).toBe("Door")
    expect(tileLayer.portals[0]!.fromH3).toBe(CELL_A)
    expect(tileLayer.portals[0]!.toH3).toBe(CELL_B)
  })

  it("preserves tile type style as raw CSS content", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    const carpet = imported.tileTypes.find(t => t.id === "carpet")
    expect(carpet).toBeDefined()
    expect(carpet!.style).toBe("background: #336")
  })

  it("preserves layer count", async () => {
    const original = buildTestState()
    const gram = exportGram(original)
    const { state: imported } = await importGram(gram)
    expect(imported.layers.length).toBe(original.layers.length)
  })
})

describe("importGram — inline gram", () => {
  it("imports tiles from a Layer walk with kind: tile", async () => {
    const gram = `{ kind: "matrix-map", name: "direct", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[tiles:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f283082aa20c00\`] }), (:Tile:Floor { geometry: [h3\`8f283082aa20c01\`] })]
[layers:LayerStack | tiles]
`
    const { state } = await importGram(gram)
    const tileLayer = state.layers.find(l => l.kind === "tile") as TileLayerState
    expect(tileLayer.tiles.size).toBe(2)
    const polyLayer = state.layers.find(l => l.kind === "polygon") as PolygonLayerState | undefined
    expect(polyLayer?.committed ?? []).toHaveLength(0)
  })

  it("imports polygons from a Layer walk with kind: polygon", async () => {
    const gram = `{ kind: "matrix-map", name: "poly-test", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[regions:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3\`8f283082aa20c00\`, h3\`8f283082aa20c01\`, h3\`8f283082aa20c02\`] })]
[layers:LayerStack | regions]
`
    const { state } = await importGram(gram)
    const polyLayer = state.layers.find(l => l.kind === "polygon") as PolygonLayerState
    expect(polyLayer.committed).toHaveLength(1)
    // 3 vertices → cells recomputed; at minimum all 3 vertex cells are included
    expect(polyLayer.committed[0]!.cells.length).toBeGreaterThanOrEqual(3)
  })

  it("imports portals from 2-element geometry in a tile Layer", async () => {
    const gram = `{ kind: "matrix-map", name: "portal-test", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[tiles:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f283082aa20c00\`] }), (:Tile:Floor { geometry: [h3\`8f283082aa20c01\`] }), (:Portal { geometry: [h3\`8f283082aa20c00\`, h3\`8f283082aa20c01\`], mode: "Elevator" })]
[layers:LayerStack | tiles]
`
    const { state } = await importGram(gram)
    const tileLayer = state.layers.find(l => l.kind === "tile") as TileLayerState
    expect(tileLayer.portals).toHaveLength(1)
    expect(tileLayer.portals[0]!.mode).toBe("Elevator")
    expect(tileLayer.portals[0]!.fromH3).toBe("8f283082aa20c00")
    expect(tileLayer.portals[0]!.toH3).toBe("8f283082aa20c01")
  })

  it("warns and skips polygon with fewer than 3 vertices", async () => {
    const gram = `{ kind: "matrix-map", name: "bad-poly", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[regions:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3\`8f283082aa20c00\`, h3\`8f283082aa20c01\`] })]
[layers:LayerStack | regions]
`
    const { state, warnings } = await importGram(gram)
    const polyLayer = state.layers.find(l => l.kind === "polygon") as PolygonLayerState
    expect(polyLayer.committed).toHaveLength(0)
    expect(warnings.some(w => w.includes("3 vertices"))).toBe(true)
  })

  it("warns when no header is found", async () => {
    const { warnings } = await importGram("(a:Node)")
    expect(warnings.some(w => w.toLowerCase().includes("header"))).toBe(true)
  })

  it("imports items from a Layer walk with kind: items", async () => {
    const gram = `{ kind: "matrix-map", name: "items-test", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })
(brassKey:ItemType:BrassKey { name: "Brass Key", glyph: char\`🔑\`, takeable: true })

[collectibles:Layer {kind: "items"} | (:Item:BrassKey { geometry: [h3\`8f283082aa20c00\`] })]
[layers:LayerStack | collectibles]
`
    const { state } = await importGram(gram)
    const itemsLayer = state.layers.find(l => l.kind === "items") as ItemsLayerState
    expect(itemsLayer.items).toHaveLength(1)
    expect(itemsLayer.items[0]!.typeName).toBe("BrassKey")
  })
})
