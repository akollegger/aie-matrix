import { getPentagons } from "h3-js";
import neo4j, { type Driver } from "neo4j-driver";
import type { LoadedMap } from "@aie-matrix/server-colyseus";

/**
 * Idempotent: MERGE pentagon `Cell` nodes and a full directed `PORTAL` mesh (IC-006 cosmology).
 * From pentagon cell index `i`, an edge to cell `j` uses `name: "pentagon-${j + 1}"` (1-based target index).
 */
export async function seedPentagonPortals(driver: Driver): Promise<void> {
  const cells = getPentagons(15);
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite(async (tx) => {
      for (const h3 of cells) {
        await tx.run(
          `MERGE (c:Cell { h3Index: $h3 })
           ON CREATE SET c.tileClass = 'Pentagon'`,
          { h3 },
        );
      }
      for (let i = 0; i < cells.length; i++) {
        for (let j = 0; j < cells.length; j++) {
          if (i === j) {
            continue;
          }
          const from = cells[i]!;
          const to = cells[j]!;
          const name = `pentagon-${j + 1}`;
          await tx.run(
            `MATCH (a:Cell { h3Index: $from }), (b:Cell { h3Index: $to })
             MERGE (a)-[r:PORTAL { name: $name }]->(b)`,
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
  readonly fromTileClass: string;
  readonly toTileClass: string;
}

/** MERGE endpoint cells and one `ELEVATOR` edge (TCK / dev fixtures). */
export async function seedElevatorEdge(driver: Driver, seed: ElevatorSeed): Promise<void> {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (a:Cell { h3Index: $from })
         ON CREATE SET a.tileClass = $fromClass
         SET a.tileClass = coalesce(a.tileClass, $fromClass)`,
        { from: seed.fromH3, fromClass: seed.fromTileClass },
      );
      await tx.run(
        `MERGE (b:Cell { h3Index: $to })
         ON CREATE SET b.tileClass = $toClass
         SET b.tileClass = coalesce(b.tileClass, $toClass)`,
        { to: seed.toH3, toClass: seed.toTileClass },
      );
      await tx.run(
        `MATCH (a:Cell { h3Index: $from }), (b:Cell { h3Index: $to })
         MERGE (a)-[r:ELEVATOR { name: $name }]->(b)`,
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
    const dest = map.cells.get(neighbor);
    await seedElevatorEdge(driver, {
      fromH3: anchor,
      toH3: neighbor,
      name: "tck-elevator",
      fromTileClass: cell.tileClass,
      toTileClass: dest?.tileClass ?? "Unknown",
    });
  }
}
