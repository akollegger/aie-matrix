/** Resolution-15 H3 cell index, e.g. "8f283082aa20c00" */
export type H3Index = string & { readonly __brand: "H3Index" }

export function h3Index(s: string): H3Index {
  return s as H3Index
}

// ---------------------------------------------------------------------------
// Map header
// ---------------------------------------------------------------------------

export interface MapMeta {
  kind: "matrix-map"
  name: string
  description?: string
  elevation: number
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface TileType {
  /** Gram identifier, e.g. "carpetedFloor" */
  id: string
  /** Gram label used on tile instances, e.g. "CarpetedFloor" */
  typeName: string
  name: string
  description?: string
  capacity?: number
  /** CSS expression stored as css`...` in gram, e.g. "background: #c8b89a" */
  style?: string
}

export interface ItemType {
  id: string
  typeName: string
  name: string
  description?: string
  glyph: string
  takeable: boolean
  capacityCost?: number
  style?: string
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export interface TileInstance {
  h3Index: H3Index
  typeName: string
  /** True when this cell was explicitly painted over a polygon's virtual tile */
  isOverride?: boolean
}

/** A polygon represented as its filled H3 cell set — rendered directly. */
export interface PolygonShape {
  id: string
  typeName: string
  /** All cells that make up this polygon area (no further polygonToCells needed) */
  cells: H3Index[]
  /** Number of sides (3 | 4 | 6) — determines the dashed outline anchor points */
  sides: number
  /** The N vertex H3 cells defining the shape corners; stored for vertex editing */
  vertices?: H3Index[]
}

export interface Portal {
  id: string
  fromH3: H3Index
  toH3: H3Index
  /** Open-ended string: "Elevator" | "Stairs" | "Door" | "Teleporter" | … */
  mode: string
}

export interface ItemInstance {
  id: string
  typeName: string
  h3Index: H3Index
}

// ---------------------------------------------------------------------------
// Movement rules
// ---------------------------------------------------------------------------

export interface MovementRule {
  fromTypeName: string
  toTypeName: string
}
