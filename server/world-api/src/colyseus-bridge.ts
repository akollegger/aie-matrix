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
}

export function createColyseusBridge(room: MatrixRoom): ColyseusWorldBridge {
  return {
    getLoadedMap: () => room.getLoadedMap(),
    getGhostCell: (ghostId) => room.getGhostCell(ghostId),
    setGhostCell: (ghostId, cellId) => room.setGhostCell(ghostId, cellId),
    listOccupantsOnCell: (cellId) => room.listOccupantsOnCell(cellId),
    setGhostMode: (ghostId, mode) => room.setGhostMode(ghostId, mode),
    getGhostMode: (ghostId) => room.getGhostMode(ghostId),
  };
}
