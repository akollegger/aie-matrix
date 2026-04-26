import { glob, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Gram, Pattern, Subject } from "@relateby/pattern";
import type { GramParseError as RelatebyGramParseError } from "@relateby/pattern";
import { Context, Effect, HashMap, Layer, Option, pipe } from "effect";
import {
  GramParseError,
  MapFileReadError,
  MapIdCollisionError,
  MapNameMismatchError,
  MapNotFoundError,
} from "./map-errors.js";

export interface MapIndexEntry {
  readonly mapId: string;
  readonly tmjPath: string;
  readonly gramPath: string;
}

export interface MapServiceOps {
  readonly raw: (
    mapId: string,
    format: "gram" | "tmj",
  ) => Effect.Effect<Buffer, MapNotFoundError | MapFileReadError>;
  readonly validate: () => Effect.Effect<void, GramParseError | MapNameMismatchError | MapIdCollisionError>;
}

export class MapService extends Context.Tag("aie-matrix/MapService")<MapService, MapServiceOps>() {}

function stemFromTmjFilename(file: string): string | undefined {
  if (!file.endsWith(".tmj")) {
    return undefined;
  }
  return basename(file, ".tmj");
}

function stemFromGramFilename(file: string): string | undefined {
  if (!file.endsWith(".map.gram")) {
    return undefined;
  }
  return basename(file, ".map.gram");
}

function pairingKey(repoRoot: string, absolutePath: string, stem: string): string {
  const dir = dirname(relative(repoRoot, absolutePath));
  return `${dir}\0${stem}`;
}

function extractMatrixMapName(
  patterns: ReadonlyArray<Pattern<Subject>>,
  gramPath: string,
): Effect.Effect<string, GramParseError | MapNameMismatchError> {
  for (const p of patterns) {
    if (!(p.value instanceof Subject)) {
      continue;
    }
    const kindVal = pipe(p.value.properties, HashMap.get("kind"));
    const nameVal = pipe(p.value.properties, HashMap.get("name"));
    if (
      Option.isSome(kindVal) &&
      kindVal.value._tag === "StringVal" &&
      kindVal.value.value === "matrix-map" &&
      Option.isSome(nameVal) &&
      nameVal.value._tag === "StringVal"
    ) {
      return Effect.succeed(nameVal.value.value);
    }
  }
  return Effect.fail(
    new MapNameMismatchError({
      path: gramPath,
      expected: "(matrix-map header with name)",
      actual: "(no matrix-map document header found)",
    }),
  );
}

function mapRelatebyParseError(path: string, err: RelatebyGramParseError): GramParseError {
  return new GramParseError({
    path,
    cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
  });
}

function validateGramFile(
  gramPath: string,
  expectedStem: string,
): Effect.Effect<void, GramParseError | MapNameMismatchError> {
  return pipe(
    Effect.tryPromise({
      try: () => readFile(gramPath, "utf8"),
      catch: (e) =>
        new GramParseError({
          path: gramPath,
          cause: e instanceof Error ? e.message : String(e),
        }),
    }),
    Effect.flatMap((text) =>
      pipe(
        Gram.parse(text),
        Effect.mapError((e) => mapRelatebyParseError(gramPath, e)),
        Effect.flatMap((patterns) =>
          pipe(
            extractMatrixMapName(patterns, gramPath),
            Effect.flatMap((nameFromGram) =>
              nameFromGram === expectedStem
                ? Effect.void
                : Effect.fail(
                    new MapNameMismatchError({
                      path: gramPath,
                      expected: expectedStem,
                      actual: nameFromGram,
                    }),
                  ),
            ),
          ),
        ),
      ),
    ),
  );
}

function collectGlob(repoRoot: string, pattern: string): Effect.Effect<string[], never> {
  return Effect.promise(async () => {
    const out: string[] = [];
    for await (const p of glob(pattern, { cwd: repoRoot })) {
      out.push(p.replaceAll("\\", "/"));
    }
    return out;
  });
}

function scanMapPairs(
  repoRoot: string,
): Effect.Effect<Map<string, MapIndexEntry>, MapIdCollisionError> {
  return Effect.gen(function* () {
    const tmjRelPaths = yield* collectGlob(repoRoot, "maps/**/*.tmj");
    const gramRelPaths = yield* collectGlob(repoRoot, "maps/**/*.map.gram");

    const partial = new Map<
      string,
      { stem: string; dirKey: string; tmjAbs?: string; gramAbs?: string }
    >();

    for (const rel of tmjRelPaths) {
      const stem = stemFromTmjFilename(rel);
      if (stem === undefined) {
        continue;
      }
      const abs = join(repoRoot, rel);
      const key = pairingKey(repoRoot, abs, stem);
      const cur = partial.get(key) ?? { stem, dirKey: dirname(rel) };
      cur.tmjAbs = abs;
      partial.set(key, cur);
    }
    for (const rel of gramRelPaths) {
      const stem = stemFromGramFilename(rel);
      if (stem === undefined) {
        continue;
      }
      const abs = join(repoRoot, rel);
      const key = pairingKey(repoRoot, abs, stem);
      const cur = partial.get(key) ?? { stem, dirKey: dirname(rel) };
      cur.gramAbs = abs;
      partial.set(key, cur);
    }

    const byMapId = new Map<string, MapIndexEntry[]>();
    for (const v of partial.values()) {
      if (v.tmjAbs === undefined || v.gramAbs === undefined) {
        continue;
      }
      const list = byMapId.get(v.stem) ?? [];
      list.push({ mapId: v.stem, tmjPath: v.tmjAbs, gramPath: v.gramAbs });
      byMapId.set(v.stem, list);
    }

    const index = new Map<string, MapIndexEntry>();
    for (const [mapId, entries] of byMapId) {
      if (entries.length > 1) {
        return yield* Effect.fail(
          new MapIdCollisionError({
            mapId,
            paths: entries.flatMap((e) => [e.gramPath, e.tmjPath]),
          }),
        );
      }
      index.set(mapId, entries[0]!);
    }
    return index;
  });
}

function validateAllGrams(
  index: Map<string, MapIndexEntry>,
): Effect.Effect<void, GramParseError | MapNameMismatchError> {
  return Effect.forEach([...index.values()], (entry) => validateGramFile(entry.gramPath, entry.mapId), {
    discard: true,
  });
}

export const makeMapServiceLayer = (
  repoRoot: string,
): Layer.Layer<MapService, GramParseError | MapNameMismatchError | MapIdCollisionError> =>
  Layer.scoped(
    MapService,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const index = yield* scanMapPairs(repoRoot);
        yield* validateAllGrams(index);

        const impl: MapServiceOps = {
          validate: () => Effect.void,
          raw: (mapId, format) => {
            const entry = index.get(mapId);
            if (entry === undefined) {
              return Effect.fail(new MapNotFoundError({ mapId }));
            }
            const path = format === "gram" ? entry.gramPath : entry.tmjPath;
            return Effect.tryPromise({
              try: () => readFile(path),
              catch: (e) =>
                new MapFileReadError({
                  path,
                  cause: e instanceof Error ? e.message : String(e),
                }),
            });
          },
        };

        return impl;
      }),
      () => Effect.void,
    ),
  );

/** Repo root (`server/world-api/src/map/` → monorepo root). */
export const defaultRepoRootForMapService = join(fileURLToPath(new URL("../../../..", import.meta.url)));
