import { createHash } from "node:crypto";
import neo4j, { type Driver } from "neo4j-driver";
import { Context, Effect, Layer } from "effect";
import { parseMapGram } from "@aie-matrix/map-gram";
import { GcsService } from "../gcs/GcsService.js";
import type { GcsError } from "../gcs/GcsService.js";
import { MapAlreadyActiveError, MapNotFoundError, MapPublishError } from "./map-errors.js";

export interface MapRecord {
  readonly mapId: string;
  /** Human name from the gram header — may differ from mapId (file stem). */
  readonly name: string;
  readonly elevation: number;
  readonly gcsPath: string;
  readonly contentHash: string;
  readonly status: "published" | "archived";
  readonly publishedAt: string;
  readonly archivedAt?: string;
}

export interface MapManagementOps {
  publish(mapId: string, bytes: Buffer): Effect.Effect<MapRecord, MapPublishError | GcsError>;
  list(status?: "published" | "archived"): Effect.Effect<readonly MapRecord[], never>;
  get(mapId: string): Effect.Effect<MapRecord, MapNotFoundError>;
  download(mapId: string): Effect.Effect<Buffer, MapNotFoundError | GcsError>;
  archive(mapId: string): Effect.Effect<void, MapNotFoundError | MapAlreadyActiveError>;
}

export class MapManagementService extends Context.Tag("aie-matrix/MapManagementService")<
  MapManagementService,
  MapManagementOps
>() {}


function rowToMapRecord(record: {
  get(key: string): unknown;
}): MapRecord {
  const archivedAt = record.get("archivedAt");
  return {
    mapId: record.get("mapId") as string,
    name: (record.get("name") as string | null) ?? (record.get("mapId") as string),
    elevation: (record.get("elevation") as number | null) ?? 0,
    gcsPath: record.get("gcsPath") as string,
    contentHash: record.get("contentHash") as string,
    status: record.get("status") as "published" | "archived",
    publishedAt: record.get("publishedAt") as string,
    ...(archivedAt != null ? { archivedAt: archivedAt as string } : {}),
  };
}

const MAP_RETURN_FIELDS = `
  m.mapId AS mapId, m.name AS name, m.elevation AS elevation,
  m.gcsPath AS gcsPath, m.contentHash AS contentHash,
  m.status AS status,
  toString(m.publishedAt) AS publishedAt,
  toString(m.archivedAt) AS archivedAt`;

export function makeMapManagementLayer(driver: Driver): Layer.Layer<MapManagementService, never, GcsService> {
  return Layer.effect(
    MapManagementService,
    Effect.gen(function* () {
      const gcs = yield* GcsService;

      const publish = (mapId: string, bytes: Buffer): Effect.Effect<MapRecord, MapPublishError | GcsError> =>
        Effect.gen(function* () {
          // Parse and validate using the shared map-gram parser
          const text = bytes.toString("utf8");
          const parsedMap = yield* Effect.tryPromise({
            try: () => parseMapGram(text),
            catch: (e) =>
              new MapPublishError({
                mapId,
                cause: e instanceof Error ? e.message : String(e),
              }),
          });

          const contentHash = createHash("sha256").update(bytes).digest("hex");

          // Check idempotent: same hash + published already exists
          const existing: MapRecord | null = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.READ });
            try {
              const result = await session.run(
                `MATCH (m:Map { mapId: $mapId, contentHash: $contentHash, status: "published" })
                 RETURN ${MAP_RETURN_FIELDS}`,
                { mapId, contentHash },
              );
              const rec = result.records[0];
              if (!rec) return null;
              return rowToMapRecord(rec);
            } finally {
              await session.close();
            }
          });

          if (existing) {
            return existing;
          }

          // Upload to GCS
          const gcsPath = yield* gcs.upload(`maps/${mapId}.map.gram`, bytes);

          // ── Build row arrays from parsed map ────────────────────────────

          const layerRows = parsedMap.layers.map((l) => ({
            identity: l.identity,
            kind: l.kind,
            name: l.name,
            stackOrder: l.stackOrder,
          }));

          const tileRows = parsedMap.explicitTiles.map((t) => ({
            h3Index: t.h3Index,
            tileClass: t.tileType,
            layerIdentity: t.layerIdentity,
          }));

          const polygonRows = parsedMap.polygons.map((p) => ({
            typeName: p.typeName,
            vertices: p.vertices,
            layerIdentity: p.layerIdentity,
            name: p.name ?? null,
            description: p.description ?? null,
          }));

          const itemRows = parsedMap.itemPlacements.map((p) => ({
            h3Index: p.h3Index,
            itemTypeName: p.itemRef,
            layerIdentity: p.layerIdentity,
          }));

          const portalRows = parsedMap.portals.map((p) => ({
            fromCell: p.fromCell,
            toCell: p.toCell,
            mode: p.mode,
            layerIdentity: p.layerIdentity,
          }));

          const tileTypeRows = [...parsedMap.tileTypes.values()].map((tt) => ({
            identity: tt.identity,
            typeName: tt.typeName,
            name: tt.name,
            description: tt.description ?? null,
            capacity: tt.capacity ?? null,
            cssStyle: tt.style ?? null,   // re-emit as css`...` on round-trip
          }));

          const itemTypeRows = [...parsedMap.itemTypes.values()].map((it) => ({
            identity: it.identity,
            typeName: it.typeName,
            name: it.name,
            description: it.description ?? null,
            charGlyph: it.glyph ?? null,  // re-emit as char`...` on round-trip
            takeable: it.takeable ?? null,
            capacityCost: it.capacityCost ?? null,
          }));

          const ruleRows = parsedMap.rules.map((r) => ({
            fromType: r.fromType,
            toType: r.toType,
            ruleClass: "GO", // ParsedRule only captures GO rules; extend when parser captures other rule classes
          }));

          // ── Single Neo4j session ─────────────────────────────────────────
          const record: MapRecord = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              // 1. Upsert Map node (with gram header fields)
              const mapResult = await session.executeWrite((tx) =>
                tx.run(
                  `MERGE (m:Map { mapId: $mapId })
                   SET m.name = $name,
                       m.elevation = $elevation,
                       m.gcsPath = $gcsPath,
                       m.contentHash = $contentHash,
                       m.status = "published",
                       m.publishedAt = datetime(),
                       m.archivedAt = null
                   RETURN ${MAP_RETURN_FIELDS}`,
                  { mapId, name: parsedMap.name, elevation: parsedMap.elevation, gcsPath, contentHash },
                ),
              );

              // 2. Clear all stale per-map graph elements before re-seeding.
              //    DETACH DELETE removes the nodes and all their relationships,
              //    including [:IN_LAYER] edges, so those are never left dangling.
              for (const cypher of [
                `MATCH (m:Map { mapId: $mapId })-[:DEFINES]->(def)
                 WHERE def:TileType OR def:ItemType OR def:Layer
                 DETACH DELETE def`,
                `MATCH (i:Item    { sourceMapId: $mapId }) DETACH DELETE i`,
                `MATCH (p:Polygon { sourceMapId: $mapId }) DETACH DELETE p`,
                `MATCH (p:Portal  { sourceMapId: $mapId }) DETACH DELETE p`,
              ]) {
                await session.executeWrite((tx) => tx.run(cypher, { mapId }));
              }

              // 3. Create Layer nodes (must exist before elements are linked with [:IN_LAYER])
              if (layerRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $layers AS layer
                     MATCH (m:Map { mapId: $mapId })
                     CREATE (m)-[:DEFINES]->(l:Layer {
                       mapId: $mapId,
                       identity: layer.identity,
                       kind: layer.kind,
                       name: layer.name,
                       stackOrder: layer.stackOrder
                     })`,
                    { layers: layerRows, mapId },
                  ),
                );
              }

              // 4. Seed Tile nodes and link to their layer
              if (tileRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $tiles AS tile
                     MERGE (t:Tile { h3Index: tile.h3Index })
                     SET t.tileClass = tile.tileClass, t.sourceMapId = $mapId
                     WITH t, tile
                     MATCH (l:Layer { mapId: $mapId, identity: tile.layerIdentity })
                     CREATE (t)-[:IN_LAYER]->(l)`,
                    { tiles: tileRows, mapId },
                  ),
                );
              }

              // 5. Create TileType definition nodes
              if (tileTypeRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $types AS tt
                     MATCH (m:Map { mapId: $mapId })
                     CREATE (m)-[:DEFINES]->(t:TileType {
                       mapId: $mapId,
                       identity: tt.identity, typeName: tt.typeName, name: tt.name,
                       description: tt.description, capacity: tt.capacity, cssStyle: tt.cssStyle
                     })`,
                    { types: tileTypeRows, mapId },
                  ),
                );
              }

              // 5. Create ItemType definition nodes
              if (itemTypeRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $types AS it
                     MATCH (m:Map { mapId: $mapId })
                     CREATE (m)-[:DEFINES]->(t:ItemType {
                       mapId: $mapId,
                       identity: it.identity, typeName: it.typeName, name: it.name,
                       description: it.description, charGlyph: it.charGlyph,
                       takeable: it.takeable, capacityCost: it.capacityCost
                     })`,
                    { types: itemTypeRows, mapId },
                  ),
                );
              }

              // 6. Create rules between TileType nodes
              if (ruleRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $rules AS rule
                     MATCH (from:TileType { mapId: $mapId, identity: rule.fromType })
                     MATCH (to:TileType   { mapId: $mapId, identity: rule.toType })
                     CREATE (from)-[:RULE { mapId: $mapId, ruleClass: rule.ruleClass }]->(to)`,
                    { rules: ruleRows, mapId },
                  ),
                );
              }

              // 7. Create Portal nodes and link the "from" endpoint to its layer
              if (portalRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $portals AS p
                     MATCH (l:Layer { mapId: $mapId, identity: p.layerIdentity })
                     CREATE (from:Portal { h3Index: p.fromCell, sourceMapId: $mapId })
                     CREATE (to:Portal   { h3Index: p.toCell,   sourceMapId: $mapId })
                     CREATE (from)-[:CONNECTS { kind: 'PORTAL', mode: p.mode, sourceMapId: $mapId }]->(to)
                     CREATE (from)-[:IN_LAYER]->(l)`,
                    { portals: portalRows, mapId },
                  ),
                );
              }

              // 8. Create Polygon nodes and link to their layer
              if (polygonRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $polygons AS p
                     MATCH (l:Layer { mapId: $mapId, identity: p.layerIdentity })
                     CREATE (poly:Polygon { typeName: p.typeName, vertices: p.vertices, sourceMapId: $mapId, name: p.name, description: p.description })
                     CREATE (poly)-[:IN_LAYER]->(l)`,
                    { polygons: polygonRows, mapId },
                  ),
                );
              }

              // 9. Create Item nodes and link to their layer
              if (itemRows.length > 0) {
                await session.executeWrite((tx) =>
                  tx.run(
                    `UNWIND $items AS item
                     MATCH (l:Layer { mapId: $mapId, identity: item.layerIdentity })
                     CREATE (i:Item { h3Index: item.h3Index, itemTypeName: item.itemTypeName, sourceMapId: $mapId })
                     CREATE (i)-[:IN_LAYER]->(l)`,
                    { items: itemRows, mapId },
                  ),
                );
              }

              return rowToMapRecord(mapResult.records[0]!);
            } finally {
              await session.close();
            }
          });

          return record;
        });

      const list = (status?: "published" | "archived"): Effect.Effect<readonly MapRecord[], never> =>
        Effect.promise(async () => {
          const session = driver.session({ defaultAccessMode: neo4j.session.READ });
          try {
            const cypher =
              status !== undefined
                ? `MATCH (m:Map { status: $status }) RETURN ${MAP_RETURN_FIELDS} ORDER BY m.mapId`
                : `MATCH (m:Map) RETURN ${MAP_RETURN_FIELDS} ORDER BY m.mapId`;
            const result = await session.run(cypher, status !== undefined ? { status } : {});
            return result.records.map(rowToMapRecord);
          } finally {
            await session.close();
          }
        });

      const get = (mapId: string): Effect.Effect<MapRecord, MapNotFoundError> =>
        Effect.promise(async () => {
          const session = driver.session({ defaultAccessMode: neo4j.session.READ });
          try {
            const result = await session.run(
              `MATCH (m:Map { mapId: $mapId }) RETURN ${MAP_RETURN_FIELDS}`,
              { mapId },
            );
            return result.records[0] ?? null;
          } finally {
            await session.close();
          }
        }).pipe(
          Effect.flatMap((rec) => {
            if (rec === null) {
              return Effect.fail(new MapNotFoundError({ mapId }));
            }
            return Effect.succeed(rowToMapRecord(rec));
          }),
        );

      const archive = (mapId: string): Effect.Effect<void, MapNotFoundError | MapAlreadyActiveError> =>
        Effect.gen(function* () {
          // Check map exists
          yield* get(mapId);

          // Check active session references
          const activeSessions: number = yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.READ });
            try {
              const result = await session.run(
                `MATCH (s:LiveSession)-[:USES]->(m:Map { mapId: $mapId })
                 WHERE s.status = "active"
                 RETURN count(s) AS n`,
                { mapId },
              );
              const rec = result.records[0];
              const n = rec?.get("n");
              return typeof n === "number" ? n : (n as { low: number }).low ?? 0;
            } finally {
              await session.close();
            }
          });

          if (activeSessions > 0) {
            yield* Effect.fail(new MapAlreadyActiveError({ mapId }));
          }

          // Archive
          yield* Effect.promise(async () => {
            const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
            try {
              await session.executeWrite((tx) =>
                tx.run(
                  `MATCH (m:Map { mapId: $mapId })
                   SET m.status = "archived", m.archivedAt = datetime()`,
                  { mapId },
                ),
              );
            } finally {
              await session.close();
            }
          });
        });

      const download = (mapId: string): Effect.Effect<Buffer, MapNotFoundError | GcsError> =>
        Effect.gen(function* () {
          yield* get(mapId); // verifies the map exists
          return yield* gcs.download(`maps/${mapId}.map.gram`);
        });

      return { publish, list, get, download, archive };
    }),
  );
}
