import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAdoptGhost, type AdoptionDeps } from "./routes/adoption.js";
import { handleRegisterGhostHouse } from "./routes/register-house.js";
import { createCaretakerId, type RegistryStore } from "./store.js";

export { createRegistryStore, createCaretakerId, type RegistryStore } from "./store.js";
export { RegistryConflictError, assertAdoptionAllowed } from "./session-guard.js";
export { handleRegisterGhostHouse } from "./routes/register-house.js";
export { handleAdoptGhost, type AdoptionDeps } from "./routes/adoption.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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

export interface RegistryHttpConfig {
  store: RegistryStore;
  adoption: Omit<AdoptionDeps, "store">;
}

/**
 * Minimal JSON registry mounted under `/registry/*` on the shared HTTP server.
 */
export function createRegistryRequestListener(config: RegistryHttpConfig) {
  const adoptionDeps: AdoptionDeps = { ...config.adoption, store: config.store };

  return async function registryRequestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    try {
      if (path === "/registry/caretakers" && req.method === "POST") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          res.writeHead(400, cors);
          res.end(JSON.stringify({ error: "BAD_JSON", message: "Invalid JSON body" }));
          return;
        }
        const label = (body as { label?: string }).label;
        const id = createCaretakerId();
        config.store.caretakers.set(id, { id, label: typeof label === "string" ? label : undefined });
        res.writeHead(201, cors);
        res.end(JSON.stringify({ caretakerId: id }));
        return;
      }

      if (path === "/registry/houses" && req.method === "POST") {
        await handleRegisterGhostHouse(req, res, config.store);
        return;
      }

      if (path === "/registry/adopt" && req.method === "POST") {
        await handleAdoptGhost(req, res, adoptionDeps);
        return;
      }

      sendJson(res, 404, { error: "NOT_FOUND", message: path });
    } catch (e) {
      sendJson(res, 500, {
        error: "INTERNAL",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };
}
