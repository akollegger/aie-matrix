/**
 * Integration timing test for MapManagementService.publish().
 *
 * Measures cold publish (new map → full Neo4j write + GCS upload) and
 * warm re-publish (same bytes → hash-skip, one Neo4j read).
 *
 * When NEO4J_URI is set (staging CI with Neo4j already running), connects
 * directly. Otherwise spins up a testcontainer.
 *
 * To run:
 *   pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import neo4j from "neo4j-driver";
import { Effect, Layer, ManagedRuntime } from "effect";
import { MapManagementService, makeMapManagementLayer } from "../src/map/MapManagementService.js";
import { makeLocalGcsStubLayer } from "../src/gcs/GcsService.js";
import { ensureMapManagementConstraints } from "../src/neo4j-graph-init.js";

const PUBLISH_TIMEOUT_MS = 30_000;
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

let driver: ReturnType<typeof neo4j.driver>;
let tmpDir: string;
let runtime: ManagedRuntime.ManagedRuntime<MapManagementService, never>;

const MAP_ID = `test-map-publish-${Date.now()}`;
const MAP_BYTES = Buffer.from(`{ kind: "matrix-map", name: "${MAP_ID}", elevation: 0 }

(blue:TileType:Blue { name: "Blue" })
[tiles:Layer {kind: "tile"} | (:Tile:Blue { geometry: [h3\`8f2800000000000\`] })]
[layers:LayerStack | tiles]
[rules:Rules | (blue)-[:GO]->(blue)]
`);

test.before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "map-publish-test-"));

  const existingUri = process.env.NEO4J_URI?.trim();
  if (existingUri) {
    const user = process.env.NEO4J_USER?.trim() ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD ?? "";
    driver = neo4j.driver(existingUri, neo4j.auth.basic(user, password));
  } else {
    const { GenericContainer, Wait } = await import("testcontainers");
    const container = await new GenericContainer("neo4j:5")
      .withEnvironment({ NEO4J_AUTH: "neo4j/testpassword" })
      .withExposedPorts(7474, 7687)
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();
    const boltUrl = `bolt://${container.getHost()}:${container.getMappedPort(7687)}`;
    driver = neo4j.driver(boltUrl, neo4j.auth.basic("neo4j", "testpassword"));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const s = driver.session();
        await s.run("RETURN 1");
        await s.close();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  await ensureMapManagementConstraints(driver);

  // Clean up any leftover Map node from a previous test run
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await s.run(`MATCH (m:Map { mapId: $mapId }) DETACH DELETE m`, { mapId: MAP_ID });
  } finally {
    await s.close();
  }

  const gcsLayer = makeLocalGcsStubLayer(tmpDir);
  const mgmtLayer = makeMapManagementLayer(driver).pipe(Layer.provide(gcsLayer));
  runtime = ManagedRuntime.make(mgmtLayer);
}, { timeout: CONTAINER_STARTUP_TIMEOUT_MS + 65_000 });

test.after(async () => {
  await runtime?.dispose();
  await driver?.close();
  await rm(tmpDir, { recursive: true, force: true });
});

test("MapManagementService.publish cold (new map → full Neo4j write + GCS)", async () => {
  const start = performance.now();
  const rec = await runtime.runPromise(
    Effect.flatMap(MapManagementService, (svc) => svc.publish(MAP_ID, MAP_BYTES)),
  );
  const elapsed = performance.now() - start;

  console.log(`publish cold: ${elapsed.toFixed(0)}ms  mapId=${rec.mapId} hash=${rec.contentHash.slice(0, 8)}`);
  assert.ok(elapsed < PUBLISH_TIMEOUT_MS, `cold publish took ${elapsed.toFixed(0)}ms, expected < ${PUBLISH_TIMEOUT_MS}ms`);
}, { timeout: PUBLISH_TIMEOUT_MS + 5_000 });

test("MapManagementService.publish warm (same bytes → hash-skip, one Neo4j read)", async () => {
  const start = performance.now();
  const rec = await runtime.runPromise(
    Effect.flatMap(MapManagementService, (svc) => svc.publish(MAP_ID, MAP_BYTES)),
  );
  const elapsed = performance.now() - start;

  console.log(`publish warm: ${elapsed.toFixed(0)}ms  mapId=${rec.mapId} (idempotent skip)`);
  assert.ok(elapsed < 5_000, `warm publish (hash-skip) took ${elapsed.toFixed(0)}ms, expected < 5000ms`);
}, { timeout: 10_000 });

test("MapManagementService.publish re-publish (changed bytes → full write)", async () => {
  const changedBytes = Buffer.from(MAP_BYTES.toString("utf8").replace("elevation: 0", "elevation: 1"));

  const start = performance.now();
  const rec = await runtime.runPromise(
    Effect.flatMap(MapManagementService, (svc) => svc.publish(MAP_ID, changedBytes)),
  );
  const elapsed = performance.now() - start;

  console.log(`publish re-publish: ${elapsed.toFixed(0)}ms  mapId=${rec.mapId} hash=${rec.contentHash.slice(0, 8)}`);
  assert.ok(elapsed < PUBLISH_TIMEOUT_MS, `re-publish took ${elapsed.toFixed(0)}ms, expected < ${PUBLISH_TIMEOUT_MS}ms`);
}, { timeout: PUBLISH_TIMEOUT_MS + 5_000 });
