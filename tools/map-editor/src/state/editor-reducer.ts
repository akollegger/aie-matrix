import { computeCellsFromVertices, polygonAnchorCells } from "../map/polygon-geometry"
import { h3Index } from "../types/map-gram"
import type {
  H3Index,
  ItemInstance,
  ItemType,
  MapMeta,
  MovementRule,
  PolygonShape,
  Portal,
  TileType,
} from "../types/map-gram"
import type {
  ActiveTool,
  ElementRef,
  ItemsLayerState,
  MapEditorState,
  MapLayer,
  PolygonLayerState,
  TileLayerState,
} from "./editor-state"

// ---------------------------------------------------------------------------
// Built-in types (cannot be deleted)
// ---------------------------------------------------------------------------

export const BUILTIN_FLOOR_ID = "floor"

const BUILTIN_FLOOR: TileType = {
  id: BUILTIN_FLOOR_ID,
  typeName: "Floor",
  name: "Floor",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function defaultTool(kind: MapLayer["kind"]): ActiveTool {
  if (kind === "polygon") return "polygon"
  if (kind === "items") return "place-item"
  return "paint"
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_LAYER_ID = "ground"

export function makeInitialState(): MapEditorState {
  const ground: TileLayerState = {
    id: INITIAL_LAYER_ID,
    name: "Ground",
    kind: "tile",
    visible: true,
    locked: false,
    tiles: new Map(),
    portals: [],
  }
  return {
    meta: { kind: "matrix-map", name: "untitled-map", elevation: 0 },
    tileTypes: [BUILTIN_FLOOR],
    itemTypes: [],
    rules: [{ fromTypeName: "Floor", toTypeName: "Floor" }],
    layers: [ground],
    ui: {
      activeTool: "paint",
      activeTypeId: BUILTIN_FLOOR_ID,
      activeLayerId: INITIAL_LAYER_ID,
      inProgressPolygon: [],
      portalPendingFrom: null,
      selectedElement: null,
      hint: null,
      showBoundingBox: true,
      polygonVertexCount: 4,
      draggedPolygon: null,
      editingPolygon: null,
      vertexDragPreview: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type EditorAction =
  // Map metadata
  | { type: "UPDATE_META"; payload: Partial<Omit<MapMeta, "kind">> }
  // Tool / type selection
  | { type: "SET_ACTIVE_TOOL"; tool: ActiveTool }
  | { type: "SET_ACTIVE_TYPE"; typeId: string }
  // Layer management
  | { type: "ADD_LAYER"; kind: "tile" | "polygon" | "items"; name: string }
  | { type: "REMOVE_LAYER"; layerId: string }
  | { type: "RENAME_LAYER"; layerId: string; name: string }
  | { type: "REORDER_LAYER"; fromIdx: number; toIdx: number }
  | { type: "SET_ACTIVE_LAYER"; layerId: string }
  | { type: "SET_LAYER_VISIBILITY"; layerId: string; visible: boolean }
  | { type: "SET_LAYER_LOCKED"; layerId: string; locked: boolean }
  // Tile painting (active tile layer)
  | { type: "PAINT_CELL"; h3: H3Index; isOverride?: boolean }
  | { type: "ERASE_CELL"; h3: H3Index }
  | { type: "UPDATE_TILE_INSTANCE_TYPE"; layerId: string; h3: H3Index; typeName: string }
  // Tile type CRUD
  | { type: "CREATE_TILE_TYPE"; tileType: Omit<TileType, "id"> & { id?: string } }
  | { type: "UPDATE_TILE_TYPE"; id: string; patch: Partial<TileType> }
  | { type: "DELETE_TILE_TYPE"; id: string }
  // Polygon placement (active polygon layer)
  | { type: "PLACE_POLYGON"; cells: H3Index[]; sides: number; vertices?: H3Index[] }
  | { type: "SET_POLYGON_VERTEX_COUNT"; count: number }
  // Polygon editing (future editing state)
  | { type: "ADD_POLYGON_VERTEX"; h3: H3Index }
  | { type: "CONFIRM_POLYGON" }
  | { type: "CANCEL_POLYGON" }
  | { type: "DELETE_POLYGON"; layerId: string; id: string }
  // Portals (active tile layer)
  | { type: "SELECT_PORTAL_FROM"; h3: H3Index }
  | { type: "CREATE_PORTAL"; h3: H3Index }
  | { type: "DELETE_PORTAL"; layerId: string; id: string }
  | { type: "UPDATE_PORTAL_MODE"; layerId: string; id: string; mode: string }
  // Item types
  | { type: "CREATE_ITEM_TYPE"; itemType: Omit<ItemType, "id"> & { id?: string } }
  | { type: "UPDATE_ITEM_TYPE"; id: string; patch: Partial<ItemType> }
  | { type: "DELETE_ITEM_TYPE"; id: string }
  // Items (active items layer)
  | { type: "PLACE_ITEM"; h3: H3Index; itemTypeName: string }
  | { type: "REMOVE_ITEM"; layerId: string; id: string }
  // Polygon move / drag
  | { type: "SET_POLYGON_CELLS"; layerId: string; polyId: string; cells: H3Index[] }
  | { type: "BEGIN_POLYGON_DRAG"; layerId: string; polyId: string; cells: H3Index[]; sides: number }
  | { type: "UPDATE_POLYGON_DRAG"; previewCells: H3Index[] }
  | { type: "COMMIT_POLYGON_DRAG" }
  | { type: "CANCEL_POLYGON_DRAG" }
  // Vertex editing
  | { type: "BEGIN_POLYGON_EDIT"; layerId: string; polyId: string }
  | { type: "EXIT_POLYGON_EDIT" }
  | { type: "UPDATE_VERTEX_DRAG"; cells: H3Index[]; vertices: H3Index[] }
  | { type: "COMMIT_VERTEX_DRAG" }
  | { type: "CANCEL_VERTEX_DRAG" }
  // Selection
  | { type: "SELECT_ELEMENT"; ref: ElementRef }
  | { type: "DESELECT" }
  // UI feedback
  | { type: "SET_HINT"; hint: string | null }
  | { type: "SET_BOUNDING_BOX_VISIBILITY"; visible: boolean }
  // Import
  | { type: "IMPORT_MAP"; state: MapEditorState }

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function editorReducer(
  state: MapEditorState,
  action: EditorAction
): MapEditorState {
  switch (action.type) {

    // --- Map metadata ---
    case "UPDATE_META":
      return { ...state, meta: { ...state.meta, ...action.payload } }

    // --- Tool / type selection ---
    case "SET_ACTIVE_TOOL":
      return { ...state, ui: { ...state.ui, activeTool: action.tool } }

    case "SET_ACTIVE_TYPE":
      return { ...state, ui: { ...state.ui, activeTypeId: action.typeId } }

    // --- Layer management ---
    case "ADD_LAYER": {
      const id = `lyr${uid()}` // prefix ensures id starts with a letter (gram identifier rule)
      let newLayer: MapLayer
      if (action.kind === "polygon") {
        newLayer = { id, name: action.name, kind: "polygon", visible: true, locked: false, committed: [] }
      } else if (action.kind === "items") {
        newLayer = { id, name: action.name, kind: "items", visible: true, locked: false, items: [] }
      } else {
        newLayer = { id, name: action.name, kind: "tile", visible: true, locked: false, tiles: new Map(), portals: [] }
      }
      return {
        ...state,
        layers: [...state.layers, newLayer],
        ui: {
          ...state.ui,
          activeLayerId: id,
          activeTool: defaultTool(action.kind),
          inProgressPolygon: [],
          portalPendingFrom: null,
        },
      }
    }

    case "REMOVE_LAYER": {
      if (state.layers.length <= 1) return state
      const newLayers = state.layers.filter(l => l.id !== action.layerId)
      let newActiveId = state.ui.activeLayerId
      if (newActiveId === action.layerId) {
        newActiveId = newLayers[newLayers.length - 1]?.id ?? newLayers[0]?.id ?? ""
      }
      const activeLayer = newLayers.find(l => l.id === newActiveId)
      return {
        ...state,
        layers: newLayers,
        ui: {
          ...state.ui,
          activeLayerId: newActiveId,
          activeTool: activeLayer ? defaultTool(activeLayer.kind) : "paint",
          inProgressPolygon: [],
          portalPendingFrom: null,
          selectedElement: state.ui.selectedElement?.layerId === action.layerId
            ? null
            : state.ui.selectedElement,
        },
      }
    }

    case "RENAME_LAYER":
      return {
        ...state,
        layers: state.layers.map(l => l.id === action.layerId ? { ...l, name: action.name } : l),
      }

    case "REORDER_LAYER": {
      const layers = [...state.layers]
      const [moved] = layers.splice(action.fromIdx, 1)
      if (!moved) return state
      layers.splice(action.toIdx, 0, moved)
      return { ...state, layers }
    }

    case "SET_ACTIVE_LAYER": {
      const layer = state.layers.find(l => l.id === action.layerId)
      if (!layer) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          activeLayerId: action.layerId,
          activeTool: defaultTool(layer.kind),
          inProgressPolygon: [],
          portalPendingFrom: null,
        },
      }
    }

    case "SET_LAYER_VISIBILITY":
      return {
        ...state,
        layers: state.layers.map(l => l.id === action.layerId ? { ...l, visible: action.visible } : l),
      }

    case "SET_LAYER_LOCKED":
      return {
        ...state,
        layers: state.layers.map(l => l.id === action.layerId ? { ...l, locked: action.locked } : l),
      }

    // --- Tile painting ---
    case "PAINT_CELL": {
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "tile" || activeLayer.locked) return state
      const activeType = state.tileTypes.find(t => t.id === state.ui.activeTypeId)
      const typeName = activeType?.typeName ?? "Floor"
      const tiles = new Map(activeLayer.tiles)
      tiles.set(action.h3, { h3Index: action.h3, typeName, isOverride: action.isOverride })
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === state.ui.activeLayerId ? { ...l, tiles } as TileLayerState : l
        ),
      }
    }

    case "ERASE_CELL": {
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.locked) return state

      if (activeLayer.kind === "tile") {
        if (!activeLayer.tiles.has(action.h3)) {
          return { ...state, ui: { ...state.ui, hint: "Use paint to override polygon tiles" } }
        }
        const tiles = new Map(activeLayer.tiles)
        tiles.delete(action.h3)
        return {
          ...state,
          layers: state.layers.map(l =>
            l.id === state.ui.activeLayerId ? { ...l, tiles } as TileLayerState : l
          ),
        }
      }

      if (activeLayer.kind === "items") {
        const items = activeLayer.items.filter(i => i.h3Index !== action.h3)
        if (items.length === activeLayer.items.length) return state
        return {
          ...state,
          layers: state.layers.map(l =>
            l.id === state.ui.activeLayerId ? { ...l, items } as ItemsLayerState : l
          ),
        }
      }

      return state
    }

    case "UPDATE_TILE_INSTANCE_TYPE":
      return {
        ...state,
        layers: state.layers.map(l => {
          if (l.id !== action.layerId || l.kind !== "tile") return l
          const existing = l.tiles.get(action.h3)
          if (!existing) return l
          const tiles = new Map(l.tiles)
          tiles.set(action.h3, { ...existing, typeName: action.typeName })
          return { ...l, tiles } as TileLayerState
        }),
      }

    // --- Tile type CRUD ---
    case "CREATE_TILE_TYPE": {
      const id = action.tileType.id ?? uid()
      const typeName = action.tileType.typeName ?? id.charAt(0).toUpperCase() + id.slice(1)
      const selfRule: MovementRule = { fromTypeName: typeName, toTypeName: typeName }
      return {
        ...state,
        tileTypes: [...state.tileTypes, { ...action.tileType, id, typeName }],
        rules: [...state.rules, selfRule],
      }
    }

    case "UPDATE_TILE_TYPE":
      return {
        ...state,
        tileTypes: state.tileTypes.map(t => t.id === action.id ? { ...t, ...action.patch } : t),
      }

    case "DELETE_TILE_TYPE":
      if (action.id === BUILTIN_FLOOR_ID) return state
      return { ...state, tileTypes: state.tileTypes.filter(t => t.id !== action.id) }

    // --- Polygon placement ---
    case "PLACE_POLYGON": {
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "polygon") return state
      const activeType = state.tileTypes.find(t => t.id === state.ui.activeTypeId)
      const typeName = activeType?.typeName ?? "Floor"
      const poly: PolygonShape = {
        id: `poly-${uid()}`, typeName, cells: action.cells, sides: action.sides,
        ...(action.vertices ? { vertices: action.vertices } : {}),
      }
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === state.ui.activeLayerId && l.kind === "polygon"
            ? { ...l, committed: [...l.committed, poly] } as PolygonLayerState
            : l
        ),
      }
    }

    case "SET_POLYGON_VERTEX_COUNT":
      return { ...state, ui: { ...state.ui, polygonVertexCount: action.count } }

    // --- Polygon editing (future editing state) ---
    case "ADD_POLYGON_VERTEX":
      return { ...state, ui: { ...state.ui, inProgressPolygon: [...state.ui.inProgressPolygon, action.h3] } }

    case "CONFIRM_POLYGON": {
      const { inProgressPolygon } = state.ui
      if (inProgressPolygon.length < 3) {
        return { ...state, ui: { ...state.ui, hint: "A polygon needs at least 3 vertices" } }
      }
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "polygon") {
        return { ...state, ui: { ...state.ui, hint: "Switch to a polygon layer to confirm" } }
      }
      const activeType = state.tileTypes.find(t => t.id === state.ui.activeTypeId)
      const typeName = activeType?.typeName ?? "Floor"
      const vertices = inProgressPolygon
      const cells = computeCellsFromVertices(inProgressPolygon).map(h3Index)
      const poly: PolygonShape = { id: `poly-${uid()}`, typeName, cells, sides: vertices.length, vertices }
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === state.ui.activeLayerId && l.kind === "polygon"
            ? { ...l, committed: [...l.committed, poly] } as PolygonLayerState
            : l
        ),
        ui: { ...state.ui, inProgressPolygon: [] },
      }
    }

    case "CANCEL_POLYGON":
      return { ...state, ui: { ...state.ui, inProgressPolygon: [] } }

    case "DELETE_POLYGON":
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId && l.kind === "polygon"
            ? { ...l, committed: l.committed.filter(p => p.id !== action.id) } as PolygonLayerState
            : l
        ),
        ui: {
          ...state.ui,
          selectedElement:
            state.ui.selectedElement?.type === "polygon" &&
            state.ui.selectedElement.id === action.id
              ? null
              : state.ui.selectedElement,
        },
      }

    // --- Portals ---
    case "SELECT_PORTAL_FROM":
      return { ...state, ui: { ...state.ui, portalPendingFrom: action.h3 } }

    case "CREATE_PORTAL": {
      const { portalPendingFrom } = state.ui
      if (!portalPendingFrom) return state
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "tile") return state
      const existing = activeLayer.portals.find(
        p => p.fromH3 === portalPendingFrom && p.toH3 === action.h3
      )
      if (existing) return { ...state, ui: { ...state.ui, portalPendingFrom: null } }
      const portal: Portal = { id: uid(), fromH3: portalPendingFrom, toH3: action.h3, mode: "Door" }
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === state.ui.activeLayerId && l.kind === "tile"
            ? { ...l, portals: [...l.portals, portal] } as TileLayerState
            : l
        ),
        ui: { ...state.ui, portalPendingFrom: null },
      }
    }

    case "DELETE_PORTAL":
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId && l.kind === "tile"
            ? { ...l, portals: l.portals.filter(p => p.id !== action.id) } as TileLayerState
            : l
        ),
      }

    case "UPDATE_PORTAL_MODE":
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId && l.kind === "tile"
            ? { ...l, portals: l.portals.map(p => p.id === action.id ? { ...p, mode: action.mode } : p) } as TileLayerState
            : l
        ),
      }

    // --- Item types ---
    case "CREATE_ITEM_TYPE": {
      const id = action.itemType.id ?? uid()
      const typeName = action.itemType.typeName ?? id.charAt(0).toUpperCase() + id.slice(1)
      return { ...state, itemTypes: [...state.itemTypes, { ...action.itemType, id, typeName }] }
    }

    case "UPDATE_ITEM_TYPE":
      return {
        ...state,
        itemTypes: state.itemTypes.map(t => t.id === action.id ? { ...t, ...action.patch } : t),
      }

    case "DELETE_ITEM_TYPE":
      return { ...state, itemTypes: state.itemTypes.filter(t => t.id !== action.id) }

    // --- Items ---
    case "PLACE_ITEM": {
      const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
      if (!activeLayer || activeLayer.kind !== "items" || activeLayer.locked) return state
      const item: ItemInstance = { id: `item-${uid()}`, typeName: action.itemTypeName, h3Index: h3Index(action.h3) }
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === state.ui.activeLayerId && l.kind === "items"
            ? { ...l, items: [...l.items, item] } as ItemsLayerState
            : l
        ),
      }
    }

    case "REMOVE_ITEM":
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId && l.kind === "items"
            ? { ...l, items: l.items.filter(i => i.id !== action.id) } as ItemsLayerState
            : l
        ),
      }

    // --- Polygon move / drag ---
    case "SET_POLYGON_CELLS":
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId && l.kind === "polygon"
            ? { ...l, committed: l.committed.map(p => p.id === action.polyId ? { ...p, cells: action.cells } : p) } as PolygonLayerState
            : l
        ),
      }

    case "BEGIN_POLYGON_DRAG":
      return {
        ...state,
        ui: {
          ...state.ui,
          draggedPolygon: {
            layerId: action.layerId,
            polyId: action.polyId,
            originalCells: action.cells,
            previewCells: action.cells,
            sides: action.sides,
          },
        },
      }

    case "UPDATE_POLYGON_DRAG":
      if (!state.ui.draggedPolygon) return state
      return { ...state, ui: { ...state.ui, draggedPolygon: { ...state.ui.draggedPolygon, previewCells: action.previewCells } } }

    case "COMMIT_POLYGON_DRAG": {
      const dp = state.ui.draggedPolygon
      if (!dp) return state
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === dp.layerId && l.kind === "polygon"
            ? { ...l, committed: l.committed.map(p => p.id === dp.polyId ? { ...p, cells: dp.previewCells } : p) } as PolygonLayerState
            : l
        ),
        ui: { ...state.ui, draggedPolygon: null },
      }
    }

    case "CANCEL_POLYGON_DRAG":
      return { ...state, ui: { ...state.ui, draggedPolygon: null } }

    // --- Vertex editing ---
    case "BEGIN_POLYGON_EDIT": {
      const layer = state.layers.find(l => l.id === action.layerId)
      if (!layer || layer.kind !== "polygon") return state
      const poly = layer.committed.find(p => p.id === action.polyId)
      if (!poly) return state
      // Populate vertices lazily if not yet stored
      let newLayers = state.layers
      if (!poly.vertices || poly.vertices.length === 0) {
        const verts = polygonAnchorCells(poly.cells, poly.sides).map(h3Index)
        newLayers = state.layers.map(l =>
          l.id === action.layerId && l.kind === "polygon"
            ? { ...l, committed: l.committed.map(p => p.id === action.polyId ? { ...p, vertices: verts } : p) } as PolygonLayerState
            : l
        )
      }
      return {
        ...state,
        layers: newLayers,
        ui: { ...state.ui, editingPolygon: { layerId: action.layerId, polyId: action.polyId }, vertexDragPreview: null },
      }
    }

    case "EXIT_POLYGON_EDIT":
      return { ...state, ui: { ...state.ui, editingPolygon: null, vertexDragPreview: null } }

    case "UPDATE_VERTEX_DRAG":
      return { ...state, ui: { ...state.ui, vertexDragPreview: { cells: action.cells, vertices: action.vertices } } }

    case "COMMIT_VERTEX_DRAG": {
      const ep = state.ui.editingPolygon
      const vdp = state.ui.vertexDragPreview
      if (!ep || !vdp) return state
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === ep.layerId && l.kind === "polygon"
            ? { ...l, committed: l.committed.map(p => p.id === ep.polyId ? { ...p, cells: vdp.cells, vertices: vdp.vertices } : p) } as PolygonLayerState
            : l
        ),
        ui: { ...state.ui, vertexDragPreview: null },
      }
    }

    case "CANCEL_VERTEX_DRAG":
      return { ...state, ui: { ...state.ui, vertexDragPreview: null } }

    // --- Selection ---
    case "SELECT_ELEMENT":
      return { ...state, ui: { ...state.ui, selectedElement: action.ref } }

    case "DESELECT":
      return { ...state, ui: { ...state.ui, selectedElement: null } }

    // --- UI feedback ---
    case "SET_HINT":
      return { ...state, ui: { ...state.ui, hint: action.hint } }

    case "SET_BOUNDING_BOX_VISIBILITY":
      return { ...state, ui: { ...state.ui, showBoundingBox: action.visible } }

    // --- Import ---
    case "IMPORT_MAP":
      return action.state

    default:
      return state
  }
}
