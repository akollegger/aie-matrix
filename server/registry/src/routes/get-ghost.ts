import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { sendJson } from "../utils/http.js";

/**
 * GET /registry/ghosts/:ghostId — read a ghost's registry record
 * (id, agentHostId, caretakerId, current h3Index, spawnH3Index, status).
 *
 * Used by agent-host's Barnacle supervisor (RFC-0019) to look up the
 * spawn cell at encounter-accept time so the handoff bundle can carry
 * it for the mini-game's reference + the supervisor's respawn step.
 */
export function handleGetGhostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  ghostId: string,
): Effect.Effect<void, never, RegistryStoreService> {
  if (req.method !== "GET") {
    return sendJson(res, corsHeaders, 405, { error: "METHOD_NOT_ALLOWED", message: "GET only" });
  }
  return Effect.gen(function* () {
    const store = yield* RegistryStoreService;
    const ghost = store.ghosts.get(ghostId);
    if (!ghost) {
      yield* sendJson(res, corsHeaders, 404, { error: "NOT_FOUND", message: `unknown ghostId ${ghostId}` });
      return;
    }
    yield* sendJson(res, corsHeaders, 200, {
      id: ghost.id,
      agentHostId: ghost.agentHostId,
      caretakerId: ghost.caretakerId,
      h3Index: ghost.h3Index,
      spawnH3Index: ghost.spawnH3Index,
      status: ghost.status,
      ...(ghost.displayName !== undefined ? { displayName: ghost.displayName } : {}),
    });
  });
}
