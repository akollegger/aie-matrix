import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, ManagedRuntime } from "effect";
import { handleAdoptGhostEffect, type AdoptionRuntimeDeps } from "./routes/adoption.js";
import { handleRegisterGhostHouseEffect } from "./routes/register-house.js";
import { createCaretakerId, type RegistryStore } from "./store.js";
import type { WorldBridgeService } from "@aie-matrix/server-world-api";
import { runWithRequestTrace } from "@aie-matrix/server-world-api";
import { RegistryStoreService } from "@aie-matrix/server-world-api";
import { readJsonBody, sendJson, sendRawJsonBody } from "./utils/http.js";
import { RegistryBadJson } from "./registry-errors.js";

export { createRegistryStore, createCaretakerId, type RegistryStore } from "./store.js";
export { assertAdoptionAllowed } from "./session-guard.js";
export { handleRegisterGhostHouseEffect } from "./routes/register-house.js";
export { handleAdoptGhostEffect, type AdoptionRuntimeDeps } from "./routes/adoption.js";
export * from "./registry-errors.js";
export { RegistryStoreService, makeRegistryStoreLayer } from "@aie-matrix/server-world-api";

/** Match OPTIONS + route handlers so browser tooling always sees CORS on JSON errors. */
const REGISTRY_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export type RegistryManagedRuntime = ManagedRuntime.ManagedRuntime<
  RegistryStoreService | WorldBridgeService,
  never
>;

export interface RegistryHttpConfig {
  store: RegistryStore;
  adoption: AdoptionRuntimeDeps;
  runtime: RegistryManagedRuntime;
  /** Maps registry / bridge domain failures to HTTP (combined server passes `errorToResponse`). */
  mapHttpError: (error: unknown) => { status: number; body: string };
}

function withRegistryRouteRecovery<R extends RegistryStoreService | WorldBridgeService>(
  res: ServerResponse,
  program: Effect.Effect<void, unknown, R>,
  mapHttpError: (error: unknown) => { status: number; body: string },
): Effect.Effect<void, never, R> {
  return program.pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        if (e instanceof RegistryBadJson) {
          yield* sendJson(res, REGISTRY_CORS_HEADERS, 400, {
            error: "BAD_JSON",
            message: e.message,
          });
          return;
        }
        const { status, body } = mapHttpError(e);
        yield* sendRawJsonBody(res, REGISTRY_CORS_HEADERS, status, body);
      }),
    ),
  );
}

/**
 * Minimal JSON registry mounted under `/registry/*` on the shared HTTP server.
 */
export function createRegistryRequestListener(config: RegistryHttpConfig) {
  return async function registryRequestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, REGISTRY_CORS_HEADERS);
      res.end();
      return;
    }

    try {
      if (path === "/registry/caretakers" && req.method === "POST") {
        const caretakerProgram = Effect.gen(function* () {
          const store = yield* RegistryStoreService;
          const body = yield* readJsonBody(req);
          const label = (body as { label?: string }).label;
          const id = createCaretakerId();
          store.caretakers.set(id, { id, label: typeof label === "string" ? label : undefined });
          yield* sendJson(res, REGISTRY_CORS_HEADERS, 201, { caretakerId: id });
        });
        await config.runtime.runPromise(
          withRegistryRouteRecovery(res, caretakerProgram, config.mapHttpError),
        );
        return;
      }

      if (path === "/registry/houses" && req.method === "POST") {
        await config.runtime.runPromise(
          withRegistryRouteRecovery(
            res,
            handleRegisterGhostHouseEffect(req, res, REGISTRY_CORS_HEADERS),
            config.mapHttpError,
          ),
        );
        return;
      }

      if (path === "/registry/adopt" && req.method === "POST") {
        const traceId = randomUUID();
        await runWithRequestTrace(traceId, () =>
          config.runtime.runPromise(
            withRegistryRouteRecovery(
              res,
              handleAdoptGhostEffect(req, res, REGISTRY_CORS_HEADERS, config.adoption),
              config.mapHttpError,
            ),
          ),
        );
        return;
      }

      await config.runtime.runPromise(
        sendJson(res, REGISTRY_CORS_HEADERS, 404, { error: "NOT_FOUND", message: path }),
      );
    } catch (e) {
      await config.runtime.runPromise(
        sendJson(res, REGISTRY_CORS_HEADERS, 500, {
          error: "INTERNAL",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };
}
