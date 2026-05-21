import type { IncomingMessage, ServerResponse } from "node:http";
import type { RegisterAgentHostRequest, RegisterAgentHostResponse } from "@aie-matrix/shared-types";
import { Effect } from "effect";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { createAgentHostId } from "../store.js";
import { RegistryBadJson } from "../registry-errors.js";
import { readJsonBody, sendJson } from "../utils/http.js";

export function handleRegisterAgentHostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
): Effect.Effect<void, RegistryBadJson, RegistryStoreService> {
  if (req.method !== "POST") {
    return sendJson(res, corsHeaders, 405, { error: "METHOD_NOT_ALLOWED", message: "POST only" });
  }
  return Effect.gen(function* () {
    const body = yield* readJsonBody(req);
    const parsed = body as Partial<RegisterAgentHostRequest>;
    if (!parsed.displayName || typeof parsed.displayName !== "string") {
      yield* sendJson(res, corsHeaders, 400, { error: "VALIDATION", message: "displayName is required" });
      return;
    }
    const store = yield* RegistryStoreService;
    const id = createAgentHostId();
    const registeredAt = new Date().toISOString();
    const rec = {
      id,
      displayName: parsed.displayName,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
      registeredAt,
    };
    store.houses.set(id, rec);
    const out: RegisterAgentHostResponse = { agentHostId: id, registeredAt };
    yield* sendJson(res, corsHeaders, 201, out);
  }) as Effect.Effect<void, RegistryBadJson, RegistryStoreService>;
}
