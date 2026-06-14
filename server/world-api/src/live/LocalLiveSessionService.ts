/**
 * In-memory LiveSessionService for development mode (AIE_MATRIX_MODE=development).
 *
 * Maintains at most one session at a time. No Neo4j or Redis required.
 *
 * - When MapService.activeMapId() resolves (typically from AIE_MATRIX_MAP),
 *   the layer synthesises an active "local" session on startup so the
 *   world is browsable without requiring an admin POST /live. This
 *   matches the Tier-1 fallback the `/live/@current/map` route already
 *   implements.
 * - list() returns the synthesised session (if any) initially; after
 *   start(), returns the explicit session instead.
 * - start() replaces any existing session (the previous one is discarded).
 *   Map gcsPath values are resolved via MapManagementService.
 * - end() marks the current session as ended.
 * - switchMaps() updates the in-memory record's maps.
 *
 * Session IDs are generated with ulid() — not stable across restarts.
 */
import { ulid } from "ulid";
import { Effect, Layer } from "effect";
import { createLogger } from "@aie-matrix/logger";

import { LiveSessionService, type SessionRecord } from "./LiveSessionService.js";
import { MapManagementService } from "../map/MapManagementService.js";
import { MapService } from "../map/MapService.js";
import {
  LiveSessionAlreadyEndedError,
  LiveSessionMapNotPublishedError,
  LiveSessionNotFoundError,
} from "./live-errors.js";

const log = createLogger("live-session");

export function makeLocalLiveSessionLayer(): Layer.Layer<
  LiveSessionService,
  never,
  MapManagementService | MapService
> {
  return Layer.effect(
    LiveSessionService,
    Effect.gen(function* () {
      const mapMgmt = yield* MapManagementService;
      const mapSvc = yield* MapService;

      // Mutable in-memory state — at most one session at a time.
      let currentSession: SessionRecord | null = null;

      // Tier-1 synthesis: if MapService has an activeMapId (resolved from
      // AIE_MATRIX_MAP), pre-populate currentSession so GET /live returns
      // it without requiring an admin POST. This matches the Tier-1
      // fallback the `/live/@current/map` route already implements.
      // Failures here are non-fatal — the server starts with an empty
      // session list (same as historic behaviour).
      const activeMapId = mapSvc.activeMapId();
      if (activeMapId !== undefined) {
        const record = yield* mapMgmt.get(activeMapId).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (record !== null) {
          currentSession = {
            id: ulid(),
            name: "local",
            status: "active",
            startedAt: new Date().toISOString(),
            world: { name: "matrix" },
            maps: [{ mapId: activeMapId, role: "primary", gcsPath: record.gcsPath }],
          };
          log.info({ kind: "synthesised", sessionId: currentSession.id, mapId: activeMapId });
        } else {
          log.warn({ kind: "synthesise-skipped", reason: "activeMapId not resolvable via MapManagementService", mapId: activeMapId });
        }
      }

      const start = (
        name: string,
        maps: Array<{ mapId: string; role: string }>,
      ): Effect.Effect<SessionRecord, LiveSessionMapNotPublishedError> =>
        Effect.gen(function* () {
          // Resolve gcsPath for each map from MapManagementService.
          const resolvedMaps: Array<{ mapId: string; role: string; gcsPath: string }> = [];
          for (const { mapId, role } of maps) {
            const record = yield* mapMgmt.get(mapId).pipe(
              Effect.mapError(() => new LiveSessionMapNotPublishedError({ mapId })),
            );
            resolvedMaps.push({ mapId, role, gcsPath: record.gcsPath });
          }

          const session: SessionRecord = {
            id: ulid(),
            name,
            status: "active",
            startedAt: new Date().toISOString(),
            world: { name: "matrix" },
            maps: resolvedMaps,
          };
          currentSession = session;
          return session;
        });

      const list = (status?: "active" | "ended"): Effect.Effect<readonly SessionRecord[], never> =>
        Effect.sync(() => {
          if (currentSession === null) return [];
          if (status === undefined) return [currentSession];
          return currentSession.status === status ? [currentSession] : [];
        });

      const get = (id: string): Effect.Effect<SessionRecord, LiveSessionNotFoundError> =>
        Effect.sync(() => currentSession).pipe(
          Effect.flatMap((session) =>
            session !== null && session.id === id
              ? Effect.succeed(session)
              : Effect.fail(new LiveSessionNotFoundError({ id })),
          ),
        );

      const end = (
        id: string,
      ): Effect.Effect<void, LiveSessionNotFoundError | LiveSessionAlreadyEndedError> =>
        Effect.gen(function* () {
          if (currentSession === null || currentSession.id !== id) {
            yield* Effect.fail(new LiveSessionNotFoundError({ id }));
            return;
          }
          if (currentSession.status === "ended") {
            yield* Effect.fail(new LiveSessionAlreadyEndedError({ id }));
            return;
          }
          currentSession = {
            ...currentSession,
            status: "ended",
            endedAt: new Date().toISOString(),
          };
        });

      const switchMaps = (
        id: string,
        maps: Array<{ mapId: string; role: string }>,
      ): Effect.Effect<
        { session: SessionRecord; removedCells: string[]; addedCells: string[] },
        LiveSessionNotFoundError | LiveSessionMapNotPublishedError
      > =>
        Effect.gen(function* () {
          // Validate session exists and is active.
          const existing = yield* get(id);
          if (existing.status !== "active") {
            yield* Effect.fail(new LiveSessionNotFoundError({ id }));
          }

          // Resolve gcsPath for each new map via MapManagementService (reads local files).
          const resolvedMaps: Array<{ mapId: string; role: string; gcsPath: string }> = [];
          for (const { mapId, role } of maps) {
            const record = yield* mapMgmt.get(mapId).pipe(
              Effect.mapError(() => new LiveSessionMapNotPublishedError({ mapId })),
            );
            resolvedMaps.push({ mapId, role, gcsPath: record.gcsPath });
          }

          // Update in-memory session.
          currentSession = { ...existing, maps: resolvedMaps };

          // Cell diff not computable without Neo4j in dev mode — return empty arrays.
          // The actual Colyseus map reload is handled by LiveSessionRoutes after this returns.
          return { session: currentSession, removedCells: [], addedCells: [] };
        });

      return {
        start,
        list,
        get,
        switchMaps,
        end,
      };
    }),
  );
}
