import { getPentagons } from "h3-js";
import neo4j, { type Driver } from "neo4j-driver";
import type { LoadedMap } from "@aie-matrix/server-colyseus";

/**
 * Idempotent: MERGE pentagon `Portal` nodes and a full directed `CONNECTS` mesh (IC-006 cosmology).
 * Pentagon H3 indices are coordinate locations — not materialized Tile nodes.
 */
export async function seedPentagonPortals(driver: Driver): Promise<void> {
  const cells = getPentagons(15);
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite(async (tx) => {
      for (const h3 of cells) {
        await tx.run(
          `MERGE (:Portal { h3Index: $h3 })`,
          { h3 },
        );
      }
      for (let i = 0; i < cells.length; i++) {
        for (let j = 0; j < cells.length; j++) {
          if (i === j) continue;
          const from = cells[i]!;
          const to = cells[j]!;
          const name = `pentagon-${j + 1}`;
          await tx.run(
            `MATCH (a:Portal { h3Index: $from }), (b:Portal { h3Index: $to })
             MERGE (a)-[r:CONNECTS { name: $name }]->(b)
             ON CREATE SET r.kind = 'PORTAL'`,
            { from, to, name },
          );
        }
      }
    });
  } finally {
    await session.close();
  }
}

export interface ElevatorSeed {
  readonly fromH3: string;
  readonly toH3: string;
  readonly name: string;
}

/** MERGE endpoint Portal nodes and one `CONNECTS` edge of kind ELEVATOR (TCK / dev fixtures). */
export async function seedElevatorEdge(driver: Driver, seed: ElevatorSeed): Promise<void> {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (:Portal { h3Index: $from })`,
        { from: seed.fromH3 },
      );
      await tx.run(
        `MERGE (:Portal { h3Index: $to })`,
        { to: seed.toH3 },
      );
      await tx.run(
        `MATCH (a:Portal { h3Index: $from }), (b:Portal { h3Index: $to })
         MERGE (a)-[r:CONNECTS { name: $name }]->(b)
         ON CREATE SET r.kind = 'ELEVATOR'`,
        { from: seed.fromH3, to: seed.toH3, name: seed.name },
      );
    });
  } finally {
    await session.close();
  }
}

/** Pentagon mesh + elevator from map anchor to one navigable neighbor (contract / TCK). */
export async function seedNeo4jGraphArtifacts(driver: Driver, map: LoadedMap): Promise<void> {
  await seedPentagonPortals(driver);
  const anchor = map.anchorH3;
  const cell = map.cells.get(anchor);
  const neighbor = cell ? Object.values(cell.neighbors).find((x) => x !== undefined) : undefined;
  if (cell && neighbor) {
    await seedElevatorEdge(driver, {
      fromH3: anchor,
      toH3: neighbor,
      name: "tck-elevator",
    });
  }
}
