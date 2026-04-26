import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import {
  getColyseusLinkState,
  joinWorldSpectator,
  onColyseusLinkState,
  onSpectatorRoom,
} from "../services/colyseusClient.js";
import type { GhostPosition } from "../types/ghostPosition.js";
import type { ColyseusLinkState } from "../types/spectator.js";

type GhostMap = Map<string, GhostPosition>;

/**
 * Live `ghostTiles` from the spectator room; `previousH3Index` is the last cell before the
 * current `h3Index` when the ghost moves (T031, FR-005).
 */
export function useColyseus(): {
  readonly ghosts: ReadonlyMap<string, GhostPosition>;
  readonly connectionState: ColyseusLinkState;
} {
  const [ghosts, setGhosts] = useState<GhostMap>(() => new Map());
  const [connectionState, setConnectionState] = useState<ColyseusLinkState>(getColyseusLinkState);
  const [room, setRoom] = useState<Room<WorldSpectatorState> | null>(null);

  useEffect(() => onColyseusLinkState(setConnectionState), []);
  useEffect(() => onSpectatorRoom(setRoom), []);

  useEffect(() => {
    if (connectionState !== "reconnecting") {
      return;
    }
    const t = window.setTimeout(() => {
      void joinWorldSpectator().catch(() => {
        /* leave state as reconnecting / disconnected */
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [connectionState]);

  useEffect(() => {
    void joinWorldSpectator().catch(() => {
      /* dev without server */
    });
  }, []);

  useEffect(() => {
    if (!room) {
      return;
    }
    const initial: GhostMap = new Map();
    room.state.ghostTiles.forEach((h3, ghostId) => {
      initial.set(ghostId, { ghostId, h3Index: h3 });
    });
    setGhosts(initial);

    room.state.ghostTiles.onAdd((h3, ghostId) => {
      setGhosts((prev) => {
        const next = new Map(prev);
        const prior = next.get(ghostId)?.h3Index;
        next.set(ghostId, {
          ghostId,
          h3Index: h3,
          previousH3Index: prior !== h3 ? prior : next.get(ghostId)?.previousH3Index,
        });
        return next;
      });
    });
    room.state.ghostTiles.onChange((h3, ghostId) => {
      setGhosts((prev) => {
        const next = new Map(prev);
        const old = next.get(ghostId);
        const prior = old?.h3Index;
        next.set(ghostId, {
          ghostId,
          h3Index: h3,
          previousH3Index: prior !== h3 ? prior : old?.previousH3Index,
        });
        return next;
      });
    });
    room.state.ghostTiles.onRemove((_h3, ghostId) => {
      setGhosts((prev) => {
        const next = new Map(prev);
        next.delete(ghostId);
        return next;
      });
    });
  }, [room]);

  return { ghosts, connectionState };
}
