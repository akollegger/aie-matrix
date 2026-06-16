/**
 * Commit-latency benchmark for LedgerService (SC-008: p95 < 10ms).
 *
 * Uses node:test's built-in timing. Measures in-memory commit() over 1000
 * sequential calls and asserts p95 < 10ms.
 *
 * Neo4j-backed p95 is tracked separately via integration test timing (T016).
 *
 * Run:
 *   pnpm --filter @aie-matrix/server-world-api test
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ResourceType } from "@aie-matrix/shared-types";
import { makeLedgerServiceInMemory } from "../src/LedgerServiceInMemory.js";

const GOLD: ResourceType = { id: "gold", class: "conserved", qty: 10_000, floor: 0, label: "Gold" };
const ITERATIONS = 1000;

test(`SC-008: commit() p95 < 10ms over ${ITERATIONS} sequential calls (in-memory)`, () => {
  const svc = makeLedgerServiceInMemory();
  Effect.runSync(svc.init([GOLD]));

  // Warm up: 50 commits before measuring
  for (let i = 0; i < 50; i++) {
    Effect.runSync(svc.commit({
      id: ulid(),
      transfers: [{ resource: "gold", qty: 1, from: "world", to: `ghost-warm-${i}` }],
      cause: "bench.warmup", actors: [], ts: Date.now(),
    }));
  }

  const latencies: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    Effect.runSync(svc.commit({
      id: ulid(),
      transfers: [{ resource: "gold", qty: 1, from: "world", to: `ghost-bench-${i % 100}` }],
      cause: "bench.commit", actors: [], ts: Date.now(),
    }));
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(ITERATIONS * 0.50)]!;
  const p95 = latencies[Math.floor(ITERATIONS * 0.95)]!;
  const p99 = latencies[Math.floor(ITERATIONS * 0.99)]!;

  console.log(`  commit() latency — p50: ${p50.toFixed(3)}ms  p95: ${p95.toFixed(3)}ms  p99: ${p99.toFixed(3)}ms`);

  assert.ok(p95 < 10, `p95 latency ${p95.toFixed(3)}ms exceeds 10ms target (SC-008)`);
});
