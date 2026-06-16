/**
 * GDS backend toggle for the consolidation pipeline.
 *
 * The community-detection step (KNN → Leiden) runs on Neo4j GDS. There are
 * two ways to reach GDS, and which one is available depends on where the
 * graph lives — so the author chooses per deployment:
 *
 *  - "sessions" (DEFAULT): Aura GDS **Sessions**. `gds.session.getOrCreate`
 *    spins up a managed remote compute instance and projections route to it
 *    via the `{ sessionId }` config. This is the Aura/cloud path and stays
 *    the default so nothing changes for the existing author workflow.
 *
 *  - "in-db": the self-hosted **graph-data-science plugin** running inside the
 *    Neo4j instance itself (e.g. the Docker stack). No session lifecycle —
 *    projections, KNN and Leiden all run locally. Set `PEPPERS_GDS_MODE=in-db`
 *    and ensure the Neo4j container loads the GDS plugin.
 *
 * The graph algorithms (knn.mutate, graph.relationships.toUndirected,
 * leiden.stream) are byte-identical across modes; only the session lifecycle
 * and the projection's routing config differ.
 */
export type GdsMode = "sessions" | "in-db";

export function gdsMode(): GdsMode {
  return process.env.PEPPERS_GDS_MODE === "in-db" ? "in-db" : "sessions";
}
