/**
 * @see `specs/011-intermedium-client/data-model.md` (WorldTile)
 */

export type TileType = "open" | "vendor" | "session" | "lounge" | "corridor" | string;

export interface WorldTile {
  readonly h3Index: string;
  readonly tileType: TileType;
  readonly items: readonly string[];
  /** Adjacent H3 cells (res-15); derived from H3 topology when not authored in the gram. */
  readonly neighbors: readonly string[];
}
