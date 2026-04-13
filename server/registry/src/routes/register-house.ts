import type { IncomingMessage, ServerResponse } from "node:http";
import type { RegisterGhostHouseRequest, RegisterGhostHouseResponse } from "@aie-matrix/shared-types";
import { createGhostHouseId, type RegistryStore } from "../store.js";

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

/**
 * POST /registry/houses — register a GhostHouse (IC-001).
 */
export async function handleRegisterGhostHouse(
  req: IncomingMessage,
  res: ServerResponse,
  store: RegistryStore,
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
  const parsed = body as Partial<RegisterGhostHouseRequest>;
  if (!parsed.displayName || typeof parsed.displayName !== "string") {
    sendJson(res, 400, { error: "VALIDATION", message: "displayName is required" });
    return;
  }
  const id = createGhostHouseId();
  const registeredAt = new Date().toISOString();
  const rec = {
    id,
    displayName: parsed.displayName,
    baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
    registeredAt,
  };
  store.houses.set(id, rec);
  const out: RegisterGhostHouseResponse = { ghostHouseId: id, registeredAt };
  sendJson(res, 201, out);
}
