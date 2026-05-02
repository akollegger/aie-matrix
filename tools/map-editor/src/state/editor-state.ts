import type {
  H3Index,
  ItemInstance,
  ItemType,
  MapMeta,
  MovementRule,
  PolygonShape,
  Portal,
  TileInstance,
  TileType,
} from "../types/map-gram"

// ---------------------------------------------------------------------------
// Layer state
// ---------------------------------------------------------------------------

interface BaseLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

export interface PolygonLayerState extends BaseLayer {
  kind: "polygon"
  committed: PolygonShape[]
}

export interface TileLayerState extends BaseLayer {
  kind: "tile"
  tiles: Map<H3Index, TileInstance>
  portals: Portal[]
}

export interface ItemsLayerState extends BaseLayer {
  kind: "items"
  items: ItemInstance[]
}

export type MapLayer = PolygonLayerState | TileLayerState | ItemsLayerState

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ElementRef =
  | { type: "tile"; layerId: string; h3: H3Index }
  | { type: "polygon"; layerId: string; id: string }
  | { type: "portal"; layerId: string; id: string }
  | { type: "item"; layerId: string; id: string }

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export type ActiveTool =
  | "paint"
  | "erase"
  | "polygon"
  | "portal"
  | "place-item"
  | "hand"

export interface UIState {
  activeTool: ActiveTool
  activeTypeId: string | null
  activeLayerId: string
  inProgressPolygon: H3Index[]
  portalPendingFrom: H3Index | null
  selectedElement: ElementRef | null
  hint: string | null
  showBoundingBox: boolean
  polygonVertexCount: number
  draggedPolygon: {
    layerId: string
    polyId: string
    originalCells: H3Index[]
    previewCells: H3Index[]
    sides: number
  } | null
  /** Non-null while a polygon is in vertex-edit mode */
  editingPolygon: { layerId: string; polyId: string } | null
  /** Live preview while a vertex is being dragged */
  vertexDragPreview: { cells: H3Index[]; vertices: H3Index[] } | null
}

// ---------------------------------------------------------------------------
// Root state
// ---------------------------------------------------------------------------

export interface MapEditorState {
  meta: MapMeta
  tileTypes: TileType[]
  itemTypes: ItemType[]
  rules: MovementRule[]
  /** Ordered bottom (index 0) to top — topmost layer that covers a cell wins */
  layers: MapLayer[]
  ui: UIState
}
