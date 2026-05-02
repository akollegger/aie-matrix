/**
 * Sanity-check the @relateby/pattern Gram API against map-editor's gram dialect.
 *
 * These tests exercise the underlying WASM parser/serialiser so we have
 * confidence that the gram format produced by export-gram.ts is correctly
 * parsed by the library, and that the Gram API primitives work as expected.
 */
import { Gram, StandardGraph } from "@relateby/pattern"
import { Effect, HashMap, HashSet } from "effect"
import { describe, expect, it } from "vitest"
import { editorReducer, makeInitialState } from "../state/editor-reducer"
import { h3Index } from "../types/map-gram"
import { exportGram } from "./export-gram"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parse(input: string) {
  return Effect.runPromise(Gram.parse(input))
}

// ---------------------------------------------------------------------------
// parse / stringify smoke tests
// ---------------------------------------------------------------------------

describe("Gram.parse", () => {
  it("returns an empty array for an empty string", async () => {
    const patterns = await parse("")
    expect(patterns).toHaveLength(0)
  })

  it("parses a single node with identity and label", async () => {
    const patterns = await parse("(floor:Floor)")
    expect(patterns).toHaveLength(1)
    const subject = patterns[0]!.value
    expect(subject.identity).toBe("floor")
    expect(HashSet.has(subject.labels, "Floor")).toBe(true)
  })

  it("parses multiple labels on a node", async () => {
    const patterns = await parse("(floor:TileType:Floor)")
    expect(patterns).toHaveLength(1)
    const subject = patterns[0]!.value
    expect(HashSet.has(subject.labels, "TileType")).toBe(true)
    expect(HashSet.has(subject.labels, "Floor")).toBe(true)
  })

  it("parses a string property", async () => {
    const patterns = await parse('(floor:Floor { name: "Floor" })')
    const props = patterns[0]!.value.properties
    const nameVal = HashMap.get(props, "name")
    expect(nameVal._tag).toBe("Some")
    if (nameVal._tag === "Some") {
      expect(nameVal.value._tag).toBe("StringVal")
      if (nameVal.value._tag === "StringVal") {
        expect(nameVal.value.value).toBe("Floor")
      }
    }
  })

  it("parses an integer property", async () => {
    const patterns = await parse("(map:Map { elevation: 3 })")
    const props = patterns[0]!.value.properties
    const elVal = HashMap.get(props, "elevation")
    expect(elVal._tag).toBe("Some")
    if (elVal._tag === "Some") {
      expect(elVal.value._tag).toBe("IntVal")
      if (elVal.value._tag === "IntVal") {
        expect(elVal.value.value).toBe(3)
      }
    }
  })

  it("parses an h3 tagged-string value", async () => {
    const patterns = await parse("(cell:Floor { location: h3`8f283082aa20c00` })")
    const props = patterns[0]!.value.properties
    const locVal = HashMap.get(props, "location")
    expect(locVal._tag).toBe("Some")
    if (locVal._tag === "Some") {
      expect(locVal.value._tag).toBe("TaggedStringVal")
      if (locVal.value._tag === "TaggedStringVal") {
        expect(locVal.value.tag).toBe("h3")
        expect(locVal.value.content).toBe("8f283082aa20c00")
      }
    }
  })

  it("parses a css tagged-string value", async () => {
    const patterns = await parse("(t:TileType { style: css`background: #336` })")
    const props = patterns[0]!.value.properties
    const styleVal = HashMap.get(props, "style")
    expect(styleVal._tag).toBe("Some")
    if (styleVal._tag === "Some") {
      expect(styleVal.value._tag).toBe("TaggedStringVal")
      if (styleVal.value._tag === "TaggedStringVal") {
        expect(styleVal.value.tag).toBe("css")
        expect(styleVal.value.content).toBe("background: #336")
      }
    }
  })

  it("parses a directed relationship", async () => {
    const patterns = await parse(
      '(a:Cell)(b:Cell)(a)-[:Portal { mode: "Door" }]->(b)'
    )
    expect(patterns).toHaveLength(3)
    // The relationship pattern is the third element; the walk's subject carries
    // the relationship label from the edge.
    const graph = StandardGraph.fromPatterns(patterns)
    expect(graph.nodeCount).toBe(2)
    expect(graph.relationshipCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Gram.validate
// ---------------------------------------------------------------------------

describe("Gram.validate", () => {
  it("succeeds silently for valid gram", async () => {
    await expect(
      Effect.runPromise(Gram.validate("(a:Node { x: 1 })"))
    ).resolves.toBeUndefined()
  })

  it("rejects visibly invalid gram", async () => {
    await expect(
      Effect.runPromise(Gram.validate("(unclosed node"))
    ).rejects.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Gram.parseWithHeader / stringifyWithHeader — matrix-map dialect
// ---------------------------------------------------------------------------

describe("Gram.parseWithHeader — matrix-map dialect", () => {
  const MINIMAL_MAP = `{ kind: "matrix-map", name: "test-map", elevation: 2 }

(floor:TileType:Floor { name: "Floor" })

[tiles:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f283082aa20c00\`] })]
[layers:LayerStack | tiles]
`

  it("extracts kind, name, and elevation from the header", async () => {
    const { header } = await Effect.runPromise(Gram.parseWithHeader(MINIMAL_MAP))
    expect(header).toBeDefined()
    expect(header!["kind"]).toBe("matrix-map")
    expect(header!["name"]).toBe("test-map")
    expect(header!["elevation"]).toBe(2)
  })

  it("returns the TileType node in patterns", async () => {
    const { patterns } = await Effect.runPromise(Gram.parseWithHeader(MINIMAL_MAP))
    const graph = StandardGraph.fromPatterns(patterns)
    const floorNode = graph.node("floor")
    expect(floorNode._tag).toBe("Some")
  })

  it("returns the tiles Layer pattern with one Tile element", async () => {
    const { patterns } = await Effect.runPromise(Gram.parseWithHeader(MINIMAL_MAP))
    const tilesPattern = patterns.find(p =>
      p.value.identity === "tiles" && HashSet.has(p.value.labels, "Layer")
    )
    expect(tilesPattern).toBeDefined()
    if (tilesPattern) {
      expect(tilesPattern.elements.length).toBe(1)
      expect(HashSet.has(tilesPattern.elements[0]!.value.labels, "Tile")).toBe(true)
    }
  })

  it("returns undefined header when no leading bare record", async () => {
    const { header } = await Effect.runPromise(
      Gram.parseWithHeader("(a:Node)")
    )
    expect(header).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Integration: exportGram output → Gram API validation and parsing
//
// The map-editor builds gram strings by hand (export-gram.ts). These tests
// confirm that the hand-built output is accepted by the Gram WASM parser,
// which is the real source of truth for the gram format.
// ---------------------------------------------------------------------------

describe("exportGram output → Gram.validate", () => {
  it("accepts the minimal initial state gram", async () => {
    const gram = exportGram(makeInitialState())
    await expect(Effect.runPromise(Gram.validate(gram))).resolves.toBeUndefined()
  })

  it("accepts gram with a custom tile type with a style", async () => {
    const state = editorReducer(makeInitialState(), {
      type: "CREATE_TILE_TYPE",
      // style stores raw CSS content; export-gram wraps it as css`...`
      tileType: { id: "carpet", typeName: "Carpet", name: "Carpet", style: "background: #336" },
    })
    const gram = exportGram(state)
    await expect(Effect.runPromise(Gram.validate(gram))).resolves.toBeUndefined()
  })

  it("accepts gram with painted cells (h3 tagged location)", async () => {
    const cell = h3Index("8f283082aa20c00")
    const state = editorReducer(makeInitialState(), { type: "PAINT_CELL", h3: cell })
    const gram = exportGram(state)
    await expect(Effect.runPromise(Gram.validate(gram))).resolves.toBeUndefined()
  })

  it("accepts gram with a portal relationship", async () => {
    let state = makeInitialState()
    state = editorReducer(state, { type: "SELECT_PORTAL_FROM", h3: h3Index("8f283082aa20c00") })
    state = editorReducer(state, { type: "CREATE_PORTAL", h3: h3Index("8f283082aa20c01") })
    const gram = exportGram(state)
    await expect(Effect.runPromise(Gram.validate(gram))).resolves.toBeUndefined()
  })
})

describe("exportGram output → Gram.parseWithHeader", () => {
  it("parses map header fields from exportGram output", async () => {
    let state = makeInitialState()
    state = editorReducer(state, {
      type: "UPDATE_META",
      payload: { name: "convention-floor", elevation: 3 },
    })
    const gram = exportGram(state)
    const { header } = await Effect.runPromise(Gram.parseWithHeader(gram))
    expect(header).toBeDefined()
    expect(header!["name"]).toBe("convention-floor")
    expect(header!["elevation"]).toBe(3)
    expect(header!["kind"]).toBe("matrix-map")
  })

  it("parses tile type nodes from exportGram output", async () => {
    let state = makeInitialState()
    state = editorReducer(state, {
      type: "CREATE_TILE_TYPE",
      tileType: { id: "carpet", typeName: "Carpet", name: "Carpet" },
    })
    const gram = exportGram(state)
    const { patterns } = await Effect.runPromise(Gram.parseWithHeader(gram))
    const graph = StandardGraph.fromPatterns(patterns)
    expect(graph.node("floor")._tag).toBe("Some")
    expect(graph.node("carpet")._tag).toBe("Some")
  })

  it("parses tile element with h3 geometry from Layer pattern in exportGram output", async () => {
    const cell = h3Index("8f283082aa20c00")
    const state = editorReducer(makeInitialState(), { type: "PAINT_CELL", h3: cell })
    const gram = exportGram(state)
    const { patterns } = await Effect.runPromise(Gram.parseWithHeader(gram))
    // The initial layer has id "ground"
    const tilesPattern = patterns.find(p =>
      p.value.identity === "ground" && HashSet.has(p.value.labels, "Layer")
    )
    expect(tilesPattern).toBeDefined()
    if (tilesPattern) {
      const tileElem = tilesPattern.elements[0]
      expect(tileElem).toBeDefined()
      if (tileElem) {
        const geomVal = HashMap.get(tileElem.value.properties, "geometry")
        expect(geomVal._tag).toBe("Some")
        if (geomVal._tag === "Some" && geomVal.value._tag === "ArrayVal") {
          const first = geomVal.value.items[0]
          expect(first?._tag).toBe("TaggedStringVal")
          if (first?._tag === "TaggedStringVal") {
            expect(first.tag).toBe("h3")
            expect(first.content).toBe("8f283082aa20c00")
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Gram.stringify round-trip (fixed in 0.4.2: both bugs — vitest loading wrong
// WASM bundle, and tagged-string serialization corruption — are now resolved)
// ---------------------------------------------------------------------------

describe("Gram.stringify round-trip", () => {
  it("preserves node count and relationship count", async () => {
    const source = [
      '(floor:TileType:Floor { name: "Floor", capacity: 10 })',
      "(cell-8f283082aa20c00:Floor { location: h3`8f283082aa20c00` })",
      "(cell-8f283082aa20c01:Floor { location: h3`8f283082aa20c01` })",
      '(cell-8f283082aa20c00)-[:Portal { mode: "Door" }]->(cell-8f283082aa20c01)',
    ].join("\n")

    const first = await Effect.runPromise(Gram.parse(source))
    const serialised = await Effect.runPromise(Gram.stringify(first))
    const second = await Effect.runPromise(Gram.parse(serialised))

    const g1 = StandardGraph.fromPatterns(first)
    const g2 = StandardGraph.fromPatterns(second)
    expect(g2.nodeCount).toBe(g1.nodeCount)
    expect(g2.relationshipCount).toBe(g1.relationshipCount)
  })

  it("preserves h3 tagged-string values", async () => {
    const first = await Effect.runPromise(Gram.parse("(cell:Floor { location: h3`8f283082aa20c00` })"))
    const serialised = await Effect.runPromise(Gram.stringify(first))
    const second = await Effect.runPromise(Gram.parse(serialised))

    const locVal = HashMap.get(second[0]!.value.properties, "location")
    expect(locVal._tag).toBe("Some")
    if (locVal._tag === "Some" && locVal.value._tag === "TaggedStringVal") {
      expect(locVal.value.tag).toBe("h3")
      expect(locVal.value.content).toBe("8f283082aa20c00")
    }
  })

  it("preserves css tagged-string values", async () => {
    const first = await Effect.runPromise(Gram.parse("(t:TileType { style: css`background: #c8b89a` })"))
    const serialised = await Effect.runPromise(Gram.stringify(first))
    const second = await Effect.runPromise(Gram.parse(serialised))

    const styleVal = HashMap.get(second[0]!.value.properties, "style")
    expect(styleVal._tag).toBe("Some")
    if (styleVal._tag === "Some" && styleVal.value._tag === "TaggedStringVal") {
      expect(styleVal.value.tag).toBe("css")
      expect(styleVal.value.content).toBe("background: #c8b89a")
    }
  })
})

// ---------------------------------------------------------------------------
// StandardGraph.fromGram — higher-level API
// ---------------------------------------------------------------------------

describe("StandardGraph.fromGram", () => {
  it("indexes nodes by identity for fast lookup", async () => {
    const gram = [
      "(floor:TileType:Floor { name: \"Floor\" })",
      "(cell-abc123:Floor { location: h3`8f283082aa20c00` })",
    ].join("\n")

    const graph = await Effect.runPromise(StandardGraph.fromGram(gram))
    expect(graph.nodeCount).toBe(2)

    const floorNode = graph.node("floor")
    expect(floorNode._tag).toBe("Some")

    const cellNode = graph.node("cell-abc123")
    expect(cellNode._tag).toBe("Some")
  })

  it("resolves relationship source and target by node identity", async () => {
    const gram = [
      "(a:Cell)",
      "(b:Cell)",
      '(a)-[:Portal { mode: "Elevator" }]->(b)',
    ].join("\n")

    const graph = await Effect.runPromise(StandardGraph.fromGram(gram))
    expect(graph.relationshipCount).toBe(1)

    const [[, rel]] = [...graph.relationships()]
    expect(rel!.source).toBe("a")
    expect(rel!.target).toBe("b")
  })
})
