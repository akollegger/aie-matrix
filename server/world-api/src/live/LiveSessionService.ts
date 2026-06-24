import neo4j, { type Driver } from "neo4j-driver";
import { ulid } from "ulid";
import { Context, Effect, Layer } from "effect";
import { WORLD_EVENTS_CHANNEL } from "@aie-matrix/shared-types";
import { RedisPublishService } from "../redis/RedisPublishService.js";
import {
  LiveSessionAlreadyEndedError,
  LiveSessionMapNotPublishedError,
  LiveSessionNotFoundError,
} from "./live-errors.js";

export interface SessionRecord {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "ended";
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly world: { name: string };
  readonly maps: Array<{ mapId: string; role: string; gcsPath: string }>;
}

export interface LiveSessionOps {
  start(
    name: string,
    maps: Array<{ mapId: string; role: string }>,
  ): Effect.Effect<SessionRecord, LiveSessionMapNotPublishedError>;
  /** Idempotent bootstrap: returns existing active session or creates one. See RFC-0013. */
  ensure(
    name: string,
    maps: Array<{ mapId: string; role: string }>,
  ): Effect.Effect<{ session: SessionRecord; created: boolean; warning?: string }, LiveSessionMapNotPublishedError>;
  list(status?: "active" | "ended"): Effect.Effect<readonly SessionRecord[], never>;
  get(id: string): Effect.Effect<SessionRecord, LiveSessionNotFoundError>;
  switchMaps(
    id: string,
    maps: Array<{ mapId: string; role: string }>,
  ): Effect.Effect<
    { session: SessionRecord; removedCells: string[]; addedCells: string[] },
    LiveSessionNotFoundError | LiveSessionMapNotPublishedError
  >;
  end(id: string): Effect.Effect<void, LiveSessionNotFoundError | LiveSessionAlreadyEndedError>;
  /** Destructive world reset: ends all active sessions, clears ledger + groups, emits world.reset. See RFC-0014. */
  reset(): Effect.Effect<{ sessionsEnded: number; ledgerEntriesCleared: number; groupsCleared: number }>;
}

export class LiveSessionService extends Context.Tag("aie-matrix/LiveSessionService")<
  LiveSessionService,
  LiveSessionOps
>() {}

function rowToSessionRecord(rec: { get(key: string): unknown }): SessionRecord {
  const endedAt = rec.get("endedAt");
  const mapsRaw = rec.get("maps");
  const maps = Array.isArray(mapsRaw) ? (mapsRaw as Array<{ mapId: string; role: string; gcsPath: string }>) : [];
  return {
    id: rec.get("id") as string,
    name: rec.get("name") as string,
    status: rec.get("status") as "active" | "ended",
    startedAt: rec.get("startedAt") as string,
    ...(endedAt != null ? { endedAt: endedAt as string } : {}),
    world: { name: rec.get("worldName") as string ?? "matrix" },
    maps,
  };
}

async function resolvePublishedMap(
  driver: Driver,
  mapId: string,
): Promise<{ mapId: string; gcsPath: string } | null> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (m:Map { mapId: $mapId, status: "published" })
       RETURN m.gcsPath AS gcsPath`,
      { mapId },
    );
    const rec = result.records[0];
    if (!rec) return null;
    return { mapId, gcsPath: rec.get("gcsPath") as string };
  } finally {
    await session.close();
  }
}

async function getSessionById(
  driver: Driver,
  id: string,
): Promise<SessionRecord | null> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (s:LiveSession { id: $id })
       OPTIONAL MATCH (s)-[u:USES]->(m:Map)
       WITH s,
            collect({ mapId: m.mapId, role: u.role, gcsPath: m.gcsPath }) AS maps
       RETURN s.id AS id, s.name AS name, s.status AS status,
              toString(s.startedAt) AS startedAt,
              toString(s.endedAt) AS endedAt,
              s.worldName AS worldName,
              maps`,
      { id },
    );
    const rec = result.records[0];
    if (!rec) return null;
    return rowToSessionRecord(rec);
  } finally {
    await session.close();
  }
}

export function makeLiveSessionLayer(driver: Driver): Layer.Layer<LiveSessionService, never, RedisPublishService> {
  return Layer.effect(
    LiveSessionService,
    Effect.gen(function* () {
      const redis = yield* RedisPublishService;

      const start = (
        name: string,
        maps: Array<{ mapId: string; role: string }>,
      ): Effect.Effect<SessionRecord, LiveSessionMapNotPublishedError> =>
        Effect.gen(function* () {
          // Resolve all maps — each must be published
          const resolvedMaps: Array<{ mapId: string; role: string; gcsPath: string }> = [];
          for (const { mapId, role } of maps) {
            const resolved = yield* Effect.promise(() => resolvePublishedMap(driver, mapId));
            if (!resolved) {
              yield* Effect.fail(new LiveSessionMapNotPublishedError({ mapId }));
              return null as unknown as SessionRecord;
            }
            resolvedMaps.push({ mapId: resolved.mapId, role, gcsPath: resolved.gcsPath });
          }

          const sessionId = ulid();

          const record: SessionRecord = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              await session.executeWrite(async (tx) => {
                await tx.run(
                  `CREATE (s:LiveSession {
                     id: $id,
                     name: $name,
                     status: "active",
                     startedAt: datetime(),
                     worldName: "matrix"
                   })`,
                  { id: sessionId, name },
                );
                for (const m of resolvedMaps) {
                  await tx.run(
                    `MATCH (s:LiveSession { id: $id })
                     MATCH (m:Map { mapId: $mapId })
                     MERGE (s)-[:USES { role: $role }]->(m)`,
                    { id: sessionId, mapId: m.mapId, role: m.role },
                  );
                }
              });

              const fetched = await getSessionById(driver, sessionId);
              return fetched!;
            } finally {
              await session.close();
            }
          });

          yield* redis.publish(WORLD_EVENTS_CHANNEL, {
            type: "world.session-started",
            sessionId,
            name,
            maps: resolvedMaps.map((m) => ({ mapId: m.mapId, role: m.role })),
          });

          return record;
        });

      const list = (status?: "active" | "ended"): Effect.Effect<readonly SessionRecord[], never> =>
        Effect.promise(async () => {
          const session = driver.session({ defaultAccessMode: neo4j.session.READ });
          try {
            const cypher =
              status !== undefined
                ? `MATCH (s:LiveSession { status: $status })
                   OPTIONAL MATCH (s)-[u:USES]->(m:Map)
                   WITH s, collect({ mapId: m.mapId, role: u.role, gcsPath: m.gcsPath }) AS maps
                   RETURN s.id AS id, s.name AS name, s.status AS status,
                          toString(s.startedAt) AS startedAt,
                          toString(s.endedAt) AS endedAt,
                          s.worldName AS worldName,
                          maps
                   ORDER BY s.startedAt`
                : `MATCH (s:LiveSession)
                   OPTIONAL MATCH (s)-[u:USES]->(m:Map)
                   WITH s, collect({ mapId: m.mapId, role: u.role, gcsPath: m.gcsPath }) AS maps
                   RETURN s.id AS id, s.name AS name, s.status AS status,
                          toString(s.startedAt) AS startedAt,
                          toString(s.endedAt) AS endedAt,
                          s.worldName AS worldName,
                          maps
                   ORDER BY s.startedAt`;
            const result = await session.run(cypher, status !== undefined ? { status } : {});
            return result.records.map(rowToSessionRecord);
          } finally {
            await session.close();
          }
        });

      const get = (id: string): Effect.Effect<SessionRecord, LiveSessionNotFoundError> =>
        Effect.promise(() => getSessionById(driver, id)).pipe(
          Effect.flatMap((rec) => {
            if (rec === null) return Effect.fail(new LiveSessionNotFoundError({ id }));
            return Effect.succeed(rec);
          }),
        );

      const switchMaps = (
        id: string,
        maps: Array<{ mapId: string; role: string }>,
      ): Effect.Effect<
        { session: SessionRecord; removedCells: string[]; addedCells: string[] },
        LiveSessionNotFoundError | LiveSessionMapNotPublishedError
      > =>
        Effect.gen(function* () {
          // Validate session exists and is active
          const existing = yield* get(id);
          if (existing.status !== "active") {
            yield* Effect.fail(new LiveSessionNotFoundError({ id }));
          }

          // Resolve new maps
          const resolvedMaps: Array<{ mapId: string; role: string; gcsPath: string }> = [];
          for (const { mapId, role } of maps) {
            const resolved = yield* Effect.promise(() => resolvePublishedMap(driver, mapId));
            if (!resolved) {
              yield* Effect.fail(new LiveSessionMapNotPublishedError({ mapId }));
              return null as unknown as { session: SessionRecord; removedCells: string[]; addedCells: string[] };
            }
            resolvedMaps.push({ mapId: resolved.mapId, role, gcsPath: resolved.gcsPath });
          }

          // Old primary map (role === "primary" or first map)
          const oldPrimaryMap = existing.maps.find((m) => m.role === "primary") ?? existing.maps[0];
          const newPrimaryMap = resolvedMaps.find((m) => m.role === "primary") ?? resolvedMaps[0];

          const oldCells: string[] = oldPrimaryMap
            ? yield* Effect.promise(async () => {
                const session = driver.session({ defaultAccessMode: neo4j.session.READ });
                try {
                  const result = await session.run(
                    `MATCH (c:Tile { sourceMapId: $mapId }) RETURN c.h3Index AS h3Index`,
                    { mapId: oldPrimaryMap.mapId },
                  );
                  return result.records.map((r) => r.get("h3Index") as string);
                } finally {
                  await session.close();
                }
              })
            : [];

          const newCells: string[] = newPrimaryMap
            ? yield* Effect.promise(async () => {
                const session = driver.session({ defaultAccessMode: neo4j.session.READ });
                try {
                  const result = await session.run(
                    `MATCH (c:Tile { sourceMapId: $mapId }) RETURN c.h3Index AS h3Index`,
                    { mapId: newPrimaryMap.mapId },
                  );
                  return result.records.map((r) => r.get("h3Index") as string);
                } finally {
                  await session.close();
                }
              })
            : [];

          const oldSet = new Set(oldCells);
          const newSet = new Set(newCells);
          const removedCells = oldCells.filter((c) => !newSet.has(c));
          const addedCells = newCells.filter((c) => !oldSet.has(c));

          // Update USES edges
          yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              await session.executeWrite(async (tx) => {
                // Remove old edges
                await tx.run(
                  `MATCH (s:LiveSession { id: $id })-[u:USES]->(:Map) DELETE u`,
                  { id },
                );
                // Create new edges
                for (const m of resolvedMaps) {
                  await tx.run(
                    `MATCH (s:LiveSession { id: $id })
                     MATCH (m:Map { mapId: $mapId })
                     MERGE (s)-[:USES { role: $role }]->(m)`,
                    { id, mapId: m.mapId, role: m.role },
                  );
                }
              });
            } finally {
              await session.close();
            }
          });

          const updatedSession = yield* get(id);

          yield* redis.publish(WORLD_EVENTS_CHANNEL, {
            type: "world.map-changed",
            sessionId: id,
            maps: resolvedMaps.map((m) => ({ mapId: m.mapId, role: m.role })),
            removedCells,
            addedCells,
          });

          // TODO RFC-0012: Release speaker room claims for ghosts on removedCells.
          // Call speakerRoomService.releaseClaimsOnRemovedPolygons(removedCells) when RFC-0012 is implemented.

          return { session: updatedSession, removedCells, addedCells };
        });

      const end = (id: string): Effect.Effect<void, LiveSessionNotFoundError | LiveSessionAlreadyEndedError> =>
        Effect.gen(function* () {
          const existing = yield* get(id);
          if (existing.status === "ended") {
            yield* Effect.fail(new LiveSessionAlreadyEndedError({ id }));
          }

          const endedAt = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              const result = await session.executeWrite((tx) =>
                tx.run(
                  `MATCH (s:LiveSession { id: $id })
                   SET s.status = "ended", s.endedAt = datetime()
                   RETURN toString(s.endedAt) AS endedAt`,
                  { id },
                ),
              );
              return result.records[0]?.get("endedAt") as string ?? new Date().toISOString();
            } finally {
              await session.close();
            }
          });

          yield* redis.publish(WORLD_EVENTS_CHANNEL, {
            type: "world.session-ended",
            sessionId: id,
            endedAt,
          });
        });

      const ensure = (
        name: string,
        maps: Array<{ mapId: string; role: string }>,
      ): Effect.Effect<{ session: SessionRecord; created: boolean; warning?: string }, LiveSessionMapNotPublishedError> =>
        Effect.gen(function* () {
          const active = yield* list("active");
          if (active.length === 1) {
            return { session: active[0]!, created: false };
          }
          if (active.length > 1) {
            const sorted = [...active].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
            return { session: sorted[0]!, created: false, warning: "multiple-active-sessions" };
          }
          const session = yield* start(name, maps);
          return { session, created: true };
        });

      const reset = (): Effect.Effect<{ sessionsEnded: number; ledgerEntriesCleared: number; groupsCleared: number }> =>
        Effect.gen(function* () {
          const result = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              const sessionsEnded = await session.executeWrite(async (tx) => {
                const r = await tx.run(
                  `MATCH (s:LiveSession { status: "active" })
                   SET s.status = "ended", s.endedAt = datetime()
                   RETURN count(s) AS n`,
                );
                return (r.records[0]?.get("n") as { toNumber(): number } | undefined)?.toNumber() ?? 0;
              });

              const ledgerEntriesCleared = await session.executeWrite(async (tx) => {
                const r = await tx.run(
                  `MATCH (s:LiveSession)-[:LEDGER_HEAD|NEXT_ENTRY*]->(e:LedgerEntry)
                   DETACH DELETE e
                   RETURN count(e) AS n`,
                );
                return (r.records[0]?.get("n") as { toNumber(): number } | undefined)?.toNumber() ?? 0;
              });

              const groupsCleared = await session.executeWrite(async (tx) => {
                const r = await tx.run(
                  `MATCH (g:Group)
                   DETACH DELETE g
                   RETURN count(g) AS n`,
                );
                return (r.records[0]?.get("n") as { toNumber(): number } | undefined)?.toNumber() ?? 0;
              });

              return { sessionsEnded, ledgerEntriesCleared, groupsCleared };
            } finally {
              await session.close();
            }
          });

          yield* redis.publish(WORLD_EVENTS_CHANNEL, { type: "world.reset" });

          return result;
        });

      return { start, ensure, list, get, switchMaps, end, reset };
    }),
  );
}
