import type { MapContext } from "../../src/converter/map-context.js";

/** Shared hex frame for projecting cells (anchor + Tiled hex geometry). */
export interface HexMapFrame {
  readonly ctx: MapContext;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export interface ParityItemInstance {
  readonly h3: string;
  /** Item class label (`ItemType` in gram, `itemClass` in sidecar). */
  readonly itemClass: string;
}

/**
 * Logical tile coloration after polygon fill + layout override (matches Phaser/TMJ intent).
 */
export interface ParityRenderModel {
  readonly frame: HexMapFrame;
  /** Merged terrain: polygon interiors then explicit layout/gram cells. */
  readonly terrain: ReadonlyMap<string, string>;
  readonly items: readonly ParityItemInstance[];
  /** Optional gram `TileType` colors keyed by type label (overrides fallbacks when present). */
  readonly tileColorsFromGram?: ReadonlyMap<string, string>;
}
