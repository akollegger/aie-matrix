import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Effect, ManagedRuntime } from "effect";
import { makeMapServiceLayer, MapService } from "../src/map/MapService.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("MapService.raw(freeplay, tmj) returns exact on-disk TMJ bytes", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const buf = await runtime.runPromise(
      Effect.gen(function* () {
        const maps = yield* MapService;
        return yield* maps.raw("freeplay", "tmj");
      }),
    );
    const expected = await readFile(join(repoRoot, "maps/sandbox/freeplay.tmj"));
    assert.ok(buf.equals(expected), "TMJ response must match source file bytes");
  } finally {
    await runtime.dispose();
  }
});
