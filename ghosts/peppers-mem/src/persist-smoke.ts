/**
 * Milestone 5 smoke: build a multi-event CascadeTrace using
 * `peppers-inner` types, persist it through `persistCascade`, and
 * verify the cascade round-trips through `memory_get_context`.
 *
 * Run with:
 *   pnpm --filter @aie-matrix/ghost-peppers-mem run smoke:cascade
 *
 * Writes ~5 messages to PeppersGhosts (incurring a small OpenAI
 * embedding cost per message). Cleanup query at the end of the file.
 */

import { randomUUID } from "node:crypto";

import { loadRootEnv } from "@aie-matrix/root-env";

import {
  CascadeBuilder,
  DEFAULT_DELTA,
  applyDelta,
  createExternalStimulusEvent,
  midpointPersonality,
  toDisplay,
  type Adjustment,
  type AppliedAdjustment,
  type FacetName,
  type PersonalityState,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

import { connectMemory } from "./client.js";
import { callOrThrow, persistCascade } from "./persist.js";

loadRootEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}; check .env at repo root`);
  return value;
}

function inspect(label: string, value: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const handle = await connectMemory({
    connection: {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    },
    // extended profile (the default) — required for memory_start_trace etc.
  });

  try {
    // 1. Build a representative cascade.
    const ghostId = `peppers-cascade-${randomUUID()}`;
    const marker = `cascade-marker-${randomUUID()}`;

    const trigger = createExternalStimulusEvent(
      { kind: "utterance", from: "ghost_42", text: marker },
      { timestamp: Date.now() },
    );
    const builder = new CascadeBuilder(ghostId, trigger);

    builder.addThought({
      role: "monologue",
      content: "Tonight has felt tight. Something in me leans back.",
    });
    builder.addThought({
      role: "reflection",
      content: "Maybe I'm being unfair to ghost_42.",
    });
    builder.addSurfaceAction({ kind: "say", text: "Sure, I'd love to." }, { ok: true });

    // Apply real adjustments per-facet via applyDelta so we capture
    // genuine before/after display values rather than fabricated numbers.
    const start = midpointPersonality();
    const adjustments: Adjustment[] = [
      { facet: "Warmth", axis: "internal", direction: "up" },
      { facet: "Trust", axis: "external", direction: "down" },
    ];
    let next: Record<FacetName, TraitState> = { ...start } as PersonalityState;
    const applied: AppliedAdjustment[] = [];
    for (const a of adjustments) {
      const trait = next[a.facet];
      const before = trait[a.axis];
      const after = applyDelta(before, a.direction, DEFAULT_DELTA);
      next = { ...next, [a.facet]: { ...trait, [a.axis]: after } };
      applied.push({
        ...a,
        beforeDisplay: toDisplay(before),
        afterDisplay: toDisplay(after),
      });
    }
    for (const a of applied) {
      builder.addAdjustment(a);
    }

    const trace = builder.complete();
    inspect("Cascade event count", trace.events.length);
    inspect(
      "Cascade roles",
      trace.events.map((e) => ({
        type: e.type,
        role:
          e.type === "EXTERNAL_STIMULUS"
            ? `stimulus-${e.stimulus.kind}`
            : e.type === "SURFACE_ACTION"
              ? `surface-${e.action.kind}`
              : e.type === "ID_THOUGHT"
                ? `id-${e.thought.role}`
                : "id-adjustment",
      })),
    );

    // 2. Persist.
    await persistCascade(handle.client, trace);
    inspect("Persisted", `ghostId=${ghostId} events=${trace.events.length}`);

    // 3. Round-trip via memory_get_context (with reasoning enabled) using the
    //    marker as the semantic query.
    const context = await callOrThrow(handle.client, "memory_get_context", {
      session_id: ghostId,
      query: marker,
      include_reasoning: true,
    });
    inspect("Retrieved context", context);

    // 4. Verify the cascade landed in the right tiers via direct Cypher.
    //    The conversation utterance should be a Message; the cognitive
    //    events should be ReasoningStep nodes under a ReasoningTrace.
    const counts = await callOrThrow(handle.client, "graph_query", {
      query: `
        MATCH (c:Conversation { session_id: $sid })
        OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
        WITH c, count(m) AS message_count
        OPTIONAL MATCH (t:ReasoningTrace { session_id: $sid })
        OPTIONAL MATCH (t)-->(s:ReasoningStep)
        RETURN
          message_count,
          count(DISTINCT t) AS trace_count,
          count(DISTINCT s) AS step_count
      `,
      parameters: { sid: ghostId },
    });
    inspect("Per-session counts in graph", counts);

    const row = (counts as { rows?: Array<Record<string, unknown>> })?.rows?.[0];
    const messageCount = Number(row?.message_count ?? 0);
    const traceCount = Number(row?.trace_count ?? 0);
    const stepCount = Number(row?.step_count ?? 0);

    if (traceCount < 1) {
      inspect("FAIL", "no ReasoningTrace nodes were created for this session");
      process.exit(1);
    }
    if (stepCount < trace.events.length - 1) {
      inspect(
        "WARN — fewer ReasoningStep nodes than non-trigger events",
        { expected_at_least: trace.events.length - 1, got: stepCount },
      );
    }

    inspect("OK", {
      ghostId,
      messageCount,
      traceCount,
      stepCount,
      cascadeEventCount: trace.events.length,
    });
    inspect(
      "Cleanup hint",
      `MATCH (n) WHERE any(k IN keys(n) WHERE toString(n[k]) STARTS WITH "peppers-") DETACH DELETE n`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error("\nSmoke FAILED:", err);
  process.exit(1);
});
