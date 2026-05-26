import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { WorldBridgeService } from "@aie-matrix/server-world-api";
import { sendJson } from "../utils/http.js";

/**
 * Removes a ghost from the world entirely (Colyseus + spectator) without
 * deleting their registry record. Used by the Barnacle Protocol (RFC-0019)
 * when a mini-game session begins — the ghost is "inside" the mini-game and
 * should not appear on the world map. A later `/respawn` re-places them.
 */
export function handleWithdrawGhostEffect(
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
    bridge.removeGhostCell(ghost.id);
    yield* sendJson(res, corsHeaders, 200, { ghostId: ghost.id, withdrawn: true });
  });
}
