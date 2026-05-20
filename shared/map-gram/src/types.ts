export interface ParsedMap {
  name: string;
  elevation: number;
  tileTypes: Map<string, TileTypeDef>;
  itemTypes: Map<string, ItemTypeDef>;
  /**
   * All navigable and item-bearing cells after layer merging, keyed by H3 res-15 index.
   * Includes cells expanded from polygon fills. Use for runtime navigation (Colyseus, movement).
   */
  cells: Map<string, ParsedCell>;
  /** Layer definitions in LayerStack order (index 0 = bottom / rendered first). */
  layers: ParsedLayer[];
  /**
   * Explicit single-tile declarations only — `(:Tile:X { geometry: [h3\`...\`] })` nodes.
   * Does NOT include tiles derived from polygon expansion.
   * Use for Neo4j seeding to preserve round-trip fidelity.
   */
  explicitTiles: ParsedExplicitTile[];
  /**
   * Polygon region definitions before expansion — `(:Polygon:X { geometry: [...] })` nodes.
   * Use for Neo4j seeding; expand vertices to cells only when needed for navigation.
   */
  polygons: ParsedPolygon[];
  /** Item placements from all layers, preserving layer membership. Use for Neo4j seeding. */
  itemPlacements: ParsedItemPlacement[];
  portals: ParsedPortal[];
  rules: ParsedRule[];
}

export interface ParsedCell {
  h3Index: string;
  /** TypeName label from the gram document (e.g., "Floor", "Pillar"). */
  tileType: string;
  /** ItemType names placed at this cell. */
  items: string[];
}

/** A layer definition from the gram, in LayerStack order. */
export interface ParsedLayer {
  identity: string;
  kind: "polygon" | "tile" | "items";
  name: string;
  /** Position in the LayerStack: 0 = bottom (rendered first), higher = rendered on top. */
  stackOrder: number;
}

export interface TileTypeDef {
  identity: string;
  /** Pascal-case label used in gram nodes (e.g., "Floor", "Pillar"). Matches `cell.tileType`. */
  typeName: string;
  name: string;
  description?: string;
  capacity?: number;
  style?: string;
}

export interface ItemTypeDef {
  identity: string;
  /** Pascal-case label used in gram nodes (e.g., "BrassKey"). Matches values in `cell.items`. */
  typeName: string;
  name: string;
  description?: string;
  glyph?: string;
  takeable?: boolean;
  capacityCost?: number;
}

export interface ParsedPortal {
  fromCell: string;
  toCell: string;
  mode: string;
  layerIdentity: string;
}

export interface ParsedRule {
  fromType: string;
  toType: string;
}

/** A single explicit tile placement from a `(:Tile:X { geometry: [h3\`...\`] })` declaration. */
export interface ParsedExplicitTile {
  h3Index: string;
  tileType: string;
  layerIdentity: string;
}

/**
 * A polygon region definition from a `(:Polygon:X { geometry: [...] })` declaration.
 * Vertices are H3 indices; expansion to individual H3 cells is the caller's responsibility.
 */
export interface ParsedPolygon {
  typeName: string;
  /** H3 vertex indices defining the polygon boundary. */
  vertices: string[];
  layerIdentity: string;
  /** Human name for the polygon region (e.g. "Main Stage"). Used for speaker room claiming. */
  name?: string;
  description?: string;
}

/** An item placement from a `(:Item:X { geometry: [h3\`...\`] })` declaration, with layer membership. */
export interface ParsedItemPlacement {
  h3Index: string;
  itemTypeName: string;
  layerIdentity: string;
}

export class MapGramParseError extends Error {
  override readonly name = "MapGramParseError" as const;

  constructor(
    /** Discriminant identifying the failure class. */
    public readonly reason: "missing-layer-stack" | "invalid-h3" | "gram-syntax",
    public readonly detail?: string,
  ) {
    super(detail ?? reason);
  }
}
