import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, ManagedRuntime } from "effect";
import { handleAdoptGhostEffect, type AdoptionRuntimeDeps } from "./routes/adoption.js";
import { handleRegisterAgentHostEffect } from "./routes/register-house.js";
import { handleSpawnGhostEffect, type SpawnGhostDeps } from "./routes/spawn-ghost.js";
import { handleGetGhostEffect } from "./routes/get-ghost.js";
import { handleRespawnGhostEffect } from "./routes/respawn.js";
import { handleWithdrawGhostEffect } from "./routes/withdraw.js";
import { createCaretakerId } from "./store.js";
import { runWithRequestTrace, WorldBridgeService } from "@aie-matrix/server-world-api";
import { RegistryStoreService, RedisGhostStoreService } from "@aie-matrix/server-world-api";
import { readJsonBody, sendJson, sendRawJsonBody } from "./utils/http.js";
import { RegistryBadJson } from "./registry-errors.js";

export { createRegistryStore, createCaretakerId, type RegistryStore } from "./store.js";
export { assertAdoptionAllowed } from "./session-guard.js";
export { handleRegisterAgentHostEffect } from "./routes/register-house.js";
export { handleAdoptGhostEffect, type AdoptionRuntimeDeps } from "./routes/adoption.js";
export { handleSpawnGhostEffect, type SpawnGhostDeps } from "./routes/spawn-ghost.js";
export * from "./registry-errors.js";
export { RegistryStoreService, makeRegistryStoreLayer } from "@aie-matrix/server-world-api";

/** Match OPTIONS + route handlers so browser tooling always sees CORS on JSON errors. */
const REGISTRY_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Registry HTTP handlers only *require* {@link RegistryStoreService} and {@link WorldBridgeService}.
 * The combined server passes a richer runtime; we type it as `any` here to avoid a dependency
 * cycle on every orchestration-layer service tag. `unknown` causes an invariance error in Effect v3.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegistryManagedRuntime = ManagedRuntime.ManagedRuntime<any, never>;

export interface RegistryHttpConfig {
  adoption: AdoptionRuntimeDeps;
  spawn: SpawnGhostDeps;
  runtime: RegistryManagedRuntime;
  /** Maps registry / bridge domain failures to HTTP (combined server passes `errorToResponse`). */
  mapHttpError: (error: unknown) => { status: number; body: string };
}

function withRegistryRouteRecovery<R extends RegistryStoreService | WorldBridgeService | RedisGhostStoreService>(
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
            handleRegisterAgentHostEffect(req, res, REGISTRY_CORS_HEADERS),
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

      // GET /registry/ghosts/:ghostId — full registry record (id,
      // agentHostId, caretakerId, h3Index, spawnH3Index, status,
      // displayName). Used by:
      //   - ghost-house's Barnacle supervisor to fetch spawnH3Index for
      //     handoff bundles and respawn-on-complete
      //   - admin-panel ghost-management view (richer cascade —
      //     bridge → Redis → store — handled inside the route)
      const getGhostMatch = /^\/registry\/ghosts\/([^/]+)$/.exec(path);
      if (getGhostMatch && req.method === "GET") {
        const ghostId = decodeURIComponent(getGhostMatch[1]!);
        await config.runtime.runPromise(
          withRegistryRouteRecovery(
            res,
            handleGetGhostEffect(req, res, REGISTRY_CORS_HEADERS, ghostId),
            config.mapHttpError,
          ),
        );
        return;
      }

      // POST /registry/ghosts — admin spawn at an arbitrary cell (RFC-0014
      // ghost-management panel). Distinct from /registry/adopt, which
      // spawns via the agent-host adoption flow.
      if (path === "/registry/ghosts" && req.method === "POST") {
        const traceId = randomUUID();
        await runWithRequestTrace(traceId, () =>
          config.runtime.runPromise(
            withRegistryRouteRecovery(
              res,
              handleSpawnGhostEffect(req, res, REGISTRY_CORS_HEADERS, config.spawn),
              config.mapHttpError,
            ),
          ),
        );
        return;
      }

      // POST /registry/ghosts/:ghostId/respawn — teleport a ghost back to
      // their adoption cell. Used by RDC to clear poker tiles on exit.
      const respawnMatch = /^\/registry\/ghosts\/([^/]+)\/respawn$/.exec(path);
      if (respawnMatch && req.method === "POST") {
        const ghostId = decodeURIComponent(respawnMatch[1]!);
        await config.runtime.runPromise(
          withRegistryRouteRecovery(
            res,
            handleRespawnGhostEffect(req, res, REGISTRY_CORS_HEADERS, ghostId),
            config.mapHttpError,
          ),
        );
        return;
      }

      // POST /registry/ghosts/:ghostId/withdraw — remove a ghost from the
      // world (Barnacle Protocol, RFC-0019). The ghost vanishes from the
      // spectator; their registry record + spawnH3Index are preserved so
      // /respawn can bring them back at session-end.
      const withdrawMatch = /^\/registry\/ghosts\/([^/]+)\/withdraw$/.exec(path);
      if (withdrawMatch && req.method === "POST") {
        const ghostId = decodeURIComponent(withdrawMatch[1]!);
        await config.runtime.runPromise(
          withRegistryRouteRecovery(
            res,
            handleWithdrawGhostEffect(req, res, REGISTRY_CORS_HEADERS, ghostId),
            config.mapHttpError,
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
