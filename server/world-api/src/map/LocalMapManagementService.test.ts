/**
 * Unit tests for LocalMapManagementService.
 *
 * No Neo4j or GCS required — all behaviour is derived from MapIndexEntry objects
 * that point to temporary gram files written during test setup.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Layer } from "effect";
import { makeLocalMapManagementLayer } from "./LocalMapManagementService.js";
import { MapManagementService } from "./MapManagementService.js";
import { MapService, type MapIndexEntry } from "./MapService.js";
import { MapNotFoundError } from "./map-errors.js";

const GRAM_CONTENT = "// minimal test gram\n";
const TEST_MAP_NAME = "test-local-map";

async function setupGramFile(name = TEST_MAP_NAME): Promise<MapIndexEntry> {
  const dir = join(tmpdir(), "aie-matrix-test");
  await mkdir(dir, { recursive: true });
  const gramPath = join(dir, `${name}.map.gram`);
  await writeFile(gramPath, GRAM_CONTENT, "utf8");
  return { mapId: name, gramPath };
}

/** Stub MapService that returns the given entries. */
function makeStubMapServiceLayer(entries: readonly MapIndexEntry[]): Layer.Layer<MapService> {
  return Layer.succeed(MapService, {
    listEntries: () => Effect.succeed(entries),
    raw: (_mapId, _format) => Effect.die("not supported in stub"),
    validate: () => Effect.succeed(undefined as void),
    activeMapId: () => undefined,
  });
}

/** Run an effect against the local map layer with the given entries. */
function run<A, E>(
  entries: readonly MapIndexEntry[],
  effect: Effect.Effect<A, E, MapManagementService>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        makeLocalMapManagementLayer().pipe(
          Layer.provide(makeStubMapServiceLayer(entries)),
        ),
      ),
    ),
  );
}

// ─── list ─────────────────────────────────────────────────────────────────────

test("list() returns one record with published status", async () => {
  const entry = await setupGramFile();
  const records = await run([entry], Effect.flatMap(MapManagementService, (s) => s.list()));
  assert.equal(records.length, 1);
  assert.equal(records[0]!.status, "published");
});

test("list() record has correct mapId and gcsPath scheme", async () => {
  const entry = await setupGramFile();
  const records = await run([entry], Effect.flatMap(MapManagementService, (s) => s.list()));
  assert.equal(records[0]!.mapId, entry.mapId);
  assert.ok(records[0]!.gcsPath.startsWith("file://"), "gcsPath should use file:// scheme");
});

test("list('published') returns the one record", async () => {
  const entry = await setupGramFile();
  const records = await run(
    [entry],
    Effect.flatMap(MapManagementService, (s) => s.list("published")),
  );
  assert.equal(records.length, 1);
});

test("list('archived') returns empty array", async () => {
  const entry = await setupGramFile();
  const records = await run(
    [entry],
    Effect.flatMap(MapManagementService, (s) => s.list("archived")),
  );
  assert.equal(records.length, 0);
});

test("list() returns empty array when no entries", async () => {
  const records = await run([], Effect.flatMap(MapManagementService, (s) => s.list()));
  assert.equal(records.length, 0);
});

test("list() returns multiple records for multiple gram files", async () => {
  const entry1 = await setupGramFile("multi-map-one");
  const entry2 = await setupGramFile("multi-map-two");
  const records = await run(
    [entry1, entry2],
    Effect.flatMap(MapManagementService, (s) => s.list()),
  );
  assert.equal(records.length, 2);
  const mapIds = records.map((r) => r.mapId).sort();
  assert.deepEqual(mapIds, ["multi-map-one", "multi-map-two"]);
});

// ─── get ──────────────────────────────────────────────────────────────────────

test("get(mapId) returns the correct record", async () => {
  const entry = await setupGramFile();
  const record = await run(
    [entry],
    Effect.flatMap(MapManagementService, (s) => s.get(entry.mapId)),
  );
  assert.equal(record.mapId, entry.mapId);
  assert.equal(record.status, "published");
});

test("get(unknown) fails with MapNotFoundError", async () => {
  const entry = await setupGramFile();
  const err = await Effect.runPromise(
    Effect.flip(
      Effect.flatMap(MapManagementService, (s) => s.get("no-such-map")).pipe(
        Effect.provide(
          makeLocalMapManagementLayer().pipe(
            Layer.provide(makeStubMapServiceLayer([entry])),
          ),
        ),
      ),
    ),
  );
  assert.ok(err instanceof MapNotFoundError);
  assert.equal(err.mapId, "no-such-map");
});

// ─── download ─────────────────────────────────────────────────────────────────

test("download(mapId) returns file bytes", async () => {
  const entry = await setupGramFile();
  const bytes = await run(
    [entry],
    Effect.flatMap(MapManagementService, (s) => s.download(entry.mapId)),
  );
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString("utf8"), GRAM_CONTENT);
});

test("download(unknown) fails with MapNotFoundError", async () => {
  const entry = await setupGramFile();
  const err = await Effect.runPromise(
    Effect.flip(
      Effect.flatMap(MapManagementService, (s) => s.download("no-such-map")).pipe(
        Effect.provide(
          makeLocalMapManagementLayer().pipe(
            Layer.provide(makeStubMapServiceLayer([entry])),
          ),
        ),
      ),
    ),
  );
  assert.ok(err instanceof MapNotFoundError);
});

// ─── archive (no-op) ──────────────────────────────────────────────────────────

test("archive() is a no-op (resolves without error)", async () => {
  const entry = await setupGramFile();
  // Should resolve to void without throwing
  await run(
    [entry],
    Effect.flatMap(MapManagementService, (s) => s.archive(entry.mapId)),
  );
});
