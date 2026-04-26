import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Cause, Effect, Exit, Option, pipe } from "effect";
import { makeMapServiceLayer, MapService } from "../src/map/MapService.js";

const fixturesDir = fileURLToPath(new URL("fixtures/map", import.meta.url));

const minimalTmj = JSON.stringify({ width: 1, height: 1, layers: [], tilesets: [] });

async function writePair(root: string, mapsRelDir: string, stem: string, gramFixtureFile: string): Promise<void> {
  const dir = join(root, "maps", mapsRelDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${stem}.tmj`), minimalTmj, "utf8");
  await cp(join(fixturesDir, gramFixtureFile), join(dir, `${stem}.map.gram`));
}

function assertFailureWithTag(
  exit: Exit.Exit<unknown, unknown>,
  expectedTag: "MapError.GramParse" | "MapError.NameMismatch" | "MapError.IdCollision",
): void {
  assert.ok(Exit.isFailure(exit), "expected Failure exit");
  const errOpt = Cause.failureOption(exit.cause);
  assert.ok(Option.isSome(errOpt), "expected a typed failure");
  assert.equal(errOpt.value._tag, expectedTag);
}

function acquireMapService(root: string) {
  return Effect.gen(function* () {
    yield* MapService;
  }).pipe(Effect.provide(makeMapServiceLayer(root)));
}

test("startup: malformed gram → MapError.GramParse", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-bad-"));
  try {
    await writePair(root, "sandbox", "bad-syntax", "bad-syntax.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assertFailureWithTag(exit, "MapError.GramParse");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: matrix-map name ≠ filename stem → MapError.NameMismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-mismatch-"));
  try {
    await writePair(root, "sandbox", "name-mismatch", "name-mismatch.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assertFailureWithTag(exit, "MapError.NameMismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: two TMJ+gram pairs with same mapId (stem) → MapError.IdCollision", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-collision-"));
  try {
    await writePair(root, "pack-a", "shared", "collision-a.map.gram");
    await writePair(root, "pack-b", "shared", "collision-b.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assertFailureWithTag(exit, "MapError.IdCollision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: valid paired maps → MapService acquires", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-ok-"));
  try {
    await writePair(root, "sandbox", "valid", "valid.map.gram");
    const exit = await Effect.runPromiseExit(
      pipe(
        Effect.gen(function* () {
          const maps = yield* MapService;
          return yield* maps.raw("valid", "gram");
        }),
        Effect.provide(makeMapServiceLayer(root)),
      ),
    );
    assert.ok(Exit.isSuccess(exit), "expected successful startup and raw read");
    if (Exit.isSuccess(exit)) {
      assert.ok(exit.value.length > 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
