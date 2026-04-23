import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import { cellTopLeft } from "../hexLayout.js";
import { SpectatorDebugHud } from "../spectatorDebug.js";
import { TileItemMarkers } from "../tileItemMarkers.js";
import { SpectatorView } from "./SpectatorView.js";

interface TmjLayer {
  data: number[];
  width: number;
  height: number;
}

interface TmjTilesetRef {
  firstgid: number;
}

interface TmjMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TmjLayer[];
  tilesets: TmjTilesetRef[];
}

export interface WorldSceneInit {
  room: Room<WorldSpectatorState>;
  assetBaseUrl: string;
  /** When true, HUD + tile hover + extra Colyseus logs (`?debug=1` or `VITE_SPECTATOR_DEBUG=true`). */
  spectatorDebug?: boolean;
}

export class WorldScene extends Phaser.Scene {
  private room!: Room<WorldSpectatorState>;
  private assetBaseUrl!: string;
  private spectatorDebug = false;
  private spectator?: SpectatorView;
  private tileItems?: TileItemMarkers;
  private debugHud?: SpectatorDebugHud;

  constructor() {
    super({ key: "WorldScene" });
  }

  init(data: WorldSceneInit): void {
    this.room = data.room;
    this.assetBaseUrl = data.assetBaseUrl.replace(/\/$/, "");
    this.spectatorDebug = data.spectatorDebug === true;
  }

  preload(): void {
    const mapDir = __AIE_MAP_PATH__.replace(/\/[^/]+$/, "");
    this.load.spritesheet("hex", `${this.assetBaseUrl}/maps/${mapDir}/rainbow-hexes.png`, {
      frameWidth: 32,
      frameHeight: 28,
    });
  }

  async create(): Promise<void> {
    const res = await fetch(`${this.assetBaseUrl}/maps/${__AIE_MAP_PATH__}`);
    const tmj = (await res.json()) as TmjMap;
    const layer = tmj.layers?.[0];
    if (!layer?.data?.length) {
      throw new Error("TMJ missing layer data");
    }
    const firstgid = tmj.tilesets?.[0]?.firstgid ?? 1;
    const tw = tmj.tilewidth;
    const th = tmj.tileheight;

    const gidAt = (col: number, row: number): number => layer.data[row * tmj.width + col] ?? 0;

    const tileImages: { img: Phaser.GameObjects.Image; col: number; row: number }[] = [];
    for (let row = 0; row < tmj.height; row++) {
      for (let col = 0; col < tmj.width; col++) {
        const gid = gidAt(col, row);
        if (gid === 0) {
          continue;
        }
        const local = gid - firstgid;
        const { x, y } = cellTopLeft(col, row, tw, th);
        const img = this.add.image(x, y, "hex", local);
        img.setOrigin(0, 0);
        img.setDepth(0);
        tileImages.push({ img, col, row });
      }
    }

    const cam = this.cameras.main;
    cam.centerOn((tmj.width * tw * 0.75) / 2, (tmj.height * th) / 2);

    if (this.spectatorDebug) {
      this.debugHud = new SpectatorDebugHud(this, this.room);
      this.debugHud.attachTileHovers(tileImages);
    }

    this.spectator = new SpectatorView(this, this.room, tw, th, this.spectatorDebug);
    this.tileItems = new TileItemMarkers(this, this.room, tw, th);

    if (this.spectatorDebug && typeof window !== "undefined") {
      const spectator = this.spectator;
      (window as unknown as { __aieSpectatorE2e: SpectatorE2eHook }).__aieSpectatorE2e = {
        ghostTilesSize: () => this.room.state.ghostTiles.size,
        tileCoordsSize: () => this.room.state.tileCoords.size,
        ghostMarkerCount: () => spectator.getMarkerCount(),
        stateSyncCount: () => spectator.getStateSyncCount(),
      };
    }
  }

  shutdown(): void {
    if (typeof window !== "undefined") {
      delete (window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook }).__aieSpectatorE2e;
    }
    this.debugHud?.destroy();
    this.debugHud = undefined;
    this.tileItems?.destroy();
    this.tileItems = undefined;
    this.spectator?.destroy();
    this.spectator = undefined;
  }
}

/** Exposed on `window` when spectator debug is on (`?debug=1`) for Playwright / manual checks. */
interface SpectatorE2eHook {
  ghostTilesSize(): number;
  tileCoordsSize(): number;
  ghostMarkerCount(): number;
  stateSyncCount(): number;
}
