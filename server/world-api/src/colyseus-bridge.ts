import type { LoadedMap, MatrixRoom } from "@aie-matrix/server-colyseus";

/**
 * In-process bridge from `world-api` into authoritative Colyseus room state (research.md).
 */
export interface ColyseusWorldBridge {
  getLoadedMap(): LoadedMap;
  getGhostCell(ghostId: string): string | undefined;
  setGhostCell(ghostId: string, cellId: string): void;
}

export function createColyseusBridge(room: MatrixRoom): ColyseusWorldBridge {
  return {
    getLoadedMap: () => room.getLoadedMap(),
    getGhostCell: (ghostId) => room.getGhostCell(ghostId),
    setGhostCell: (ghostId, cellId) => room.setGhostCell(ghostId, cellId),
  };
}
