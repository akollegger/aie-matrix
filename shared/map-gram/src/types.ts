/** A cost attached to a :GO rule edge. */
export interface ParsedRuleCost {
  resource: string;
  qty: number;
  /** Defaults to "world" if not declared on the edge. */
  payee: string;
}

/**
 * A role-based item grant, derived from per-item `[:Grants { role: qty, ... } | (itemRef)]` blocks.
 * Multiple Grants blocks are merged by role so consumers see one entry per role.
 */
export interface SpawnGrant {
  role: string;
  grants: Array<{ itemRef: string; qty: number }>;
}

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
  /** Role-based item grants, aggregated from all `[:Grants { role: qty } | (itemRef)]` blocks. */
  spawnGrants: SpawnGrant[];
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
  /**
   * Pascal-case label used in gram nodes (e.g., "BrassKey"). Matches values in `cell.items`.
   * Used as the canonical itemRef string throughout the system (ledger resource ID, MCP tool params, etc.).
   */
  typeName: string;
  name: string;
  description?: string;
  glyph?: string;
  takeable?: boolean;
  capacityCost?: number;
  /**
   * Consumable energy (in tokens — the LLM's literal substrate unit).
   * When set, each spawned instance of this type starts with this many
   * tokens; the `consume` MCP tool reduces the instance's remaining
   * tokens by the requested amount (default = remaining). When tokens
   * reach 0 the instance is removed from the world. Items without
   * `tokens` are not consumable.
   */
  tokens?: number;
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
  /** Cost to pay when traversing this edge. Absent if the edge is free. */
  cost?: ParsedRuleCost;
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

/**
 * An item placement from a `(:Item:X { geometry: [h3\`...\`] })` declaration, with layer membership.
 * `itemRef` is the Pascal-case ItemType label (e.g. "BrassKey") used as the ledger resource ID.
 * `qty` defaults to 1 when not declared in the gram source.
 */
export interface ParsedItemPlacement {
  h3Index: string;
  /** Pascal-case ItemType label — canonical itemRef string. */
  itemRef: string;
  layerIdentity: string;
  /** Number of units placed at this tile. Defaults to 1. */
  qty: number;
}

export class MapGramParseError extends Error {
  override readonly name = "MapGramParseError" as const;

  constructor(
    /** Discriminant identifying the failure class. */
    public readonly reason: "missing-layer-stack" | "invalid-h3" | "gram-syntax" | "resources-block-forbidden",
    public readonly detail?: string,
  ) {
    super(detail ?? reason);
  }
}
