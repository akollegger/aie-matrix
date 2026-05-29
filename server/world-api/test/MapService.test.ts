import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Effect, ManagedRuntime, pipe } from "effect";
import { makeMapServiceLayer, MapService } from "../src/map/MapService.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("MapService.raw(freeplay) returns gram bytes", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const buf = await runtime.runPromise(
      Effect.gen(function* () {
        const maps = yield* MapService;
        return yield* maps.raw("freeplay");
      }),
    );
    assert.ok(buf.length > 0, "gram response must be non-empty");
    assert.ok(buf.toString("utf8").includes("matrix-map"), "gram response must be a matrix-map document");
  } finally {
    await runtime.dispose();
  }
});

test("MapService.listEntries() does not include tmjPath field", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const entries = await runtime.runPromise(
      pipe(
        MapService,
        Effect.flatMap((maps) => maps.listEntries()),
        Effect.provide(layer),
      ),
    );
    for (const entry of entries) {
      assert.ok(!("tmjPath" in entry), `entry ${entry.mapId} must not have tmjPath`);
      assert.ok(entry.gramPath.endsWith(".map.gram"), `entry ${entry.mapId} gramPath must end with .map.gram`);
    }
  } finally {
    await runtime.dispose();
  }
});
