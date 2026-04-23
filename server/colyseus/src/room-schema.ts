import { MapSchema, Schema, type } from "@colyseus/schema";

/**
 * IC-004 — Offset grid coordinates for a navigable cell (keys are H3 res-15 index strings).
 * Populated once from the loaded map; ghosts only mutate `ghostTiles`.
 */
export class TileCoord extends Schema {
  @type("number")
  declare col: number;

  @type("number")
  declare row: number;

  constructor(col = 0, row = 0) {
    super();
    this.col = col;
    this.row = row;
  }
}

/**
 * IC-004 — Optional per-tile class string (Tiled `type`) for spectator styling.
 */
export class WorldSpectatorState extends Schema {
  /** ghostId → H3 res-15 cell index string. Authoritative ghost positions (patched on move). */
  @type({ map: "string" })
  declare ghostTiles: MapSchema<string>;

  /** h3Index → grid coordinates (static after room creation; Phaser still uses col/row). */
  @type({ map: TileCoord })
  declare tileCoords: MapSchema<TileCoord>;

  /** h3Index → Tiled tile class string (static after room creation). */
  @type({ map: "string" })
  declare tileClasses: MapSchema<string>;

  /** ghostId → "normal" | "conversational". Absent key defaults to "normal". */
  @type({ map: "string" })
  declare ghostModes: MapSchema<string>;

  /**
   * h3Index → comma-separated itemRef list (IC-012).
   * e.g. "key-brass,statue". Delete key when tile has no items.
   */
  @type({ map: "string" })
  declare tileItemRefs: MapSchema<string>;

  /**
   * itemRef → short spectator glyph string (from `ItemDefinition.glyph` at map load; clipped server-side).
   * Absent key means clients should fall back to showing the `itemRef` string.
   */
  @type({ map: "string" })
  declare itemGlyphs: MapSchema<string>;

  /**
   * ghostId → comma-separated itemRef list (IC-012).
   * Delete key when ghost carries nothing.
   */
  @type({ map: "string" })
  declare ghostItemRefs: MapSchema<string>;

  /** ghostId → short label of the last successful MCP tool (spectator debug HUD). */
  @type({ map: "string" })
  declare ghostLastActions: MapSchema<string>;

  constructor() {
    super();
    // Must assign after `super()` so @type accessors run (`$changes.setParent` / root `allChanges`).
    // Do not use class fields for these maps: with `useDefineForClassFields`, they emit own data
    // properties that shadow accessors and break `encodeAll()` (empty ROOM_STATE for spectators).
    this.ghostTiles = new MapSchema<string>();
    this.tileCoords = new MapSchema<TileCoord>();
    this.tileClasses = new MapSchema<string>();
    this.ghostModes = new MapSchema<string>();
    this.tileItemRefs = new MapSchema<string>();
    this.itemGlyphs = new MapSchema<string>();
    this.ghostItemRefs = new MapSchema<string>();
    this.ghostLastActions = new MapSchema<string>();
  }
}

/** @deprecated Use `WorldSpectatorState` (same class; kept for older imports). */
export const WorldSyncState = WorldSpectatorState;

/** Plain JSON snapshot for docs / debugging (not wire format). */
export interface SpectatorStateSnapshot {
  ghosts: Record<string, string>;
  tiles: Record<string, { col: number; row: number; tileClass: string }>;
}
