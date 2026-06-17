/**
 * GroupService integration tests (Neo4j-backed GroupServiceLive).
 * Skipped when NEO4J_URI is not set.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import { LedgerServiceInMemoryLayer } from "../src/LedgerServiceInMemory.js";
import { WorldBridgeService } from "../src/WorldBridgeService.js";

const NEO4J_URI = process.env.NEO4J_URI;
const skip = !NEO4J_URI;
const label = skip ? "[SKIP — NEO4J_URI unset] " : "";

test(`${label}GroupServiceLive.createGroup — creates Group node and MEMBER_OF edges`, { skip }, async () => {
  const neo4j = await import("neo4j-driver");
  const { makeGroupServiceLiveLayer } = await import("../src/GroupServiceLive.js");

  const driver = neo4j.default.driver(
    NEO4J_URI!,
    neo4j.default.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
  );

  const noopBridge = {
    getGhostCell: () => undefined,
    listOccupantsOnCell: () => [],
    setGhostMode: () => {},
    getGhostMode: () => "normal" as const,
    setGhostLastAction: () => {},
    fanoutWorldV1: () => {},
  };

  const layer = Layer.provide(
    makeGroupServiceLiveLayer(driver, "/tmp/aie-matrix-test-groups"),
    Layer.merge(
      Layer.succeed(WorldBridgeService, noopBridge as any),
      LedgerServiceInMemoryLayer,
    ),
  );

  try {
    const { GroupService } = await import("../src/GroupService.js");
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* GroupService;
          const r = yield* svc.createGroup({
            groupId: ulid(),
            ghostA: `gA-${ulid()}`,
            ghostB: `gB-${ulid()}`,
            resource: "trust",
            amount: 5,
            formationTxId: ulid(),
          });
          return r;
        }),
        layer,
      ),
    );
    assert.ok(result.groupId.length > 0);
    assert.ok(result.name.length > 0);
  } finally {
    await driver.close();
  }
});

test(`${label}GroupServiceLive.listMemberships — returns groups after createGroup`, { skip }, async () => {
  const neo4j = await import("neo4j-driver");
  const { makeGroupServiceLiveLayer } = await import("../src/GroupServiceLive.js");

  const driver = neo4j.default.driver(
    NEO4J_URI!,
    neo4j.default.auth.basic(process.env.NEO4J_USER ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
  );

  const noopBridge = { getGhostCell: () => undefined, listOccupantsOnCell: () => [], setGhostMode: () => {}, getGhostMode: () => "normal" as const, setGhostLastAction: () => {}, fanoutWorldV1: () => {} };
  const layer = Layer.provide(
    makeGroupServiceLiveLayer(driver, "/tmp/aie-matrix-test-groups"),
    Layer.merge(
      Layer.succeed(WorldBridgeService, noopBridge as any),
      LedgerServiceInMemoryLayer,
    ),
  );

  const ghostA = `gA-${ulid()}`;
  const ghostB = `gB-${ulid()}`;

  try {
    const { GroupService } = await import("../src/GroupService.js");
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const groups = yield* GroupService;
          const created = yield* groups.createGroup({ groupId: ulid(), ghostA, ghostB, resource: "trust", amount: 5, formationTxId: ulid() });
          const memberships = yield* groups.listMemberships(ghostA);
          return { created, memberships };
        }),
        layer,
      ),
    );
    assert.ok(result.memberships.some(m => m.groupId === result.created.groupId));
  } finally {
    await driver.close();
  }
});
