import type { LoadedMap, MatrixRoom } from "@aie-matrix/server-colyseus";

/**
 * In-process bridge from `world-api` into authoritative Colyseus room state (research.md).
 */
export interface ColyseusWorldBridge {
  getLoadedMap(): LoadedMap;
  /**
   * Hot-swap the room's loaded map (called when the active live session switches to a new map).
   * Clears all ghost positions — the caller must also clear any external position caches.
   */
  setLoadedMap(map: LoadedMap): void;
  getGhostCell(ghostId: string): string | undefined;
  setGhostCell(ghostId: string, cellId: string): void;
  /** Remove a ghost from world state (RFC-0019 Barnacle Protocol — used when
   *  a mini-game session begins so the ghost vanishes from the spectator). */
  removeGhostCell(ghostId: string): void;
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
  /** Set character gram labels for an NPC ghost (e.g. "Character:Broker"). Cleared on ghost leave. */
  setGhostLabels(ghostId: string, labels: string): void;
  /**
   * Fan out a `world-v1` Colyseus message to every connected bridge client
   * (e.g. ghost house) — used after `say` to reach nearby Social agents.
   */
  fanoutWorldV1(payload: unknown): void;
}

export function createColyseusBridge(room: MatrixRoom): ColyseusWorldBridge {
  return {
    getLoadedMap: () => room.getLoadedMap(),
    setLoadedMap: (map) => room.setLoadedMap(map),
    getGhostCell: (ghostId) => room.getGhostCell(ghostId),
    setGhostCell: (ghostId, cellId) => room.setGhostCell(ghostId, cellId),
    removeGhostCell: (ghostId) => room.removeGhostCell(ghostId),
    listOccupantsOnCell: (cellId) => room.listOccupantsOnCell(cellId),
    setGhostMode: (ghostId, mode) => room.setGhostMode(ghostId, mode),
    getGhostMode: (ghostId) => room.getGhostMode(ghostId),
    setTileItems: (h3Index, itemRefs) => room.setTileItems(h3Index, itemRefs),
    setGhostInventory: (ghostId, itemRefs) => room.setGhostInventory(ghostId, itemRefs),
    setGhostLastAction: (ghostId, label) => room.setGhostLastAction(ghostId, label),
    setGhostLabels: (ghostId, labels) => room.setGhostLabels(ghostId, labels),
    fanoutWorldV1: (payload) => {
      room.broadcast("world-v1", payload);
    },
  };
}
