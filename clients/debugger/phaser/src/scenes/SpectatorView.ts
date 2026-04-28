import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import type Phaser from "phaser";
import { cellCenter } from "../hexLayout.js";

const ghostPalette = [
  0xf9_71_71, 0xf9_a8_52, 0xfa_cc_15, 0xa3_e6_35, 0x34_d3_99, 0x60_a5_fa, 0xa7_8b_fa, 0xf4_72_b6,
];

/**
 * Renders ghost markers from Colyseus `ghostTiles` + static `tileCoords` (IC-004).
 */
export class SpectatorView {
  private readonly ghostSprites = new Map<string, Phaser.GameObjects.Arc>();
  private stateSyncCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<WorldSpectatorState>,
    private readonly tileWidth: number,
    private readonly tileHeight: number,
    private readonly debug = false,
  ) {
    this.room.onStateChange(() => {
      this.syncFromState();
    });
    this.syncFromState();
  }

  destroy(): void {
    for (const g of this.ghostSprites.values()) {
      g.destroy();
    }
    this.ghostSprites.clear();
  }

  /** Phaser ghost markers currently drawn (arcs with a resolved tile coord). */
  getMarkerCount(): number {
    return this.ghostSprites.size;
  }

  /** How many times `syncFromState` ran (initial + each Colyseus `onStateChange`). */
  getStateSyncCount(): number {
    return this.stateSyncCount;
  }

  private syncFromState(): void {
    this.stateSyncCount += 1;
    const active = new Set<string>();
    this.room.state.ghostTiles.forEach((tileId, ghostId) => {
      active.add(ghostId);
      const coord = this.room.state.tileCoords.get(tileId);
      if (!coord) {
        if (this.debug) {
          console.warn(
            `[spectator-debug] ghost "${ghostId}" tileId "${tileId}" has no tileCoords entry (ghost marker skipped)`,
          );
        }
        return;
      }
      const { x, y } = cellCenter(coord.col, coord.row, this.tileWidth, this.tileHeight);
      let arc = this.ghostSprites.get(ghostId);
      if (!arc) {
        arc = this.scene.add.circle(x, y, 10, colorForGhost(ghostId), 0.95);
        arc.setStrokeStyle(2, 0xff_ff_ff, 0.9);
        arc.setDepth(20);
        this.ghostSprites.set(ghostId, arc);
      } else {
        arc.setPosition(x, y);
      }
    });
    for (const [id, arc] of this.ghostSprites) {
      if (!active.has(id)) {
        arc.destroy();
        this.ghostSprites.delete(id);
      }
    }
    if (this.debug) {
      console.info(
        `[spectator-debug] sync ghosts=${active.size} sprites=${this.ghostSprites.size} (tileCoords keys=${this.room.state.tileCoords.size})`,
      );
    }
  }
}

function colorForGhost(ghostId: string): number {
  let h = 0;
  for (let i = 0; i < ghostId.length; i++) {
    h = (h * 31 + ghostId.charCodeAt(i)) >>> 0;
  }
  return ghostPalette[h % ghostPalette.length] ?? 0xff_ff_ff;
}
