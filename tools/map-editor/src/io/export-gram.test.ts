import { describe, expect, it } from "vitest"
import { editorReducer, makeInitialState } from "../state/editor-reducer"
import { h3Index } from "../types/map-gram"
import { exportGram } from "./export-gram"

describe("exportGram", () => {
  it("outputs a valid matrix-map header", () => {
    const state = makeInitialState()
    const output = exportGram(state)
    expect(output).toContain('kind: "matrix-map"')
    expect(output).toContain('name: "untitled-map"')
    expect(output).toContain("elevation: 0")
  })

  it("includes the built-in Floor TileType definition as a named node", () => {
    const state = makeInitialState()
    const output = exportGram(state)
    expect(output).toMatch(/\(floor:TileType:Floor \{[^)]+\}\)/)
  })

  it("includes two TileType definitions when two types exist", () => {
    const s2 = editorReducer(makeInitialState(), {
      type: "CREATE_TILE_TYPE",
      tileType: { id: "carpet", typeName: "Carpet", name: "Carpet" },
    })
    const output = exportGram(s2)
    expect(output).toMatch(/\(floor:TileType:Floor/)
    expect(output).toMatch(/\(carpet:TileType:Carpet/)
  })

  it("emits the initial tile layer walk even when empty", () => {
    const state = makeInitialState()
    const output = exportGram(state)
    expect(output).toContain('[ground:Layer {kind: "tile"')
    expect(output).toContain("[layers:LayerStack | ground]")
  })

  it("emits a tile Layer walk with inline Tile element per painted cell", () => {
    const cell = h3Index("8f283082aa20c00")
    const state = editorReducer(makeInitialState(), { type: "PAINT_CELL", h3: cell })
    const output = exportGram(state)
    expect(output).toContain('[ground:Layer {kind: "tile"')
    expect(output).toContain(":Tile:Floor")
    expect(output).toContain("geometry: [h3`8f283082aa20c00`]")
    // No standalone tile node declaration
    expect(output).not.toMatch(/\(tile-8f283082aa20c00/)
  })

  it("emits a polygon Layer walk with inline Polygon element", () => {
    const v1 = h3Index("8f283082aa20c00")
    const v2 = h3Index("8f283082aa20c01")
    const v3 = h3Index("8f283082aa20c02")
    let state = makeInitialState()
    // Add a polygon layer (auto-activates)
    state = editorReducer(state, { type: "ADD_LAYER", kind: "polygon", name: "Regions" })
    state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: v1 })
    state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: v2 })
    state = editorReducer(state, { type: "ADD_POLYGON_VERTEX", h3: v3 })
    state = editorReducer(state, { type: "CONFIRM_POLYGON" })
    const output = exportGram(state)
    // Layer walk uses the layer ID (auto-generated uid), name "Regions" → check kind
    expect(output).toContain('kind: "polygon"')
    expect(output).toContain(":Polygon:Floor")
    expect(output).toContain("h3`8f283082aa20c00`")
    // LayerStack includes both ground and the polygon layer
    expect(output).toContain("[layers:LayerStack | ground,")
  })

  it("emits a Portal inline in the tile Layer with 2-element geometry", () => {
    let state = makeInitialState()
    state = editorReducer(state, { type: "PAINT_CELL", h3: h3Index("8f283082aa20c00") })
    state = editorReducer(state, { type: "PAINT_CELL", h3: h3Index("8f283082aa20c01") })
    state = editorReducer(state, { type: "SELECT_PORTAL_FROM", h3: h3Index("8f283082aa20c00") })
    state = editorReducer(state, { type: "CREATE_PORTAL", h3: h3Index("8f283082aa20c01") })
    const output = exportGram(state)
    expect(output).toContain(":Portal")
    expect(output).toContain("geometry: [h3`8f283082aa20c00`, h3`8f283082aa20c01`]")
    // No standalone portal relationship syntax
    expect(output).not.toContain(")-[:Portal")
  })

  it("includes a LayerStack ordering all layers bottom to top", () => {
    let state = makeInitialState()
    state = editorReducer(state, { type: "PAINT_CELL", h3: h3Index("8f283082aa20c00") })
    state = editorReducer(state, {
      type: "CREATE_ITEM_TYPE",
      itemType: { id: "key", typeName: "Key", name: "Key", glyph: "🔑", takeable: true },
    })
    // Add items layer (auto-activates) then place item
    state = editorReducer(state, { type: "ADD_LAYER", kind: "items", name: "Items" })
    state = editorReducer(state, { type: "SET_ACTIVE_TYPE", typeId: "key" })
    state = editorReducer(state, { type: "PLACE_ITEM", h3: h3Index("8f283082aa20c00"), itemTypeName: "Key" })
    const output = exportGram(state)
    // Ground tile layer (index 0) then items layer; slugId of items layer uid is the auto-id
    expect(output).toContain("[layers:LayerStack | ground,")
  })
})
