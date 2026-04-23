import { join } from "node:path";
import { isEnvTruthy } from "@aie-matrix/root-env";
import { Room } from "@colyseus/core";
import type { ItemDefinition } from "@aie-matrix/shared-types";
import type { LoadedMap } from "./mapTypes.js";
import { loadHexMap } from "./mapLoader.js";
import { TileCoord, WorldSpectatorState } from "./room-schema.js";

export interface MatrixRoomOptions {
  mapPath?: string;
  itemsPath?: string;
}

/** Max UTF-16 code units stored per `ItemDefinition.glyph` in `WorldSpectatorState.itemGlyphs`. */
const MAX_ITEM_GLYPH_UTF16 = 8;

function clipGlyphForSpectator(raw: string): string {
  const t = raw.trim();
  if (t.length <= MAX_ITEM_GLYPH_UTF16) {
    return t;
  }
  return t.slice(0, MAX_ITEM_GLYPH_UTF16);
}

function seedItemGlyphsFromSidecar(
  sidecar: Map<string, ItemDefinition>,
  emit: (itemRef: string, glyph: string) => void,
): void {
  for (const [ref, def] of sidecar) {
    const g = def.glyph;
    if (typeof g !== "string") {
      continue;
    }
    const clipped = clipGlyphForSpectator(g);
    if (clipped.length === 0) {
      continue;
    }
    emit(ref, clipped);
  }
}

export class MatrixRoom extends Room<WorldSpectatorState> {
  private loadedMap!: LoadedMap;
  /** Server-side source of truth for ghost positions (MCP, etc.); kept in lockstep with `state.ghostTiles`. */
  private readonly ghostCellByGhostId = new Map<string, string>();

  getLoadedMap(): LoadedMap {
    return this.loadedMap;
  }

  async onCreate(options: MatrixRoomOptions): Promise<void> {
    // PoC world room must stay in matchmaker with zero clients; default autoDispose
    // removes it after the seat-reservation window, breaking joinById + /spectator/room.
    this.autoDispose = false;
    const mapPath =
      options.mapPath ??
      process.env.AIE_MATRIX_MAP ??
      join(process.cwd(), "maps/sandbox/freeplay.tmj");
    const itemsPath = options.itemsPath ?? process.env.AIE_MATRIX_ITEMS;
    this.loadedMap = await loadHexMap(mapPath, { itemsPath });
    this.setState(new WorldSpectatorState());
    for (const [cellId, rec] of this.loadedMap.cells) {
      const tc = new TileCoord(rec.col, rec.row);
      this.state.tileCoords.set(cellId, tc);
      this.state.tileClasses.set(cellId, rec.tileClass);
    }
    seedItemGlyphsFromSidecar(this.loadedMap.itemSidecar, (ref, glyph) => {
      this.state.itemGlyphs.set(ref, glyph);
    });
  }

  /** Broadcast a lightweight patch envelope (optional for non-schema listeners). */
  emitGhostPatch(): void {
    const plain: Record<string, string> = {};
    for (const [ghostId, cellId] of this.ghostCellByGhostId) {
      plain[ghostId] = cellId;
    }
    this.broadcast("ghost-patch", plain);
  }

  setGhostCell(ghostId: string, cellId: string): void {
    const gid = String(ghostId).trim();
    const cid = String(cellId).trim();
    this.ghostCellByGhostId.set(gid, cid);
    this.state.ghostTiles.set(gid, cid);
    if (isEnvTruthy(process.env.AIE_MATRIX_DEBUG)) {
      console.info(`[aie-matrix] MatrixRoom.setGhostCell ghost=${gid} cell=${cid}`);
    }
    this.emitGhostPatch();
  }

  getGhostCell(ghostId: string): string | undefined {
    const gid = String(ghostId).trim();
    const fromMap = this.ghostCellByGhostId.get(gid);
    if (fromMap !== undefined) {
      return fromMap;
    }
    const fromSchema = this.state.ghostTiles.get(gid);
    if (fromSchema !== undefined) {
      this.ghostCellByGhostId.set(gid, fromSchema);
    }
    return fromSchema;
  }

  listOccupantsOnCell(cellId: string): string[] {
    const cid = String(cellId).trim();
    const ids: string[] = [];
    for (const [ghostId, tile] of this.ghostCellByGhostId) {
      if (tile === cid) {
        ids.push(ghostId);
      }
    }
    return ids;
  }

  setGhostMode(ghostId: string, mode: "normal" | "conversational"): void {
    const gid = String(ghostId).trim();
    this.state.ghostModes.set(gid, mode);
  }

  getGhostMode(ghostId: string): "normal" | "conversational" {
    const gid = String(ghostId).trim();
    const mode = this.state.ghostModes.get(gid);
    return mode === "conversational" ? "conversational" : "normal";
  }

  setTileItems(h3Index: string, itemRefs: string[]): void {
    if (itemRefs.length === 0) {
      this.state.tileItemRefs.delete(h3Index);
    } else {
      this.state.tileItemRefs.set(h3Index, itemRefs.join(","));
    }
  }

  setGhostInventory(ghostId: string, itemRefs: string[]): void {
    const gid = String(ghostId).trim();
    if (itemRefs.length === 0) {
      this.state.ghostItemRefs.delete(gid);
    } else {
      this.state.ghostItemRefs.set(gid, itemRefs.join(","));
    }
  }

  setGhostLastAction(ghostId: string, label: string): void {
    const gid = String(ghostId).trim();
    const text = String(label).trim();
    if (text === "") {
      this.state.ghostLastActions.delete(gid);
      return;
    }
    const clipped = text.length > 200 ? `${text.slice(0, 197)}…` : text;
    this.state.ghostLastActions.set(gid, clipped);
  }
}
