import type { Room } from "colyseus.js";
import type Phaser from "phaser";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import { SpectatorDebugHtmlOverlay } from "./spectatorDebugHtmlOverlay.js";
/** Colyseus `ghostModes` subscriptions (`onChange` / `onAdd`) live in {@link attachSpectatorDebugRoomEvents}. */
import { attachSpectatorDebugRoomEvents } from "./spectatorDebugRoomEvents.js";
import {
  SpectatorDebugLogRing,
  installSpectatorDebugConsoleForward,
  runSpectatorDebugEffectProbe,
} from "./spectatorDebugTelemetry.js";

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

/** Count itemRef tokens stored as comma-separated lists in a Colyseus string map. */
function commaListItemCount(map: { forEach: (cb: (v: string) => void) => void; readonly size: number }): number {
  let n = 0;
  map.forEach((csv) => {
    n += csv.split(",").map((s) => s.trim()).filter(Boolean).length;
  });
  return n;
}

function ghostInventoryLine(room: Room<WorldSpectatorState>, ghostId: string): string {
  const raw = room.state.ghostItemRefs.get(ghostId);
  if (!raw) {
    return "(empty)";
  }
  const refs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return refs.length ? refs.join(", ") : "(empty)";
}

function ghostLastActionLine(room: Room<WorldSpectatorState>, ghostId: string): string {
  return room.state.ghostLastActions.get(ghostId) ?? "—";
}

export function formatWorldSnapshot(room: Room<WorldSpectatorState>): string {
  const lines: string[] = [];
  lines.push(`ghostTiles.size = ${room.state.ghostTiles.size}`);
  lines.push(`tileCoords.size = ${room.state.tileCoords.size}`);
  lines.push(`tileClasses.size = ${room.state.tileClasses.size}`);
  lines.push(`tileItemRefs.entries = ${room.state.tileItemRefs.size}`);
  lines.push(`tileItemRefs.itemCount = ${commaListItemCount(room.state.tileItemRefs)}`);
  lines.push(`ghostItemRefs.entries = ${room.state.ghostItemRefs.size}`);
  lines.push(`ghostItemRefs.itemCount = ${commaListItemCount(room.state.ghostItemRefs)}`);
  return lines.join("\n");
}

export function formatStateSnapshot(room: Room<WorldSpectatorState>): string {
  const lines: string[] = [];
  lines.push(`ghostModes.size = ${room.state.ghostModes.size}`);
  room.state.ghostTiles.forEach((tileId, ghostId) => {
    const c = room.state.tileCoords.get(tileId);
    const cls = room.state.tileClasses.get(tileId);
    const mode = room.state.ghostModes.get(ghostId) ?? "normal";
    const inv = ghostInventoryLine(room, ghostId);
    const last = ghostLastActionLine(room, ghostId);
    lines.push(
      `  ${ghostId} → tile "${tileId}"  coord=${c ? `${c.col},${c.row}` : "MISSING"}  class=${cls ?? "?"}  mode=${mode}`,
    );
    lines.push(`    inventory: ${inv}`);
    lines.push(`    last action: ${last}`);
  });
  return lines.join("\n");
}

/**
 * HTML overlay (State / World / Log / Conversations) + Phaser hover tooltip.
 * Enable with `?debug=1` or `VITE_SPECTATOR_DEBUG=true`.
 *
 * Log tab: last 100 lines from `console.*` (after install) plus Effect logs routed through
 * {@link spectatorDebugZippedLoggerLayer} (see `spectatorDebugTelemetry.ts`).
 */
export class SpectatorDebugHud {
  private readonly logRing: SpectatorDebugLogRing;
  private readonly overlay: SpectatorDebugHtmlOverlay;
  private readonly restoreConsole: () => void;
  private readonly detachRoomEvents: () => void;
  private readonly tip: Phaser.GameObjects.Text;
  private readonly onState: () => void;
  private readonly onMove: (p: Phaser.Input.Pointer) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly room: Room<WorldSpectatorState>,
  ) {
    this.logRing = new SpectatorDebugLogRing();
    this.overlay = new SpectatorDebugHtmlOverlay(
      this.logRing,
      () => formatStateSnapshot(this.room),
      () => formatWorldSnapshot(this.room),
      {
        serverBase:
          (import.meta.env.VITE_SERVER_HTTP as string | undefined)?.replace(/\/$/, "") ??
          (import.meta.env.DEV ? "" : "http://127.0.0.1:8787"),
        token: ((__SPECTATOR_DEBUG_TOKEN__ as string) || undefined),
        getGhostIds: () => [...this.room.state.ghostTiles.keys()],
      },
    );

    runSpectatorDebugEffectProbe(this.logRing);
    this.detachRoomEvents = attachSpectatorDebugRoomEvents(this.room, (line) => this.logRing.append(line));
    this.restoreConsole = installSpectatorDebugConsoleForward(this.logRing);

    const panelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "ui-monospace, Menlo, Monaco, monospace",
      fontSize: "12px",
      color: "#fff",
      backgroundColor: "rgba(20,30,50,0.92)",
      padding: { x: 8, y: 6 },
    };

    this.tip = scene.add.text(0, 0, "", panelStyle);
    this.tip.setScrollFactor(0);
    this.tip.setDepth(10_001);
    this.tip.setVisible(false);

    this.onState = () => this.overlay.onRoomStateChanged();
    this.room.onStateChange(this.onState);
    this.overlay.onRoomStateChanged();

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

  destroy(): void {
    this.detachRoomEvents();
    this.room.onStateChange.remove(this.onState);
    this.scene.input.off("pointermove", this.onMove);
    this.restoreConsole();
    this.overlay.destroy();
    this.tip.destroy();
  }
}

export { spectatorDebugZippedLoggerLayer } from "./spectatorDebugTelemetry.js";
