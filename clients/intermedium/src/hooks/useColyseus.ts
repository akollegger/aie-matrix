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

  useEffect(() => onColyseusLinkState((s) => {
    console.debug("[colyseus] linkState →", s);
    setConnectionState(s);
  }), []);
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
      console.debug("[colyseus] room effect: null — skipping listener setup");
      return;
    }
    const initial: GhostMap = new Map();
    room.state.ghostTiles.forEach((h3, ghostId) => {
      initial.set(ghostId, { ghostId, h3Index: h3 });
    });
    console.debug("[colyseus] room effect: initial ghosts", Array.from(initial.keys()));
    setGhosts(initial);

    room.state.ghostTiles.onAdd((h3, ghostId) => {
      console.debug("[colyseus] onAdd", ghostId, h3);
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
      console.debug("[colyseus] onChange", ghostId, h3);
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
      console.debug("[colyseus] onRemove", ghostId);
      setGhosts((prev) => {
        const next = new Map(prev);
        next.delete(ghostId);
        return next;
      });
    });
  }, [room]);

  return { ghosts, connectionState };
}
