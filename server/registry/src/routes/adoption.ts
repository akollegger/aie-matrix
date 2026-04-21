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
    if (!parsed.caretakerId || !parsed.ghostHouseId) {
      yield* sendJson(res, corsHeaders, 400, {
        error: "VALIDATION",
        message: "caretakerId and ghostHouseId are required",
      });
      return;
    }
    const store = yield* RegistryStoreService;
    yield* assertAdoptionAllowed(store, parsed.caretakerId, parsed.ghostHouseId);
    console.info(
      JSON.stringify({
        kind: "registry.adopt",
        phase: "start",
        traceId: getRequestTraceId() ?? null,
        caretakerId: parsed.caretakerId,
        ghostHouseId: parsed.ghostHouseId,
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
    const spawnCell = isEnvTruthy(process.env.AIE_MATRIX_TCK_MODE)
      ? map.anchorH3
      : cellIds[Math.floor(Math.random() * cellIds.length)];
    const ghostId = createGhostId();
    bridge.setGhostCell(ghostId, spawnCell);
    store.ghosts.set(ghostId, {
      id: ghostId,
      ghostHouseId: parsed.ghostHouseId,
      caretakerId: parsed.caretakerId,
      h3Index: spawnCell,
      status: "active",
    });
    store.activeByCaretaker.set(parsed.caretakerId, ghostId);
    const token = mintGhostToken({
      sub: ghostId,
      ghostId,
      caretakerId: parsed.caretakerId,
      ghostHouseId: parsed.ghostHouseId,
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
