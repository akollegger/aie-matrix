import { MapSchema, Schema, type } from "@colyseus/schema";

/**
 * IC-004 — Offset grid coordinates for a navigable cell id (`col,row` string).
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
  /** ghostId → tile id (`col,row`). Authoritative ghost positions (patched on move). */
  @type({ map: "string" })
  declare ghostTiles: MapSchema<string>;

  /** tileId → grid coordinates (static after room creation). */
  @type({ map: TileCoord })
  declare tileCoords: MapSchema<TileCoord>;

  /** tileId → Tiled tile class string (static after room creation). */
  @type({ map: "string" })
  declare tileClasses: MapSchema<string>;

  constructor() {
    super();
    // Must assign after `super()` so @type accessors run (`$changes.setParent` / root `allChanges`).
    // Do not use class fields for these maps: with `useDefineForClassFields`, they emit own data
    // properties that shadow accessors and break `encodeAll()` (empty ROOM_STATE for spectators).
    this.ghostTiles = new MapSchema<string>();
    this.tileCoords = new MapSchema<TileCoord>();
    this.tileClasses = new MapSchema<string>();
  }
}

/** @deprecated Use `WorldSpectatorState` (same class; kept for older imports). */
export const WorldSyncState = WorldSpectatorState;

/** Plain JSON snapshot for docs / debugging (not wire format). */
export interface SpectatorStateSnapshot {
  ghosts: Record<string, string>;
  tiles: Record<string, { col: number; row: number; tileClass: string }>;
}
