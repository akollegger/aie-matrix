import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { WorldBridgeService } from "@aie-matrix/server-world-api";
import { sendJson } from "../utils/http.js";

/**
 * Teleports a ghost back to the cell they were adopted on. Used to vacate
 * mini-game tiles (e.g. poker tables) on session-end so departing ghosts
 * don't pile up next to the table they just left.
 */
export function handleRespawnGhostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  ghostId: string,
): Effect.Effect<void, never, RegistryStoreService | WorldBridgeService> {
  if (req.method !== "POST") {
    return sendJson(res, corsHeaders, 405, { error: "METHOD_NOT_ALLOWED", message: "POST only" });
  }
  return Effect.gen(function* () {
    const store = yield* RegistryStoreService;
    const ghost = store.ghosts.get(ghostId);
    if (!ghost) {
      yield* sendJson(res, corsHeaders, 404, { error: "NOT_FOUND", message: `unknown ghostId ${ghostId}` });
      return;
    }
    const bridge = yield* WorldBridgeService;
    bridge.setGhostCell(ghost.id, ghost.spawnH3Index);
    ghost.h3Index = ghost.spawnH3Index;
    yield* sendJson(res, corsHeaders, 200, {
      ghostId: ghost.id,
      h3Index: ghost.spawnH3Index,
    });
  });
}
