import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import type Phaser from "phaser";
import { cellTopLeft } from "./hexLayout.js";
import { parseItemRefs } from "./cellLookup.js";
import { spectatorLabelForItemRef } from "./itemSpectatorLabel.js";
import { SPECTATOR_UI_FONT_FAMILY } from "./spectatorFonts.js";

const ITEM_MARKER_DEPTH = 15;

const style: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: SPECTATOR_UI_FONT_FAMILY,
  fontSize: "10px",
  color: "#f5e6c8",
  align: "center",
  stroke: "#1a1520",
  strokeThickness: 3,
};

/**
 * Renders a short per-cell summary of `tileItemRefs` from Colyseus state (world objects on the ground).
 */
export class TileItemMarkers {
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<WorldSpectatorState>,
    private readonly tileWidth: number,
    private readonly tileHeight: number,
  ) {
    this.room.onStateChange(() => {
      this.syncFromState();
    });
    this.syncFromState();
  }

  destroy(): void {
    for (const t of this.labels.values()) {
      t.destroy();
    }
    this.labels.clear();
  }

  private syncFromState(): void {
    const active = new Set<string>();
    this.room.state.tileItemRefs.forEach((csv, cellId) => {
      const refs = parseItemRefs(csv);
      if (refs.length === 0) {
        return;
      }
      active.add(cellId);
      const coord = this.room.state.tileCoords.get(cellId);
      if (!coord) {
        return;
      }
      const { x, y } = cellTopLeft(coord.col, coord.row, this.tileWidth, this.tileHeight);
      const textBody = refs.map((r) => spectatorLabelForItemRef(this.room, r)).join("\n");
      let label = this.labels.get(cellId);
      if (!label) {
        label = this.scene.add.text(x + this.tileWidth * 0.5, y + this.tileHeight * 0.28, textBody, style);
        label.setOrigin(0.5, 0.5);
        label.setDepth(ITEM_MARKER_DEPTH);
        this.labels.set(cellId, label);
      } else {
        label.setText(textBody);
        label.setPosition(x + this.tileWidth * 0.5, y + this.tileHeight * 0.28);
      }
    });

    for (const [cellId, label] of this.labels) {
      if (!active.has(cellId)) {
        label.destroy();
        this.labels.delete(cellId);
      }
    }
  }
}
