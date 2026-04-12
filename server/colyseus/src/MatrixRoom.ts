import { join } from "node:path";
import { Room } from "@colyseus/core";
import { MapSchema, Schema, type } from "@colyseus/schema";
import type { LoadedMap } from "./mapTypes.js";
import { loadHexMap } from "./mapLoader.js";

export class WorldSyncState extends Schema {
  /** ghostId → cell id (`col,row`). */
  @type({ map: "string" })
  ghostTiles = new MapSchema<string>();
}

export interface MatrixRoomOptions {
  mapPath?: string;
}

export class MatrixRoom extends Room<WorldSyncState> {
  private loadedMap!: LoadedMap;

  getLoadedMap(): LoadedMap {
    return this.loadedMap;
  }

  async onCreate(options: MatrixRoomOptions): Promise<void> {
    const mapPath =
      options.mapPath ??
      process.env.AIE_MATRIX_MAP ??
      join(process.cwd(), "maps/sandbox/freeplay.tmj");
    this.loadedMap = await loadHexMap(mapPath);
    this.setState(new WorldSyncState());
  }

  /** Broadcast a lightweight patch envelope for spectators (Phase 4 will shape payload). */
  emitGhostPatch(): void {
    const plain: Record<string, string> = {};
    this.state.ghostTiles.forEach((tileId, ghostId) => {
      plain[ghostId] = tileId;
    });
    this.broadcast("ghost-patch", plain);
  }

  setGhostCell(ghostId: string, cellId: string): void {
    this.state.ghostTiles.set(ghostId, cellId);
    this.emitGhostPatch();
  }

  getGhostCell(ghostId: string): string | undefined {
    return this.state.ghostTiles.get(ghostId);
  }
}
