import { glob, readFile } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Gram, Pattern, Subject } from "@relateby/pattern";
import type { GramParseError as RelatebyGramParseError } from "@relateby/pattern";
import { Context, Effect, HashMap, HashSet, Layer, Option, pipe } from "effect";
import {
  GramParseError,
  MapFileReadError,
  MapIdCollisionError,
  MapNameMismatchError,
  MapNotFoundError,
} from "./map-errors.js";

export interface MapIndexEntry {
  readonly mapId: string;
  readonly gramPath: string;
}

export interface MapServiceOps {
  /**
   * Known maps in this process (index built at layer acquisition).
   * Sorted by `mapId` for stable API output.
   */
  readonly listEntries: () => Effect.Effect<readonly Readonly<MapIndexEntry>[], never>;
  readonly raw: (
    mapId: string,
  ) => Effect.Effect<Buffer, MapNotFoundError | MapFileReadError>;
  readonly validate: () => Effect.Effect<void, GramParseError | MapNameMismatchError | MapIdCollisionError>;
  /** The mapId of the currently active Colyseus game map, or undefined if undetermined. */
  readonly activeMapId: () => string | undefined;
}

export class MapService extends Context.Tag("aie-matrix/MapService")<MapService, MapServiceOps>() {}

function stemFromGramFilename(file: string): string | undefined {
  if (!file.endsWith(".map.gram")) {
    return undefined;
  }
  return basename(file, ".map.gram");
}

function hasLayerStack(patterns: ReadonlyArray<Pattern<Subject>>): boolean {
  for (const p of patterns) {
    if (!(p.value instanceof Subject)) continue;
    if (HashSet.has(p.value.labels, "LayerStack")) return true;
  }
  return false;
}

function checkLayerStackPresent(
  patterns: ReadonlyArray<Pattern<Subject>>,
  gramPath: string,
): Effect.Effect<void, GramParseError> {
  return hasLayerStack(patterns)
    ? Effect.void
    : Effect.fail(
        new GramParseError({
          path: gramPath,
          cause: "missing LayerStack — document must contain [layers:LayerStack | ...]",
        }),
      );
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
  _expectedStem: string,
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
            checkLayerStackPresent(patterns, gramPath),
            // Validate header exists; name is display text, stem is the mapId
            Effect.flatMap(() => extractMatrixMapName(patterns, gramPath)),
            Effect.asVoid,
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
    const gramRelPaths = yield* collectGlob(repoRoot, "maps/**/*.map.gram");

    const byMapId = new Map<string, MapIndexEntry[]>();
    for (const rel of gramRelPaths) {
      const stem = stemFromGramFilename(rel);
      if (stem === undefined) {
        continue;
      }
      const abs = join(repoRoot, rel);
      const list = byMapId.get(stem) ?? [];
      list.push({ mapId: stem, gramPath: abs });
      byMapId.set(stem, list);
    }

    const index = new Map<string, MapIndexEntry>();
    for (const [mapId, entries] of byMapId) {
      if (entries.length > 1) {
        return yield* Effect.fail(
          new MapIdCollisionError({
            mapId,
            paths: entries.map((e) => e.gramPath),
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

/**
 * Resolve an absolute `.map.gram` path to the `mapId` in the index.
 * Returns `undefined` if the path is not indexed (e.g. outside `maps/`).
 */
function resolveActiveMapId(
  index: Map<string, MapIndexEntry>,
  activeGramPath: string | undefined,
): string | undefined {
  if (activeGramPath === undefined) return undefined;
  const normalised = normalize(activeGramPath);
  for (const entry of index.values()) {
    if (normalize(entry.gramPath) === normalised) return entry.mapId;
  }
  return undefined;
}

export const makeMapServiceLayer = (
  repoRoot: string,
  /** Absolute path to the active `.map.gram` file (typically from `AIE_MATRIX_MAP`). */
  activeGramPath?: string,
): Layer.Layer<MapService, GramParseError | MapNameMismatchError | MapIdCollisionError> =>
  Layer.scoped(
    MapService,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const index = yield* scanMapPairs(repoRoot);
        yield* validateAllGrams(index);

        const resolvedActiveId = resolveActiveMapId(index, activeGramPath);

        const listSorted = () =>
          Effect.succeed(
            [...index.values()]
              .sort((a, b) => a.mapId.localeCompare(b.mapId, "en", { sensitivity: "variant" }))
              .map((e) => ({ ...e } as Readonly<MapIndexEntry>)),
          );

        const impl: MapServiceOps = {
          listEntries: listSorted,
          validate: () => Effect.void,
          activeMapId: () => resolvedActiveId,
          raw: (mapId) => {
            const entry = index.get(mapId);
            if (entry === undefined) {
              return Effect.fail(new MapNotFoundError({ mapId }));
            }
            return Effect.tryPromise({
              try: () => readFile(entry.gramPath),
              catch: (e) =>
                new MapFileReadError({
                  path: entry.gramPath,
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
