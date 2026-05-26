import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { isEnvTruthy } from "@aie-matrix/root-env";
import { mintGhostToken } from "@aie-matrix/server-auth";
import {
  WorldBridgeService,
  WorldBridgeNoNavigableCells,
  RegistryStoreService,
  RedisGhostStoreService,
  getRequestTraceId,
} from "@aie-matrix/server-world-api";
import { createGhostId } from "../store.js";
import type { RegistryBadJson } from "../registry-errors.js";
import type { RegistryHttpError } from "../registry-errors.js";
import { readJsonBody, sendJson } from "../utils/http.js";

export interface SpawnGhostDeps {
  readonly worldApiBaseUrl: string;
}

export function handleSpawnGhostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  deps: SpawnGhostDeps,
): Effect.Effect<void, RegistryBadJson | RegistryHttpError | WorldBridgeNoNavigableCells, RegistryStoreService | WorldBridgeService | RedisGhostStoreService> {
  return Effect.gen(function* () {
    if (req.method !== "POST") {
      yield* sendJson(res, corsHeaders, 405, { error: "METHOD_NOT_ALLOWED", message: "POST only" });
      return;
    }
    const body = yield* readJsonBody(req);
    const agentId = typeof (body as { agentId?: string }).agentId === "string"
      ? (body as { agentId: string }).agentId
      : undefined;

    const bridge = yield* WorldBridgeService;
    const map = bridge.getLoadedMap();
    const cellIds = [...map.cells.keys()];
    if (cellIds.length === 0) {
      return yield* Effect.fail(new WorldBridgeNoNavigableCells({ message: "Map has no navigable cells" }));
    }
    const spawnCell = isEnvTruthy(process.env.AIE_MATRIX_TCK_MODE)
      ? map.anchorH3
      : cellIds[Math.floor(Math.random() * cellIds.length)];

    const ghostId = createGhostId();
    bridge.setGhostCell(ghostId, spawnCell);

    // Store in in-memory registry store (for within-pod reseed path in
    // authoritativeGhostTileEffect). spawnH3Index records the spawn
    // position so Barnacle Protocol's /respawn route can teleport the
    // ghost back here when a mini-game session ends.
    const store = yield* RegistryStoreService;
    store.ghosts.set(ghostId, {
      id: ghostId,
      h3Index: spawnCell,
      spawnH3Index: spawnCell,
      status: "active",
    });

    // Persist to Redis (cross-pod, survives restarts)
    const redisStore = yield* RedisGhostStoreService;
    yield* redisStore.set(ghostId, {
      ghostId,
      agentId,
      h3Index: spawnCell,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    const token = mintGhostToken({
      sub: ghostId,
      ghostId,
    });

    console.info(JSON.stringify({
      kind: "registry.spawn-ghost",
      ghostId,
      agentId: agentId ?? null,
      h3Index: spawnCell,
      traceId: getRequestTraceId() ?? null,
    }));

    yield* sendJson(res, corsHeaders, 201, {
      ghostId,
      credential: {
        token,
        worldApiBaseUrl: deps.worldApiBaseUrl,
        transport: "http",
      },
    });
  });
}
