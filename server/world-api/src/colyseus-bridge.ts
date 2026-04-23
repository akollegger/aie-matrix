import type { LoadedMap, MatrixRoom } from "@aie-matrix/server-colyseus";

/**
 * In-process bridge from `world-api` into authoritative Colyseus room state (research.md).
 */
export interface ColyseusWorldBridge {
  getLoadedMap(): LoadedMap;
  getGhostCell(ghostId: string): string | undefined;
  setGhostCell(ghostId: string, cellId: string): void;
  /** Ghost ids whose authoritative tile is `cellId`. */
  listOccupantsOnCell(cellId: string): string[];
  setGhostMode(ghostId: string, mode: "normal" | "conversational"): void;
  getGhostMode(ghostId: string): "normal" | "conversational";
  /** Replace the item list on a tile. Pass empty array to clear (IC-012). */
  setTileItems(h3Index: string, itemRefs: string[]): void;
  /** Replace the carried item list for a ghost. Pass empty array to clear (IC-012). */
  setGhostInventory(ghostId: string, itemRefs: string[]): void;
  /** Spectator debug: last successful MCP tool label for this ghost. */
  setGhostLastAction(ghostId: string, label: string): void;
}

export function createColyseusBridge(room: MatrixRoom): ColyseusWorldBridge {
  return {
    getLoadedMap: () => room.getLoadedMap(),
    getGhostCell: (ghostId) => room.getGhostCell(ghostId),
    setGhostCell: (ghostId, cellId) => room.setGhostCell(ghostId, cellId),
    listOccupantsOnCell: (cellId) => room.listOccupantsOnCell(cellId),
    setGhostMode: (ghostId, mode) => room.setGhostMode(ghostId, mode),
    getGhostMode: (ghostId) => room.getGhostMode(ghostId),
    setTileItems: (h3Index, itemRefs) => room.setTileItems(h3Index, itemRefs),
    setGhostInventory: (ghostId, itemRefs) => room.setGhostInventory(ghostId, itemRefs),
    setGhostLastAction: (ghostId, label) => room.setGhostLastAction(ghostId, label),
  };
}
