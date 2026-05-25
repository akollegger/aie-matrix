import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Cause, Effect, Exit, Option, pipe } from "effect";
import { makeMapServiceLayer, MapService } from "../src/map/MapService.js";

const fixturesDir = fileURLToPath(new URL("fixtures/map", import.meta.url));

async function writeGramFile(root: string, mapsRelDir: string, stem: string, gramFixtureFile: string): Promise<void> {
  const dir = join(root, "maps", mapsRelDir);
  await mkdir(dir, { recursive: true });
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
    await writeGramFile(root, "sandbox", "bad-syntax", "bad-syntax.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assertFailureWithTag(exit, "MapError.GramParse");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: matrix-map name ≠ filename stem → succeeds (name is display text, stem is mapId)", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-mismatch-"));
  try {
    await writeGramFile(root, "sandbox", "name-mismatch", "name-mismatch.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assert.ok(Exit.isSuccess(exit), "name mismatch should no longer block load");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: two gram files with same mapId (stem) in different dirs → MapError.IdCollision", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-collision-"));
  try {
    await writeGramFile(root, "pack-a", "shared", "collision-a.map.gram");
    await writeGramFile(root, "pack-b", "shared", "collision-b.map.gram");
    const exit = await Effect.runPromiseExit(acquireMapService(root));
    assertFailureWithTag(exit, "MapError.IdCollision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup: valid paired maps → MapService acquires", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-startup-ok-"));
  try {
    await writeGramFile(root, "sandbox", "valid", "valid.map.gram");
    const exit = await Effect.runPromiseExit(
      pipe(
        Effect.gen(function* () {
          const maps = yield* MapService;
          return yield* maps.raw("valid");
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
