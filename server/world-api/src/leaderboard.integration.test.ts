import { describe, it } from "node:test";

const NEO4J_URI = process.env.NEO4J_URI;

describe("LeaderboardServiceLive (integration)", { skip: !NEO4J_URI }, () => {
  it("listLeaderboards returns declared specs", async () => {
    // TODO: implement when Neo4j container available
  });
  it("getLeaderboard returns ranked entries from real ledger data", async () => {});
  it("finalizeLeaderboards persists snapshot with isFinal: true", async () => {});
  it("getLeaderboard after finalization returns frozen snapshot", async () => {});
  it("stale cache returned on query failure", async () => {});
});
