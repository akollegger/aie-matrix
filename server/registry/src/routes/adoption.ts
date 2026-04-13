import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdoptGhostRequest, AdoptGhostResponse } from "@aie-matrix/shared-types";
import { mintGhostToken } from "@aie-matrix/server-auth";
import { RegistryConflictError, assertAdoptionAllowed } from "../session-guard.js";
import { createGhostId, type RegistryStore } from "../store.js";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

export interface AdoptionDeps {
  store: RegistryStore;
  worldApiBaseUrl: string;
  /** Places the ghost on the map and returns its starting tile id. */
  spawnGhostOnMap(ghostId: string): string;
}

/**
 * POST /registry/adopt — caretaker adopts a ghost from a house (IC-001 / IC-002).
 */
export async function handleAdoptGhost(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdoptionDeps,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "POST only" });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "BAD_JSON", message: "Invalid JSON body" });
    return;
  }
  const parsed = body as Partial<AdoptGhostRequest>;
  if (!parsed.caretakerId || !parsed.ghostHouseId) {
    sendJson(res, 400, { error: "VALIDATION", message: "caretakerId and ghostHouseId are required" });
    return;
  }
  try {
    assertAdoptionAllowed(deps.store, parsed.caretakerId, parsed.ghostHouseId);
  } catch (e) {
    if (e instanceof RegistryConflictError) {
      sendJson(res, e.httpStatus, { error: e.code, message: e.message });
      return;
    }
    throw e;
  }
  const ghostId = createGhostId();
  const tileId = deps.spawnGhostOnMap(ghostId);
  deps.store.ghosts.set(ghostId, {
    id: ghostId,
    ghostHouseId: parsed.ghostHouseId,
    caretakerId: parsed.caretakerId,
    tileId,
    status: "active",
  });
  deps.store.activeByCaretaker.set(parsed.caretakerId, ghostId);
  const token = mintGhostToken({
    sub: ghostId,
    ghostId,
    caretakerId: parsed.caretakerId,
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
  sendJson(res, 201, out);
}
