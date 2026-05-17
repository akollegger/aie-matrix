import neo4j, { type Driver } from "neo4j-driver";
import { Context, Effect, Layer } from "effect";

export type NonAdjacentKind = "ELEVATOR" | "PORTAL";

export interface NonAdjacentRow {
  readonly kind: NonAdjacentKind;
  readonly name: string;
  readonly toH3Index: string;
}

export interface Neo4jGraphOps {
  /** When false, non-adjacent graph features are unavailable (no Neo4j driver). */
  readonly configured: boolean;
  readonly listNonAdjacent: (fromH3Index: string) => Effect.Effect<readonly NonAdjacentRow[], never>;
  readonly findTraverseTarget: (fromH3Index: string, via: string) => Effect.Effect<string | undefined, never>;
}

export class Neo4jGraphService extends Context.Tag("aie-matrix/Neo4jGraphService")<
  Neo4jGraphService,
  Neo4jGraphOps
>() {}

export const makeNoOpNeo4jGraphLayer: Layer.Layer<Neo4jGraphService> = Layer.succeed(Neo4jGraphService, {
  configured: false,
  listNonAdjacent: () => Effect.succeed([]),
  findTraverseTarget: () => Effect.succeed(undefined),
});

export const makeLiveNeo4jGraphLayer = (driver: Driver): Layer.Layer<Neo4jGraphService> =>
  Layer.succeed(Neo4jGraphService, {
    configured: true,
    listNonAdjacent: (fromH3Index): Effect.Effect<readonly NonAdjacentRow[], never> =>
      Effect.promise(async () => {
        const session = driver.session({ defaultAccessMode: neo4j.session.READ });
        try {
          const result = await session.run(
            `MATCH (from:Portal { h3Index: $from })-[rel:CONNECTS]->(to:Portal)
             WHERE rel.kind IN ['ELEVATOR', 'PORTAL'] AND rel.name IS NOT NULL
             RETURN rel.kind AS kind, rel.name AS name, to.h3Index AS toH3`,
            { from: fromH3Index },
          );
          return result.records.map((rec) => ({
            kind: rec.get("kind") as NonAdjacentKind,
            name: rec.get("name") as string,
            toH3Index: rec.get("toH3") as string,
          }));
        } finally {
          await session.close();
        }
      }) as Effect.Effect<readonly NonAdjacentRow[], never>,
    findTraverseTarget: (fromH3Index, via): Effect.Effect<string | undefined, never> =>
      Effect.promise(async () => {
        const session = driver.session({ defaultAccessMode: neo4j.session.READ });
        try {
          const result = await session.run(
            `MATCH (from:Portal { h3Index: $from })-[rel:CONNECTS { name: $via }]->(to:Portal)
             WHERE rel.kind IN ['ELEVATOR', 'PORTAL']
             RETURN to.h3Index AS toH3 LIMIT 1`,
            { from: fromH3Index, via },
          );
          const rec = result.records[0];
          return rec ? (rec.get("toH3") as string) : undefined;
        } finally {
          await session.close();
        }
      }) as Effect.Effect<string | undefined, never>,
  });
