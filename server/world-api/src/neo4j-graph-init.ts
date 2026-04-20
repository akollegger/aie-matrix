import neo4j, { type Driver } from "neo4j-driver";

/**
 * Idempotent constraint for `(:Cell { h3Index })` nodes. Run once per Neo4j database.
 * All Cypher that matches `Cell` nodes should use `h3Index` (not legacy `tileId` / `"col,row"` keys).
 */
export const CELL_H3_UNIQUE_CONSTRAINT_CYPHER =
  "CREATE CONSTRAINT cell_h3_unique IF NOT EXISTS FOR (c:Cell) REQUIRE c.h3Index IS UNIQUE";

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

export async function ensureCellH3UniqueConstraint(driver: Driver): Promise<void> {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite((tx) => tx.run(CELL_H3_UNIQUE_CONSTRAINT_CYPHER));
  } finally {
    await session.close();
  }
}
