/**
 * Unit tests for LocalLiveSessionService.
 *
 * No Neo4j or Redis required — session state is fully in-memory.
 * MapManagementService is provided via a stub layer.
 *
 * Important: Effect layers are re-evaluated per runPromise call. Tests that
 * need state to persist across multiple operations must run everything inside
 * a single Effect.gen chain and a single Effect.runPromise call.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer } from "effect";
import { makeLocalLiveSessionLayer } from "./LocalLiveSessionService.js";
import { LiveSessionService } from "./LiveSessionService.js";
import { LiveSessionAlreadyEndedError, LiveSessionNotFoundError } from "./live-errors.js";
import { MapManagementService, type MapRecord } from "../map/MapManagementService.js";
import { MapService } from "../map/MapService.js";
import { MapNotFoundError } from "../map/map-errors.js";

// ─── stub data ────────────────────────────────────────────────────────────────

const MAP_A: MapRecord = {
  mapId: "map-a",
  name: "Map A",
  elevation: 0,
  gcsPath: "file:///tmp/map-a.map.gram",
  contentHash: "abc123",
  status: "published",
  publishedAt: new Date().toISOString(),
};

const MAP_B: MapRecord = {
  mapId: "map-b",
  name: "Map B",
  elevation: 0,
  gcsPath: "file:///tmp/map-b.map.gram",
  contentHash: "def456",
  status: "published",
  publishedAt: new Date().toISOString(),
};

/** Stub MapManagementService with MAP_A and MAP_B available. */
const stubMapMgmtLayer: Layer.Layer<MapManagementService> = Layer.succeed(MapManagementService, {
  publish: (_mapId, _bytes) => Effect.die("not supported in stub"),
  list: (_status?) => Effect.succeed([MAP_A, MAP_B]),
  get: (mapId: string) => {
    if (mapId === MAP_A.mapId) return Effect.succeed(MAP_A);
    if (mapId === MAP_B.mapId) return Effect.succeed(MAP_B);
    return Effect.fail(new MapNotFoundError({ mapId }));
  },
  download: (_mapId: string) => Effect.die("not supported in stub"),
  archive: (_mapId: string) => Effect.void,
});

/** Stub MapService that reports no active map — disables tier-1 synthesis. */
const stubMapSvcLayer: Layer.Layer<MapService> = Layer.succeed(MapService, {
  listEntries: () => Effect.succeed([]),
  validate: () => Effect.void,
  activeMapId: () => undefined,
  raw: (mapId, _format) => Effect.fail(new MapNotFoundError({ mapId })),
});

/** Fresh layer for each test — new mutable state per test. */
function makeTestLayer(): Layer.Layer<LiveSessionService> {
  return makeLocalLiveSessionLayer().pipe(
    Layer.provide(Layer.mergeAll(stubMapMgmtLayer, stubMapSvcLayer)),
  );
}

/** Run a single-step effect against a fresh layer. */
function run<A, E>(
  effect: Effect.Effect<A, E, LiveSessionService>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(makeTestLayer())));
}

// ─── initial state ────────────────────────────────────────────────────────────

test("list() returns empty array initially", async () => {
  const sessions = await run(Effect.flatMap(LiveSessionService, (s) => s.list()));
  assert.equal(sessions.length, 0);
});

test("list('active') returns empty array initially", async () => {
  const sessions = await run(Effect.flatMap(LiveSessionService, (s) => s.list("active")));
  assert.equal(sessions.length, 0);
});

test("list('ended') returns empty array initially", async () => {
  const sessions = await run(Effect.flatMap(LiveSessionService, (s) => s.list("ended")));
  assert.equal(sessions.length, 0);
});

// ─── start ────────────────────────────────────────────────────────────────────

test("start() creates a new active session", async () => {
  const session = await run(
    Effect.flatMap(LiveSessionService, (s) =>
      s.start("test-session", [{ mapId: "map-a", role: "primary" }]),
    ),
  );
  assert.equal(session.status, "active");
  assert.equal(session.name, "test-session");
  assert.ok(typeof session.id === "string" && session.id.length > 0);
});

test("start() resolves gcsPath for each map via MapManagementService", async () => {
  const session = await run(
    Effect.flatMap(LiveSessionService, (s) =>
      s.start("test-session", [{ mapId: "map-a", role: "primary" }]),
    ),
  );
  assert.equal(session.maps.length, 1);
  assert.equal(session.maps[0]!.mapId, "map-a");
  assert.equal(session.maps[0]!.gcsPath, MAP_A.gcsPath);
  assert.equal(session.maps[0]!.role, "primary");
});

test("start() with no maps creates session with empty maps array", async () => {
  const session = await run(
    Effect.flatMap(LiveSessionService, (s) => s.start("empty-session", [])),
  );
  assert.equal(session.maps.length, 0);
  assert.equal(session.status, "active");
});

test("start() with unknown mapId fails with LiveSessionMapNotPublishedError", async () => {
  const err = await Effect.runPromise(
    Effect.flip(
      Effect.flatMap(LiveSessionService, (s) =>
        s.start("bad-session", [{ mapId: "no-such-map", role: "primary" }]),
      ).pipe(Effect.provide(makeTestLayer())),
    ),
  );
  assert.equal(err._tag, "LiveSessionMapNotPublishedError");
  assert.equal((err as unknown as { mapId: string }).mapId, "no-such-map");
});

test("start() session is visible in list() immediately after", async () => {
  const [sessions] = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      yield* svc.start("my-session", [{ mapId: "map-a", role: "primary" }]);
      const sessions = yield* svc.list();
      return [sessions] as const;
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.name, "my-session");
  assert.equal(sessions[0]!.status, "active");
});

// ─── single-session constraint ────────────────────────────────────────────────

test("start() replaces the previous session (single-session constraint)", async () => {
  const [firstId, sessions, err] = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const first = yield* svc.start("first", []);
      yield* svc.start("second", []);
      const sessions = yield* svc.list();
      const err = yield* Effect.flip(svc.get(first.id));
      return [first.id, sessions, err] as const;
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.name, "second");
  assert.ok(err instanceof LiveSessionNotFoundError);
  assert.equal(err.id, firstId);
});

test("start() each call produces a unique session ID", async () => {
  const [firstId, secondId] = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const first = yield* svc.start("first", []);
      const second = yield* svc.start("second", []);
      return [first.id, second.id] as const;
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.notEqual(firstId, secondId);
});

// ─── get ──────────────────────────────────────────────────────────────────────

test("get(id) returns the created session", async () => {
  const [created, fetched] = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const created = yield* svc.start("my-session", []);
      const fetched = yield* svc.get(created.id);
      return [created, fetched] as const;
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.name, "my-session");
});

test("get(unknown) fails with LiveSessionNotFoundError when no session exists", async () => {
  const err = await Effect.runPromise(
    Effect.flip(
      Effect.flatMap(LiveSessionService, (s) => s.get("no-such-session")).pipe(
        Effect.provide(makeTestLayer()),
      ),
    ),
  );
  assert.ok(err instanceof LiveSessionNotFoundError);
  assert.equal(err.id, "no-such-session");
});

// ─── end ──────────────────────────────────────────────────────────────────────

test("end() marks the session as ended", async () => {
  const ended = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const session = yield* svc.start("to-end", []);
      yield* svc.end(session.id);
      return yield* svc.get(session.id);
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.equal(ended.status, "ended");
  assert.ok(typeof ended.endedAt === "string");
});

test("end() removes session from active list and adds to ended list", async () => {
  const [active, ended] = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const session = yield* svc.start("to-end", []);
      yield* svc.end(session.id);
      const active = yield* svc.list("active");
      const ended = yield* svc.list("ended");
      return [active, ended] as const;
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.equal(active.length, 0);
  assert.equal(ended.length, 1);
});

test("end(unknown) fails with LiveSessionNotFoundError", async () => {
  const err = await Effect.runPromise(
    Effect.flip(
      Effect.flatMap(LiveSessionService, (s) => s.end("no-such")).pipe(
        Effect.provide(makeTestLayer()),
      ),
    ),
  );
  assert.ok(err instanceof LiveSessionNotFoundError);
});

test("end() twice fails with LiveSessionAlreadyEndedError", async () => {
  const err = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const session = yield* svc.start("to-end", []);
      yield* svc.end(session.id);
      return yield* Effect.flip(svc.end(session.id));
    }).pipe(Effect.provide(makeTestLayer())),
  );
  assert.ok(err instanceof LiveSessionAlreadyEndedError);
});
