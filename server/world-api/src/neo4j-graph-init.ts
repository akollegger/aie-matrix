import neo4j, { type Driver } from "neo4j-driver";

/**
 * Idempotent constraint for `(:Tile { h3Index })` nodes. Run once per Neo4j database.
 * The H3 index is a coordinate attribute of a Tile, not a materialized coordinate node.
 */
export const TILE_H3_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT tile_h3_unique IF NOT EXISTS FOR (t:Tile) REQUIRE t.h3Index IS UNIQUE";

export const MAP_MAPID_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT map_mapid_unique IF NOT EXISTS FOR (m:Map) REQUIRE m.mapId IS UNIQUE";

export const LIVESESSION_ID_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT livesession_id_unique IF NOT EXISTS FOR (s:LiveSession) REQUIRE s.id IS UNIQUE";

export const TILETYPE_MAP_IDENTITY_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT tiletype_map_identity_unique IF NOT EXISTS FOR (t:TileType) REQUIRE (t.mapId, t.identity) IS UNIQUE";

export const ITEMTYPE_MAP_IDENTITY_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT itemtype_map_identity_unique IF NOT EXISTS FOR (t:ItemType) REQUIRE (t.mapId, t.identity) IS UNIQUE";

/** @returns A driver if `NEO4J_URI` is set; otherwise `undefined` (Neo4j is optional until graph features land). */
export function createNeo4jDriverFromEnv(env: NodeJS.ProcessEnv = process.env): Driver | undefined {
  const uri = env.NEO4J_URI?.trim();
  if (!uri) {
    return undefined;
  }
  const user = env.NEO4J_USER?.trim() || "neo4j";
  const password = env.NEO4J_PASSWORD ?? "";
  return neo4j.driver(uri, neo4j.auth.basic(user, password));
}

export async function ensureTileH3UniqueConstraint(driver: Driver): Promise<void> {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite((tx) => tx.run(TILE_H3_UNIQUE_CONSTRAINT_CYPHER));
  } finally {
    await session.close();
  }
}

export async function ensureMapManagementConstraints(driver: Driver): Promise<void> {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    for (const cypher of [
      MAP_MAPID_UNIQUE_CONSTRAINT_CYPHER,
      LIVESESSION_ID_UNIQUE_CONSTRAINT_CYPHER,
      TILETYPE_MAP_IDENTITY_UNIQUE_CONSTRAINT_CYPHER,
      ITEMTYPE_MAP_IDENTITY_UNIQUE_CONSTRAINT_CYPHER,
    ]) {
      await session.executeWrite((tx) => tx.run(cypher));
    }
  } finally {
    await session.close();
  }
}
