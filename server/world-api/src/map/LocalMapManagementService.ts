/**
 * MapService-backed MapManagementService for development mode (AIE_MATRIX_MODE=development).
 *
 * Derives a published MapRecord for every .map.gram file discovered by MapService —
 * i.e. every file under the maps/ directory tree. No Neo4j or GCS required.
 *
 * Limitations:
 * - Read-only: publish and archive are no-ops / die.
 * - publishedAt is approximated to the time of the API call, not the file mtime.
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { MapManagementService, type MapRecord } from "./MapManagementService.js"
import { MapService, type MapIndexEntry } from "./MapService.js"
import { MapNotFoundError } from "./map-errors.js"

async function entryToRecord(entry: MapIndexEntry): Promise<MapRecord> {
  const bytes = await readFile(entry.gramPath)
  return {
    mapId: entry.mapId,
    name: entry.mapId,
    elevation: 0,
    gcsPath: `file://${entry.gramPath}`,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    status: "published",
    publishedAt: new Date().toISOString(),
  }
}

export function makeLocalMapManagementLayer(): Layer.Layer<MapManagementService, never, MapService> {
  return Layer.effect(
    MapManagementService,
    Effect.gen(function* () {
      const mapSvc = yield* MapService

      /** Resolves a single entry by mapId, or fails with MapNotFoundError. */
      const findEntry = (mapId: string): Effect.Effect<MapIndexEntry, MapNotFoundError> =>
        mapSvc.listEntries().pipe(
          Effect.flatMap(entries => {
            const entry = entries.find(e => e.mapId === mapId)
            return entry
              ? Effect.succeed(entry)
              : Effect.fail(new MapNotFoundError({ mapId }))
          }),
        )

      return {
        publish: (_mapId, _bytes) =>
          Effect.die("MapManagementService.publish not supported in development mode"),

        list: (status?) =>
          status === "archived"
            ? Effect.succeed([])
            : mapSvc.listEntries().pipe(
                Effect.flatMap(entries =>
                  Effect.tryPromise({
                    try: () => Promise.all(entries.map(entryToRecord)),
                    catch: (e) => new Error(`LocalMapManagementService: failed to read gram files: ${e}`),
                  }).pipe(Effect.orDie),
                ),
              ),

        get: (mapId: string) =>
          findEntry(mapId).pipe(
            Effect.flatMap(entry =>
              Effect.tryPromise({
                try: () => entryToRecord(entry),
                catch: () => new MapNotFoundError({ mapId }),
              }),
            ),
          ),

        download: (mapId: string) =>
          findEntry(mapId).pipe(
            Effect.flatMap(entry =>
              Effect.tryPromise({
                try: () => readFile(entry.gramPath),
                catch: () => new MapNotFoundError({ mapId }),
              }),
            ),
          ),

        archive: (_mapId) => Effect.void,
      }
    }),
  )
}
