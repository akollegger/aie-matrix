import { cellToBoundary, cellToLatLng, polygonToCells } from "h3-js"
import type maplibregl from "maplibre-gl"
import type { MapEditorState } from "../state/editor-state"
import { polygonAnchorCells } from "./polygon-geometry"

// ---------------------------------------------------------------------------
// Layer IDs managed by this class
// ---------------------------------------------------------------------------

const SOURCE = {
  grid: "h3-grid",
  tiles: "h3-tiles",
  polygons: "h3-polygons",
  polygonBorders: "h3-polygon-borders",
  dragCells: "h3-drag-cells",
  dragBorder: "h3-drag-border",
  polyVertices: "h3-poly-vertices",
  polyInProgress: "h3-poly-inprogress",
  portals: "h3-portals",
  bbox: "h3-bbox",
} as const

const LAYER = {
  gridFill: "h3-grid-fill",
  gridLine: "h3-grid-line",
  tilesFill: "h3-tiles-fill",
  tilesLine: "h3-tiles-line",
  polygonsFill: "h3-polygons-fill",
  polygonsLine: "h3-polygons-line",
  polygonBordersLine: "h3-polygon-borders-line",
  dragCellsLine: "h3-drag-cells-line",
  dragBorderLine: "h3-drag-border-line",
  polyVerticesDots: "h3-poly-vertices-dots",
  polyInProgressDots: "h3-poly-ip-dots",
  polyInProgressLine: "h3-poly-ip-line",
  portalsLine: "h3-portals-line",
  bboxLine: "h3-bbox-line",
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellsToFeatureCollection(cells: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map(cell => {
      const boundary = cellToBoundary(cell).map(([lat, lng]) => [lng, lat] as [number, number])
      return {
        type: "Feature",
        properties: { cell },
        geometry: {
          type: "Polygon",
          coordinates: [[...boundary, boundary[0]!]],
        },
      }
    }),
  }
}

// R15 cells are ~0.9 m². Below zoom 20 a single cell is sub-pixel.
const MIN_ZOOM_FOR_GRID = 20
const MAX_GRID_CELLS = 20_000

function boundsToViewportCells(bounds: maplibregl.LngLatBounds, res: number, zoom: number): string[] {
  if (zoom < MIN_ZOOM_FOR_GRID) return []
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const polygon: [number, number][] = [
    [ne.lat, ne.lng],
    [ne.lat, sw.lng],
    [sw.lat, sw.lng],
    [sw.lat, ne.lng],
    [ne.lat, ne.lng],
  ]
  try {
    const cells = polygonToCells(polygon, res)
    return cells.length <= MAX_GRID_CELLS ? cells : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// H3HexLayer
// ---------------------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export class H3HexLayer {
  private map: maplibregl.Map
  private initialized = false

  constructor(map: maplibregl.Map) {
    this.map = map
    this.initSources()
    this.initLayers()
    this.initialized = true

    const refresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => this.refreshGrid(), 120)
    }
    map.on("moveend", refresh)
    map.on("zoomend", refresh)
  }

  // -------------------------------------------------------------------------

  private initSources() {
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }
    for (const id of Object.values(SOURCE)) {
      if (!this.map.getSource(id)) {
        this.map.addSource(id, { type: "geojson", data: empty })
      }
    }
    // Legacy sources not in SOURCE enum
    if (!this.map.getSource("h3-poly-ip-linestring")) {
      this.map.addSource("h3-poly-ip-linestring", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
    }
  }

  private initLayers() {
    this.addIfAbsent({
      id: LAYER.gridFill,
      type: "fill",
      source: SOURCE.grid,
      paint: { "fill-color": "#334", "fill-opacity": 0.05 },
    })
    this.addIfAbsent({
      id: LAYER.gridLine,
      type: "line",
      source: SOURCE.grid,
      paint: { "line-color": "#5566aa", "line-width": 0.5, "line-opacity": 0.4 },
    })

    // Polygon fills — color and opacity data-driven; selected polygon is brighter
    this.addIfAbsent({
      id: LAYER.polygonsFill,
      type: "fill",
      source: SOURCE.polygons,
      paint: {
        "fill-color": ["coalesce", ["get", "color"], "#44cc88"],
        "fill-opacity": ["case", ["boolean", ["get", "selected"], false], 0.65, 0.4],
      },
    })
    this.addIfAbsent({
      id: LAYER.polygonsLine,
      type: "line",
      source: SOURCE.polygons,
      paint: { "line-color": "#88ffcc", "line-width": 1.5 },
    })

    // Polygon border outlines — selected polygon gets white/wider outline
    this.addIfAbsent({
      id: LAYER.polygonBordersLine,
      type: "line",
      source: SOURCE.polygonBorders,
      paint: {
        "line-color": ["case", ["boolean", ["get", "selected"], false], "#ffffff", ["coalesce", ["get", "color"], "#44cc88"]],
        "line-width": ["case", ["boolean", ["get", "selected"], false], 3, 2],
        "line-dasharray": [4, 2],
        "line-opacity": 0.9,
      },
    })

    // Drag preview — cell outlines only (no fill) + dashed border
    this.addIfAbsent({
      id: LAYER.dragCellsLine,
      type: "line",
      source: SOURCE.dragCells,
      paint: { "line-color": "#88ccff", "line-width": 1, "line-opacity": 0.6 },
    })
    this.addIfAbsent({
      id: LAYER.dragBorderLine,
      type: "line",
      source: SOURCE.dragBorder,
      paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [4, 2], "line-opacity": 0.95 },
    })

    // Explicit tiles — color driven by feature property; rendered on top of polygons
    this.addIfAbsent({
      id: LAYER.tilesFill,
      type: "fill",
      source: SOURCE.tiles,
      paint: {
        "fill-color": ["coalesce", ["get", "color"], "#4488cc"],
        "fill-opacity": 0.55,
      },
    })
    this.addIfAbsent({
      id: LAYER.tilesLine,
      type: "line",
      source: SOURCE.tiles,
      paint: { "line-color": "#88ccff", "line-width": 1 },
    })

    this.addIfAbsent({
      id: LAYER.polyInProgressDots,
      type: "fill",
      source: SOURCE.polyInProgress,
      paint: { "fill-color": "#ffee44", "fill-opacity": 0.7 },
    })

    this.addIfAbsent({
      id: LAYER.polyInProgressLine,
      type: "line",
      source: "h3-poly-ip-linestring",
      paint: { "line-color": "#ffee44", "line-width": 2, "line-dasharray": [4, 2] },
    })

    this.addIfAbsent({
      id: LAYER.portalsLine,
      type: "line",
      source: SOURCE.portals,
      paint: { "line-color": "#ff8844", "line-width": 2, "line-dasharray": [3, 2] },
    })

    this.addIfAbsent({
      id: LAYER.bboxLine,
      type: "line",
      source: SOURCE.bbox,
      paint: { "line-color": "#ff69b4", "line-width": 1.5, "line-dasharray": [5, 3], "line-opacity": 0.85 },
    })

    // Vertex edit handles — rendered on top of everything
    this.addIfAbsent({
      id: LAYER.polyVerticesDots,
      type: "circle",
      source: SOURCE.polyVertices,
      paint: {
        "circle-radius": 7,
        "circle-color": "#00ffcc",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.9,
      },
    })
  }

  private addIfAbsent(spec: maplibregl.AddLayerObject) {
    if (!this.map.getLayer(spec.id)) {
      this.map.addLayer(spec)
    }
  }

  // -------------------------------------------------------------------------

  private refreshGrid() {
    const cells = boundsToViewportCells(this.map.getBounds(), 15, this.map.getZoom())
    const src = this.map.getSource(SOURCE.grid) as maplibregl.GeoJSONSource | undefined
    src?.setData(cellsToFeatureCollection(cells))
  }

  // -------------------------------------------------------------------------

  update(bounds: maplibregl.LngLatBounds, state: MapEditorState) {
    if (!this.initialized) return

    // Refresh grid
    const gridCells = boundsToViewportCells(bounds, 15, this.map.getZoom())
    ;(this.map.getSource(SOURCE.grid) as maplibregl.GeoJSONSource | undefined)?.setData(
      cellsToFeatureCollection(gridCells)
    )

    // Build color map from tile types
    const typeColorMap = new Map(
      state.tileTypes.map(t => {
        const bg = t.style?.match(/background:\s*([^;]+)/)?.[1]?.trim() ?? "#4488cc"
        return [t.typeName, bg]
      })
    )

    // Collect polygon fills from all visible polygon layers (bottom to top)
    const polyFeatures: GeoJSON.Feature[] = []
    const borderFeatures: GeoJSON.Feature[] = []
    const vertexFeatures: GeoJSON.Feature[] = []
    let anyPolygonVisible = false
    const dp = state.ui.draggedPolygon
    const sel = state.ui.selectedElement
    const ep = state.ui.editingPolygon
    const vdp = state.ui.vertexDragPreview

    for (const layer of state.layers) {
      if (layer.kind !== "polygon") continue
      if (!layer.visible) continue
      anyPolygonVisible = true
      for (const poly of layer.committed) {
        // Skip dragged polygon — shown via drag preview sources
        if (dp && poly.id === dp.polyId) continue
        const isEditing = ep !== null && ep.polyId === poly.id && ep.layerId === layer.id
        const displayCells = isEditing && vdp ? vdp.cells : poly.cells
        const selected = sel?.type === "polygon" && sel.id === poly.id
        const color = typeColorMap.get(poly.typeName) ?? "#44cc88"
        // Fill: one hex-cell polygon per cell
        for (const cell of displayCells) {
          const boundary = cellToBoundary(cell).map(([lat, lng]) => [lng, lat] as [number, number])
          polyFeatures.push({
            type: "Feature",
            properties: { polyId: poly.id, typeName: poly.typeName, color, selected },
            geometry: { type: "Polygon", coordinates: [[...boundary, boundary[0]]] },
          })
        }
        // Border outline: prefer stored vertices (accurate after deformation), else compute
        const currentVertices = isEditing
          ? ((vdp?.vertices ?? poly.vertices ?? []) as string[])
          : (poly.vertices as string[] | undefined ?? [])
        const anchors: string[] = currentVertices.length >= 2
          ? currentVertices
          : polygonAnchorCells(poly.cells as string[], poly.sides)
        if (anchors.length >= 2) {
          const coords = [...anchors, anchors[0]!].map(cell => {
            const [lat, lng] = cellToLatLng(cell)
            return [lng, lat] as [number, number]
          })
          borderFeatures.push({
            type: "Feature",
            properties: { polyId: poly.id, color, selected },
            geometry: { type: "LineString", coordinates: coords },
          })
        }
        // Vertex handles when in edit mode
        if (isEditing) {
          const verts = (vdp?.vertices ?? poly.vertices ?? []) as string[]
          for (let vi = 0; vi < verts.length; vi++) {
            const [lat, lng] = cellToLatLng(verts[vi]!)
            vertexFeatures.push({
              type: "Feature",
              properties: { vertexIdx: vi },
              geometry: { type: "Point", coordinates: [lng, lat] },
            })
          }
        }
      }
    }
    ;(this.map.getSource(SOURCE.polygons) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: polyFeatures,
    })
    ;(this.map.getSource(SOURCE.polygonBorders) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: borderFeatures,
    })
    ;(this.map.getSource(SOURCE.polyVertices) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection", features: vertexFeatures,
    })

    // Drag preview — cell outlines (no fill) + dashed border at new position
    const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }
    if (dp) {
      const dragCellFeatures: GeoJSON.Feature[] = dp.previewCells.map(cell => {
        const boundary = cellToBoundary(cell).map(([lat, lng]) => [lng, lat] as [number, number])
        return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...boundary, boundary[0]]] } }
      })
      ;(this.map.getSource(SOURCE.dragCells) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection", features: dragCellFeatures,
      })
      const dragAnchors = polygonAnchorCells(dp.previewCells as string[], dp.sides)
      const dragBorderCoords = dragAnchors.length >= 2
        ? [...dragAnchors, dragAnchors[0]!].map(c => { const [la, lo] = cellToLatLng(c); return [lo, la] as [number, number] })
        : []
      ;(this.map.getSource(SOURCE.dragBorder) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: dragBorderCoords.length >= 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: dragBorderCoords } }]
          : [],
      })
    } else {
      ;(this.map.getSource(SOURCE.dragCells) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC)
      ;(this.map.getSource(SOURCE.dragBorder) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC)
    }

    // Collect explicit tiles from all visible tile layers (bottom to top)
    const tileFeatures: GeoJSON.Feature[] = []
    let anyTileVisible = false
    for (const layer of state.layers) {
      if (layer.kind !== "tile") continue
      if (!layer.visible) continue
      anyTileVisible = true
      for (const tile of layer.tiles.values()) {
        const boundary = cellToBoundary(tile.h3Index).map(([lat, lng]) => [lng, lat] as [number, number])
        tileFeatures.push({
          type: "Feature",
          properties: {
            typeName: tile.typeName,
            color: typeColorMap.get(tile.typeName) ?? "#4488cc",
          },
          geometry: { type: "Polygon", coordinates: [[...boundary, boundary[0]]] },
        })
      }
    }
    ;(this.map.getSource(SOURCE.tiles) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: tileFeatures,
    })

    // In-progress polygon preview
    const inProgress = state.ui.inProgressPolygon
    ;(this.map.getSource(SOURCE.polyInProgress) as maplibregl.GeoJSONSource | undefined)?.setData(
      cellsToFeatureCollection(inProgress)
    )
    if (inProgress.length >= 2) {
      const centroids = inProgress.map(v => {
        const b = cellToBoundary(v)
        return [
          b.reduce((s, [, lo]) => s + lo, 0) / b.length,
          b.reduce((s, [la]) => s + la, 0) / b.length,
        ] as [number, number]
      })
      ;(this.map.getSource("h3-poly-ip-linestring") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: centroids } }],
      })
    } else {
      ;(this.map.getSource("h3-poly-ip-linestring") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection", features: [],
      })
    }

    // Collect portals from all visible tile layers
    const portalFeatures: GeoJSON.Feature[] = []
    let anyPortalVisible = false
    for (const layer of state.layers) {
      if (layer.kind !== "tile") continue
      if (!layer.visible) continue
      for (const portal of layer.portals) {
        anyPortalVisible = true
        const fromB = cellToBoundary(portal.fromH3)
        const toB = cellToBoundary(portal.toH3)
        const fromLng = fromB.reduce((s, [, lo]) => s + lo, 0) / fromB.length
        const fromLat = fromB.reduce((s, [la]) => s + la, 0) / fromB.length
        const toLng = toB.reduce((s, [, lo]) => s + lo, 0) / toB.length
        const toLat = toB.reduce((s, [la]) => s + la, 0) / toB.length
        portalFeatures.push({
          type: "Feature",
          properties: { mode: portal.mode, id: portal.id },
          geometry: { type: "LineString", coordinates: [[fromLng, fromLat], [toLng, toLat]] },
        })
      }
    }
    ;(this.map.getSource(SOURCE.portals) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: portalFeatures,
    })

    // Bounding box — hot-pink dashed rectangle around all placed content
    const bboxCells: string[] = []
    for (const layer of state.layers) {
      if (layer.kind === "tile") {
        for (const h3 of layer.tiles.keys()) bboxCells.push(h3)
        for (const portal of layer.portals) { bboxCells.push(portal.fromH3); bboxCells.push(portal.toH3) }
      } else if (layer.kind === "polygon") {
        for (const poly of layer.committed) bboxCells.push(...poly.cells)
      } else if (layer.kind === "items") {
        for (const item of layer.items) bboxCells.push(item.h3Index)
      }
    }
    if (bboxCells.length > 0) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
      for (const cell of bboxCells) {
        for (const [lat, lng] of cellToBoundary(cell)) {
          if (lat < minLat) minLat = lat
          if (lat > maxLat) maxLat = lat
          if (lng < minLng) minLng = lng
          if (lng > maxLng) maxLng = lng
        }
      }
      const ring: [number, number][] = [
        [minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
      ]
      ;(this.map.getSource(SOURCE.bbox) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
      })
    } else {
      ;(this.map.getSource(SOURCE.bbox) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection", features: [],
      })
    }

    // Visibility: show/hide composite sources based on any-layer-visible
    this.setVisibility(LAYER.tilesFill, anyTileVisible || tileFeatures.length > 0)
    this.setVisibility(LAYER.tilesLine, anyTileVisible || tileFeatures.length > 0)
    this.setVisibility(LAYER.polygonsFill, anyPolygonVisible || polyFeatures.length > 0)
    this.setVisibility(LAYER.polygonsLine, anyPolygonVisible || polyFeatures.length > 0)
    this.setVisibility(LAYER.polygonBordersLine, anyPolygonVisible || borderFeatures.length > 0)
    this.setVisibility(LAYER.polyInProgressDots, true)
    this.setVisibility(LAYER.polyInProgressLine, true)
    this.setVisibility(LAYER.portalsLine, anyPortalVisible || portalFeatures.length > 0)
    this.setVisibility(LAYER.bboxLine, state.ui.showBoundingBox)
    this.setVisibility(LAYER.dragCellsLine, dp !== null)
    this.setVisibility(LAYER.dragBorderLine, dp !== null)
    this.setVisibility(LAYER.polyVerticesDots, vertexFeatures.length > 0)
  }

  private setVisibility(layerId: string, visible: boolean) {
    if (this.map.getLayer(layerId)) {
      this.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none")
    }
  }
}
