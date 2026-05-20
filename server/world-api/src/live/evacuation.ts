import neo4j, { type Driver } from "neo4j-driver";
import type { ColyseusWorldBridge } from "../colyseus-bridge.js";

// TODO RFC-0012: Release speaker room claims for ghosts on removedCells.
// Call speakerRoomService.releaseClaimsOnRemovedPolygons(removedCells) when RFC-0012 is implemented.

/**
 * Move ghosts that are on removed cells to a respawn cell, or mark them as in limbo.
 * Called after a map switch when cells are removed from the active world.
 */
export async function evacuateGhostsFromRemovedCells(
  driver: Driver,
  bridge: ColyseusWorldBridge,
  removedCells: string[],
  respawnCell?: string,
): Promise<void> {
  if (removedCells.length === 0) return;

  console.info(
    JSON.stringify({
      kind: "evacuation",
      op: "start",
      removedCellCount: removedCells.length,
      respawnCell: respawnCell ?? null,
    }),
  );

  // Query Neo4j for ghosts on removed cells
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const readResult = await session.run(
      `MATCH (g:Ghost)-[:AT]->(c:Tile)
       WHERE c.h3Index IN $removedCells
       RETURN g.ghostId AS ghostId, c.h3Index AS h3Index`,
      { removedCells },
    );

    const ghosts = readResult.records.map((r) => ({
      ghostId: r.get("ghostId") as string,
      h3Index: r.get("h3Index") as string,
    }));

    if (ghosts.length === 0) {
      console.info(JSON.stringify({ kind: "evacuation", op: "no-ghosts", removedCells }));
      return;
    }

    console.info(
      JSON.stringify({ kind: "evacuation", op: "evacuating", ghostCount: ghosts.length, respawnCell: respawnCell ?? null }),
    );

    for (const { ghostId } of ghosts) {
      if (respawnCell) {
        // Move ghost to respawn cell
        await session.executeWrite((tx) =>
          tx.run(
            `MATCH (g:Ghost { ghostId: $ghostId })-[r:AT]->()
             DELETE r
             WITH g
             MATCH (c:Tile { h3Index: $respawnCell })
             MERGE (g)-[:AT]->(c)
             SET g.limbo = null`,
            { ghostId, respawnCell },
          ),
        );
        bridge.setGhostCell(ghostId, respawnCell);
        console.info(JSON.stringify({ kind: "evacuation", op: "respawned", ghostId, respawnCell }));
      } else {
        // Mark ghost as in limbo
        await session.executeWrite((tx) =>
          tx.run(
            `MATCH (g:Ghost { ghostId: $ghostId })
             SET g.limbo = true`,
            { ghostId },
          ),
        );
        console.info(JSON.stringify({ kind: "evacuation", op: "limbo", ghostId }));
      }
    }
  } finally {
    await session.close();
  }
}
