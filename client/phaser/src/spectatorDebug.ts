import type { Room } from "colyseus.js";
import type Phaser from "phaser";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";

/** `?debug=1` in the URL, or `VITE_SPECTATOR_DEBUG=true` in env. */
export function spectatorDebugEnabled(): boolean {
  if (import.meta.env.VITE_SPECTATOR_DEBUG === "true") {
    return true;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const q = new URLSearchParams(window.location.search);
  return q.has("debug") || q.get("spectatorDebug") === "1";
}

function ghostsAtTile(room: Room<WorldSpectatorState>, tileId: string): string[] {
  const ids: string[] = [];
  room.state.ghostTiles.forEach((tid, ghostId) => {
    if (tid === tileId) {
      ids.push(ghostId);
    }
  });
  return ids;
}

function formatStateSnapshot(room: Room<WorldSpectatorState>): string {
  const lines: string[] = [];
  lines.push(`ghostTiles.size = ${room.state.ghostTiles.size}`);
  lines.push(`tileCoords.size = ${room.state.tileCoords.size}`);
  lines.push(`tileClasses.size = ${room.state.tileClasses.size}`);
  room.state.ghostTiles.forEach((tileId, ghostId) => {
    const c = room.state.tileCoords.get(tileId);
    const cls = room.state.tileClasses.get(tileId);
    lines.push(
      `  ${ghostId} → tile "${tileId}"  coord=${c ? `${c.col},${c.row}` : "MISSING"}  class=${cls ?? "?"}`,
    );
  });
  return lines.join("\n");
}

/**
 * Fixed overlay + per-tile hover (when tiles are made interactive).
 * Enable with `?debug=1` or `VITE_SPECTATOR_DEBUG=true`.
 */
export class SpectatorDebugHud {
  private readonly panel: Phaser.GameObjects.Text;
  private readonly tip: Phaser.GameObjects.Text;
  private readonly onState: () => void;
  private readonly onMove: (p: Phaser.Input.Pointer) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<WorldSpectatorState>,
  ) {
    const panelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "ui-monospace, Menlo, Monaco, monospace",
      fontSize: "11px",
      color: "#d7ecff",
      backgroundColor: "rgba(0,12,28,0.82)",
      padding: { x: 8, y: 6 },
    };
    const h = scene.scale.height;
    this.panel = scene.add.text(8, h - 140, "", panelStyle);
    this.panel.setScrollFactor(0);
    this.panel.setDepth(10_000);
    this.panel.setOrigin(0, 0);

    this.tip = scene.add.text(0, 0, "", {
      ...panelStyle,
      fontSize: "12px",
      color: "#fff",
      backgroundColor: "rgba(20,30,50,0.92)",
    });
    this.tip.setScrollFactor(0);
    this.tip.setDepth(10_001);
    this.tip.setVisible(false);

    this.onState = () => this.refreshPanel();
    this.room.onStateChange(this.onState);
    this.refreshPanel();

    this.onMove = (p: Phaser.Input.Pointer) => {
      if (this.tip.visible) {
        this.tip.setPosition(p.x + 14, p.y + 14);
      }
    };
    scene.input.on("pointermove", this.onMove);

    console.info("[spectator-debug] enabled — state snapshot:\n" + formatStateSnapshot(this.room));
  }

  /** Call after hex images are created; enables hover tooltips per cell. */
  attachTileHovers(
    tiles: readonly { img: Phaser.GameObjects.Image; col: number; row: number }[],
  ): void {
    const tileId = (col: number, row: number) => `${col},${row}`;
    for (const { img, col, row } of tiles) {
      const id = tileId(col, row);
      img.setInteractive({ useHandCursor: true });
      img.on("pointerover", () => {
        const tc = this.room.state.tileCoords.get(id);
        const cls = this.room.state.tileClasses.get(id);
        const ghosts = ghostsAtTile(this.room, id);
        this.tip.setText(
          [
            `tileId ${id}`,
            `grid (${col},${row})`,
            `tileCoords: ${tc ? `${tc.col},${tc.row}` : "MISSING"}`,
            `tileClass: ${cls ?? "?"}`,
            `ghosts here: ${ghosts.length ? ghosts.join(", ") : "(none)"}`,
          ].join("\n"),
        );
        this.tip.setVisible(true);
        const p = this.scene.input.activePointer;
        this.tip.setPosition(p.x + 14, p.y + 14);
      });
      img.on("pointerout", () => {
        this.tip.setVisible(false);
      });
    }
  }

  private refreshPanel(): void {
    const w = this.scene.scale.width;
    this.panel.setWordWrapWidth(Math.max(200, w - 16));
    this.panel.setText(`[spectator debug]\n${formatStateSnapshot(this.room)}`);
  }

  destroy(): void {
    this.room.onStateChange.remove(this.onState);
    this.scene.input.off("pointermove", this.onMove);
    this.panel.destroy();
    this.tip.destroy();
  }
}
