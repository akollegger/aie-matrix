/**
 * In-memory LiveSessionService for development mode (AIE_MATRIX_MODE=development).
 *
 * Maintains at most one session at a time. No Neo4j or Redis required.
 *
 * - list() returns [] initially; after start(), returns the current session.
 * - start() replaces any existing session (the previous one is discarded).
 *   Map gcsPath values are resolved via MapManagementService.
 * - end() marks the current session as ended.
 * - switchMaps() is not supported and will die.
 *
 * Session IDs are generated with ulid() — not stable across restarts.
 */
import { ulid } from "ulid";
import { Effect, Layer } from "effect";
import { LiveSessionService, type SessionRecord } from "./LiveSessionService.js";
import { MapManagementService } from "../map/MapManagementService.js";
import {
  LiveSessionAlreadyEndedError,
  LiveSessionMapNotPublishedError,
  LiveSessionNotFoundError,
} from "./live-errors.js";

export function makeLocalLiveSessionLayer(): Layer.Layer<LiveSessionService, never, MapManagementService> {
  return Layer.effect(
    LiveSessionService,
    Effect.gen(function* () {
      const mapMgmt = yield* MapManagementService;

      // Mutable in-memory state — at most one session at a time.
      let currentSession: SessionRecord | null = null;

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
