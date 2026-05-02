import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useRef } from "react"
import { useEditor } from "../state/editor-context"
import type { MapEditorState } from "../state/editor-state"
import { h3Index as brandH3 } from "../types/map-gram"
import type { H3Index, ItemInstance } from "../types/map-gram"
import { H3HexLayer } from "./H3HexLayer"
import { computeCellsFromVertices, polygonAnchorCells } from "./polygon-geometry"

// Moscone West convention centre — default starting view
const DEFAULT_CENTER: [number, number] = [-122.4, 37.784]
const DEFAULT_ZOOM = 21

export function MapView() {
  const { state, dispatch } = useEditor()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hexLayerRef = useRef<H3HexLayer | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const stateRef = useRef<MapEditorState>(state)
  stateRef.current = state

  // Polygon drag state
  const dragStartRef = useRef<{ lat: number; lng: number } | null>(null)
  const hasDraggedRef = useRef(false)

  // Vertex drag state
  const vertexDragRef = useRef<{ idx: number } | null>(null)

  // Initialize MapLibre once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    mapRef.current = map

    map.on("load", () => {
      hexLayerRef.current = new H3HexLayer(map)
      hexLayerRef.current.update(map.getBounds(), stateRef.current)
    })

    map.on("mousedown", e => {
      const s = stateRef.current
      if (s.ui.activeTool !== "hand") return
      const { lat, lng } = e.lngLat
      const h3 = brandH3(latLngToCell(lat, lng, 15))

      // Priority 1: vertex drag when in edit mode
      const ep = s.ui.editingPolygon
      if (ep) {
        const epLayer = s.layers.find(l => l.id === ep.layerId)
        if (epLayer?.kind === "polygon") {
          const epPoly = epLayer.committed.find(p => p.id === ep.polyId)
          if (epPoly?.vertices) {
            const vIdx = (epPoly.vertices as string[]).indexOf(h3 as string)
            if (vIdx >= 0) {
              vertexDragRef.current = { idx: vIdx }
              hasDraggedRef.current = false
              map.dragPan.disable()
              return
            }
          }
        }
        // Clicked outside the vertex handles — exit edit mode and stop here
        dispatch({ type: "EXIT_POLYGON_EDIT" })
        return
      }

      // Priority 2: polygon drag
      const activeLayer = s.layers.find(l => l.id === s.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "polygon" || activeLayer.locked) return
      const poly = activeLayer.committed.find(p => p.cells.includes(h3))
      if (!poly) return

      dispatch({ type: "SELECT_ELEMENT", ref: { type: "polygon", layerId: s.ui.activeLayerId, id: poly.id } })
      dispatch({ type: "BEGIN_POLYGON_DRAG", layerId: s.ui.activeLayerId, polyId: poly.id, cells: poly.cells as H3Index[], sides: poly.sides })
      dragStartRef.current = { lat, lng }
      hasDraggedRef.current = false
      map.dragPan.disable()
    })

    map.on("mousemove", e => {
      const { lat, lng } = e.lngLat

      if (vertexDragRef.current !== null) {
        const s = stateRef.current
        const ep = s.ui.editingPolygon
        if (!ep) { vertexDragRef.current = null; map.dragPan.enable(); return }
        const layer = s.layers.find(l => l.id === ep.layerId)
        if (!layer || layer.kind !== "polygon") return
        const poly = layer.committed.find(p => p.id === ep.polyId)
        if (!poly?.vertices) return

        const h3 = brandH3(latLngToCell(lat, lng, 15))
        const currentVertices = (s.ui.vertexDragPreview?.vertices ?? poly.vertices) as H3Index[]
        const newVertices = currentVertices.map((v, i) => i === vertexDragRef.current!.idx ? h3 : v)
        const newCells = computeCellsFromVertices(newVertices as string[]).map(brandH3)
        dispatch({ type: "UPDATE_VERTEX_DRAG", cells: newCells, vertices: newVertices })
        hasDraggedRef.current = true
        return
      }

      if (dragStartRef.current !== null) {
        const dLat = lat - dragStartRef.current.lat
        const dLng = lng - dragStartRef.current.lng
        const dp = stateRef.current.ui.draggedPolygon
        if (!dp) return
        const newCells = translateCells(dp.originalCells as H3Index[], dLat, dLng)
        dispatch({ type: "UPDATE_POLYGON_DRAG", previewCells: newCells })
        hasDraggedRef.current = true
      }
    })

    map.on("mouseup", () => {
      if (vertexDragRef.current !== null) {
        if (hasDraggedRef.current) {
          dispatch({ type: "COMMIT_VERTEX_DRAG" })
        } else {
          dispatch({ type: "CANCEL_VERTEX_DRAG" })
        }
        vertexDragRef.current = null
        map.dragPan.enable()
        return
      }

      if (dragStartRef.current !== null) {
        if (hasDraggedRef.current) {
          dispatch({ type: "COMMIT_POLYGON_DRAG" })
        } else {
          dispatch({ type: "CANCEL_POLYGON_DRAG" })
        }
        dragStartRef.current = null
        map.dragPan.enable()
      }
    })

    map.on("dblclick", e => {
      const s = stateRef.current
      if (s.ui.activeTool !== "hand") return
      const { lat, lng } = e.lngLat
      const h3 = brandH3(latLngToCell(lat, lng, 15))
      const activeLayer = s.layers.find(l => l.id === s.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "polygon" || activeLayer.locked) return
      const poly = activeLayer.committed.find(p => p.cells.includes(h3))
      if (!poly) {
        if (s.ui.editingPolygon) dispatch({ type: "EXIT_POLYGON_EDIT" })
        return
      }
      dispatch({ type: "SELECT_ELEMENT", ref: { type: "polygon", layerId: s.ui.activeLayerId, id: poly.id } })
      dispatch({ type: "BEGIN_POLYGON_EDIT", layerId: s.ui.activeLayerId, polyId: poly.id })
      e.preventDefault() // prevent map zoom-on-dblclick
    })

    map.on("click", e => {
      // Skip if we just finished a drag
      if (hasDraggedRef.current) {
        hasDraggedRef.current = false
        return
      }
      // While in vertex edit mode all interactions are handled by mousedown/up
      if (stateRef.current.ui.editingPolygon) return

      const { lat, lng } = e.lngLat
      const h3 = brandH3(latLngToCell(lat, lng, 15))
      const s = stateRef.current
      const { activeTool, activeLayerId } = s.ui
      const activeLayer = s.layers.find(l => l.id === activeLayerId)
      if (!activeLayer || activeLayer.locked) return

      if (activeTool === "hand" && activeLayer.kind === "polygon") {
        const poly = activeLayer.committed.find(p => p.cells.includes(h3))
        if (poly) {
          dispatch({ type: "SELECT_ELEMENT", ref: { type: "polygon", layerId: activeLayerId, id: poly.id } })
        } else {
          dispatch({ type: "DESELECT" })
        }
        return
      }

      if (activeTool === "paint" && activeLayer.kind === "tile") {
        const isExplicit = activeLayer.tiles.has(h3)
        if (isExplicit) {
          dispatch({ type: "SELECT_ELEMENT", ref: { type: "tile", layerId: activeLayerId, h3 } })
        } else {
          dispatch({ type: "PAINT_CELL", h3 })
          dispatch({ type: "DESELECT" })
        }
      } else if (activeTool === "erase" && (activeLayer.kind === "tile" || activeLayer.kind === "items")) {
        dispatch({ type: "ERASE_CELL", h3 })
      } else if (activeTool === "polygon" && activeLayer.kind === "polygon") {
        const n = s.ui.polygonVertexCount
        const cells = computePolygonCells(h3, n)
        const vertices = polygonAnchorCells(cells as string[], n).map(brandH3)
        dispatch({ type: "PLACE_POLYGON", cells, sides: n, vertices })
      } else if (activeTool === "portal" && activeLayer.kind === "tile") {
        if (!s.ui.portalPendingFrom) {
          dispatch({ type: "SELECT_PORTAL_FROM", h3 })
        } else {
          dispatch({ type: "CREATE_PORTAL", h3 })
        }
      } else if (activeTool === "place-item" && activeLayer.kind === "items") {
        const itemType = s.itemTypes.find(t => t.id === s.ui.activeTypeId)
        if (itemType) {
          dispatch({ type: "PLACE_ITEM", h3, itemTypeName: itemType.typeName })
        }
      }

      if (activeTool !== "paint" && activeTool !== "portal") {
        dispatch({ type: "DESELECT" })
      }
    })

    return () => {
      for (const m of markersRef.current.values()) m.remove()
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
      hexLayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arrow-key nudge + Escape for hand tool
  useEffect(() => {
    const BEARING_BY_KEY: Record<string, number> = {
      ArrowUp: 0,
      ArrowDown: 180,
      ArrowRight: 60,
      ArrowLeft: 240,
    }

    function handleKeyDown(e: KeyboardEvent) {
      const s = stateRef.current
      if (s.ui.activeTool !== "hand") return

      if (e.key === "Escape") {
        if (s.ui.editingPolygon) {
          dispatch({ type: "EXIT_POLYGON_EDIT" })
          e.preventDefault()
        }
        return
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        const sel = s.ui.selectedElement
        if (sel?.type === "polygon") {
          e.preventDefault()
          dispatch({ type: "EXIT_POLYGON_EDIT" })
          dispatch({ type: "DELETE_POLYGON", layerId: sel.layerId, id: sel.id })
          dispatch({ type: "DESELECT" })
        }
        return
      }

      const bearing = BEARING_BY_KEY[e.key]
      if (bearing === undefined) return

      // If editing a polygon, nudge the vertices (and recompute cells)
      const ep = s.ui.editingPolygon
      if (ep) {
        const layer = s.layers.find(l => l.id === ep.layerId)
        if (!layer || layer.kind !== "polygon") return
        const poly = layer.committed.find(p => p.id === ep.polyId)
        if (!poly?.vertices) return
        e.preventDefault()
        const newVertices = nudgeCells(poly.vertices as H3Index[], bearing)
        const newCells = computeCellsFromVertices(newVertices as string[]).map(brandH3)
        dispatch({ type: "COMMIT_VERTEX_DRAG" }) // flush any pending preview first
        dispatch({ type: "UPDATE_VERTEX_DRAG", cells: newCells, vertices: newVertices })
        dispatch({ type: "COMMIT_VERTEX_DRAG" })
        return
      }

      // Otherwise nudge the selected polygon as a whole
      const sel = s.ui.selectedElement
      if (!sel || sel.type !== "polygon") return
      const layer = s.layers.find(l => l.id === sel.layerId)
      if (!layer || layer.kind !== "polygon") return
      const poly = layer.committed.find(p => p.id === sel.id)
      if (!poly) return
      e.preventDefault()
      const newCells = nudgeCells(poly.cells as H3Index[], bearing)
      const newVertices = poly.vertices
        ? nudgeCells(poly.vertices as H3Index[], bearing)
        : undefined
      dispatch({ type: "SET_POLYGON_CELLS", layerId: sel.layerId, polyId: sel.id, cells: newCells })
      if (newVertices) {
        // Persist moved vertices via a quick drag-commit cycle
        dispatch({ type: "UPDATE_VERTEX_DRAG", cells: newCells, vertices: newVertices })
        dispatch({ type: "COMMIT_VERTEX_DRAG" })
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [dispatch])

  // Sync layer updates with MapLibre whenever editor state changes
  useEffect(() => {
    const map = mapRef.current
    const hexLayer = hexLayerRef.current
    if (!map || !map.isStyleLoaded() || !hexLayer) return

    hexLayer.update(map.getBounds(), state)

    const allItems = state.layers
      .filter(l => l.kind === "items" && l.visible)
      .flatMap(l => l.kind === "items" ? l.items : [])
    syncItemMarkers(map, allItems, state.itemTypes, markersRef.current)
  }, [state])

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0 }}
    />
  )
}

// ---------------------------------------------------------------------------
// Polygon cell computation (placement)
// ---------------------------------------------------------------------------

const POLY_CIRCUMRADIUS_LAT = 0.0000230

function isInsideRegularNGon(n: number, px: number, py: number): boolean {
  for (let i = 0; i < n; i++) {
    const a1 = (2 * Math.PI / n) * i
    const a2 = (2 * Math.PI / n) * (i + 1)
    const v1x = Math.sin(a1), v1y = Math.cos(a1)
    const v2x = Math.sin(a2), v2y = Math.cos(a2)
    const ex = v2x - v1x, ey = v2y - v1y
    const fpx = px - v1x, fpy = py - v1y
    if (ex * fpy - ey * fpx >= 0) return false
  }
  return true
}

function computePolygonCells(centerH3: string, n: number): H3Index[] {
  const diskCells = gridDisk(centerH3, 2)
  if (n === 6) return diskCells.map(brandH3)
  const [cLat, cLng] = cellToLatLng(centerH3)
  const radiusLng = POLY_CIRCUMRADIUS_LAT / Math.cos(cLat * (Math.PI / 180))
  return diskCells.filter(cell => {
    const [lat, lng] = cellToLatLng(cell)
    const py = (lat - cLat) / POLY_CIRCUMRADIUS_LAT
    const px = (lng - cLng) / radiusLng
    if (n === 4) return Math.abs(px) <= 0.95 && Math.abs(py) <= 0.65
    return isInsideRegularNGon(n, px, py)
  }).map(brandH3)
}

// ---------------------------------------------------------------------------
// Polygon drag/nudge helpers
// ---------------------------------------------------------------------------

function translateCells(cells: H3Index[], dLat: number, dLng: number): H3Index[] {
  return cells.map(cell => {
    const [lat, lng] = cellToLatLng(cell)
    return brandH3(latLngToCell(lat + dLat, lng + dLng, 15))
  })
}

function nudgeCells(cells: H3Index[], bearing: number): H3Index[] {
  if (cells.length === 0) return cells
  const ref = cells[0]!
  const [refLat, refLng] = cellToLatLng(ref)
  const neighbors = gridDisk(ref, 1).filter(c => c !== ref)

  let bestNeighbor = neighbors[0]!
  let bestDiff = Infinity
  for (const n of neighbors) {
    const [nLat, nLng] = cellToLatLng(n)
    const nb = ((Math.atan2(nLng - refLng, nLat - refLat) * 180 / Math.PI) % 360 + 360) % 360
    const diff = Math.min(Math.abs(nb - bearing), 360 - Math.abs(nb - bearing))
    if (diff < bestDiff) { bestDiff = diff; bestNeighbor = n }
  }

  const [nLat, nLng] = cellToLatLng(bestNeighbor)
  return translateCells(cells, nLat - refLat, nLng - refLng)
}

// ---------------------------------------------------------------------------
// Item marker sync
// ---------------------------------------------------------------------------

function cellCentroidLngLat(h3: string): [number, number] {
  const boundary = cellToBoundary(h3)
  const lat = boundary.reduce((s, [la]) => s + la, 0) / boundary.length
  const lng = boundary.reduce((s, [, lo]) => s + lo, 0) / boundary.length
  return [lng, lat]
}

function syncItemMarkers(
  map: maplibregl.Map,
  items: ItemInstance[],
  itemTypes: { id: string; typeName: string; glyph: string }[],
  markers: Map<string, maplibregl.Marker>,
) {
  const currentIds = new Set(items.map(i => i.id))

  for (const [id, marker] of markers.entries()) {
    if (!currentIds.has(id)) {
      marker.remove()
      markers.delete(id)
    }
  }

  for (const item of items) {
    const glyph = itemTypes.find(t => t.typeName === item.typeName)?.glyph ?? "📦"
    const [lng, lat] = cellCentroidLngLat(item.h3Index)

    if (!markers.has(item.id)) {
      const el = document.createElement("div")
      el.textContent = glyph
      el.style.cssText = "font-size:16px;cursor:pointer;pointer-events:none"
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
      markers.set(item.id, marker)
    }
  }
}
