import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdoptGhostRequest, AdoptGhostResponse } from "@aie-matrix/shared-types";
import { isEnvTruthy } from "@aie-matrix/root-env";
import { Effect } from "effect";
import { getRequestTraceId } from "@aie-matrix/server-world-api";
import { mintGhostToken } from "@aie-matrix/server-auth";
import { WorldBridgeNoNavigableCells, WorldBridgeService } from "@aie-matrix/server-world-api";
import { assertAdoptionAllowed } from "../session-guard.js";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { createGhostId } from "../store.js";
import type { RegistryBadJson } from "../registry-errors.js";
import type { RegistryHttpError } from "../registry-errors.js";
import { readJsonBody, sendJson } from "../utils/http.js";

export interface AdoptionRuntimeDeps {
  readonly worldApiBaseUrl: string;
  /** When set, combined server forks a transcript subscriber fiber per adopted ghost. */
  readonly forkTranscriptSubscriber?: (ghostId: string) => void;
}

export function handleAdoptGhostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  deps: AdoptionRuntimeDeps,
): Effect.Effect<void, RegistryBadJson | RegistryHttpError | WorldBridgeNoNavigableCells, RegistryStoreService | WorldBridgeService> {
  return Effect.gen(function* () {
    if (req.method !== "POST") {
      yield* sendJson(res, corsHeaders, 405, { error: "METHOD_NOT_ALLOWED", message: "POST only" });
      return;
    }
    const body = yield* readJsonBody(req);
    const parsed = body as Partial<AdoptGhostRequest>;
    if (!parsed.caretakerId || !parsed.agentHostId) {
      yield* sendJson(res, corsHeaders, 400, {
        error: "VALIDATION",
        message: "caretakerId and agentHostId are required",
      });
      return;
    }
    const store = yield* RegistryStoreService;
    yield* assertAdoptionAllowed(store, parsed.caretakerId, parsed.agentHostId);
    console.info(
      JSON.stringify({
        kind: "registry.adopt",
        phase: "start",
        traceId: getRequestTraceId() ?? null,
        caretakerId: parsed.caretakerId,
        agentHostId: parsed.agentHostId,
      }),
    );
    const bridge = yield* WorldBridgeService;
    const map = bridge.getLoadedMap();
    const cellIds = [...map.cells.keys()];
    if (cellIds.length === 0) {
      return yield* Effect.fail(
        new WorldBridgeNoNavigableCells({ message: "Map has no navigable cells" }),
      );
    }
    // Spawn-cell selection precedence:
    //   1. AIE_MATRIX_TCK_MODE → map.anchorH3 (existing TCK behaviour)
    //   2. AIE_MATRIX_SPAWN_H3 → pin to a specific cell (validated to exist)
    //   3. random over navigable cells, EXCLUDING any tile that hosts a
    //      platform-class item (a "mini-game" tile — RDC saloon, future
    //      duel ground, etc.). Spawning on top of a mini-game tile would
    //      crowd out arrivals; we prevent it at adoption time.
    const explicitSpawn = process.env.AIE_MATRIX_SPAWN_H3?.trim();
    let spawnCell: string;
    if (isEnvTruthy(process.env.AIE_MATRIX_TCK_MODE)) {
      spawnCell = map.anchorH3;
    } else if (explicitSpawn) {
      if (!map.cells.has(explicitSpawn)) {
        return yield* Effect.fail(
          new WorldBridgeNoNavigableCells({
            message: `AIE_MATRIX_SPAWN_H3=${explicitSpawn} is not a navigable cell on the loaded map`,
          }),
        );
      }
      spawnCell = explicitSpawn;
    } else {
      // Filter out tiles that host items in any of the platform classes.
      // Item-class strings come from the gram ItemType label.
      const PLATFORM_ITEM_CLASSES = new Set(["PokerTable"]);
      const eligible = cellIds.filter((id) => {
        const cell = map.cells.get(id);
        if (!cell) return false;
        return !cell.initialItemRefs.some((ref) => PLATFORM_ITEM_CLASSES.has(ref));
      });
      const pool = eligible.length > 0 ? eligible : cellIds;
      spawnCell = pool[Math.floor(Math.random() * pool.length)]!;
    }
    const ghostId = createGhostId();
    bridge.setGhostCell(ghostId, spawnCell);
    store.ghosts.set(ghostId, {
      id: ghostId,
      agentHostId: parsed.agentHostId,
      caretakerId: parsed.caretakerId,
      h3Index: spawnCell,
      spawnH3Index: spawnCell, // remembered so /respawn can send the ghost back home
      status: "active",
      ...(typeof parsed.displayName === "string" && parsed.displayName.trim().length > 0
        ? { displayName: parsed.displayName.trim() }
        : {}),
      ...(typeof parsed.agentId === "string" && parsed.agentId.trim().length > 0
        ? { agentId: parsed.agentId.trim() }
        : {}),
    });
    store.activeByCaretaker.set(parsed.caretakerId, ghostId);
    const token = mintGhostToken({
      sub: ghostId,
      ghostId,
      caretakerId: parsed.caretakerId,
      agentHostId: parsed.agentHostId,
      ...(typeof parsed.agentId === "string" && parsed.agentId.trim().length > 0
        ? { agentId: parsed.agentId.trim() }
        : {}),
    });
    const out: AdoptGhostResponse = {
      ghostId,
      caretakerId: parsed.caretakerId,
      credential: {
        token,
        worldApiBaseUrl: deps.worldApiBaseUrl,
        transport: "http",
      },
    };
    yield* sendJson(res, corsHeaders, 201, out);
    console.info(
      JSON.stringify({
        kind: "registry.adopt",
        phase: "success",
        traceId: getRequestTraceId() ?? null,
        caretakerId: parsed.caretakerId,
        ghostId,
      }),
    );
    deps.forkTranscriptSubscriber?.(ghostId);
  });
}
