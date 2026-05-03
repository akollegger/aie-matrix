export interface ParsedMap {
  name: string;
  elevation: number;
  tileTypes: Map<string, TileTypeDef>;
  itemTypes: Map<string, ItemTypeDef>;
  /** Navigable and item-bearing cells, keyed by H3 res-15 index. */
  cells: Map<string, ParsedCell>;
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
}

export interface ParsedRule {
  fromType: string;
  toType: string;
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
