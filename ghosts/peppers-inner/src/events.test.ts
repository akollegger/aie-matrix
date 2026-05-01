import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalStimulusEvent,
  createIdAdjustmentEvent,
  createIdThoughtEvent,
  createSurfaceActionEvent,
  type ActionOutcome,
  type Event,
  type Stimulus,
  type SurfaceAction,
} from "./events.js";
import type { AppliedAdjustment } from "./adjustments.js";

test("createExternalStimulusEvent wraps the stimulus and auto-fills id and timestamp", () => {
  const stim: Stimulus = { kind: "utterance", from: "ghost_42", text: "hi" };
  const e = createExternalStimulusEvent(stim);
  assert.equal(e.type, "EXTERNAL_STIMULUS");
  assert.deepEqual(e.stimulus, stim);
  assert.equal(typeof e.id, "string");
  assert.ok(e.id.length > 0);
  assert.equal(typeof e.timestamp, "number");
  assert.equal(e.causedBy, undefined);
});

test("createExternalStimulusEvent respects EventOptions overrides for determinism", () => {
  const stim: Stimulus = { kind: "tile-entered", h3Index: "8f...", tileClass: "Hallway" };
  const e = createExternalStimulusEvent(stim, {
    id: "01ID",
    timestamp: 1_700_000_000_000,
    causedBy: "ROOT",
  });
  assert.equal(e.id, "01ID");
  assert.equal(e.timestamp, 1_700_000_000_000);
  assert.equal(e.causedBy, "ROOT");
});

test("createSurfaceActionEvent carries both the intended action and the observed outcome", () => {
  const action: SurfaceAction = { kind: "go", toward: "ne" };
  const outcome: ActionOutcome = { ok: false, code: "RULESET_DENY", reason: "not allowed" };
  const e = createSurfaceActionEvent(action, outcome, { id: "S1", timestamp: 100 });
  assert.equal(e.type, "SURFACE_ACTION");
  assert.deepEqual(e.action, action);
  assert.deepEqual(e.outcome, outcome);
});

test("createIdThoughtEvent distinguishes monologue from reflection", () => {
  const mono = createIdThoughtEvent(
    { role: "monologue", content: "I feel something shift." },
    { id: "T1", timestamp: 1 },
  );
  const refl = createIdThoughtEvent(
    { role: "reflection", content: "Maybe I should let it go." },
    { id: "T2", timestamp: 2 },
  );
  assert.equal(mono.type, "ID_THOUGHT");
  assert.equal(mono.thought.role, "monologue");
  assert.equal(refl.thought.role, "reflection");
});

test("createIdAdjustmentEvent wraps an AppliedAdjustment", () => {
  const applied: AppliedAdjustment = {
    facet: "Warmth",
    axis: "internal",
    direction: "up",
    beforeDisplay: 5.0,
    afterDisplay: 6.22,
  };
  const e = createIdAdjustmentEvent(applied, { id: "A1", timestamp: 3 });
  assert.equal(e.type, "ID_ADJUSTMENT");
  assert.deepEqual(e.adjustment, applied);
});

test("discriminated union narrows correctly on the `type` field", () => {
  const events: Event[] = [
    createExternalStimulusEvent({ kind: "utterance", from: "g1", text: "hi" }),
    createSurfaceActionEvent({ kind: "say", text: "hello" }, { ok: true }),
    createIdThoughtEvent({ role: "monologue", content: "..." }),
    createIdAdjustmentEvent({
      facet: "Trust",
      axis: "external",
      direction: "down",
      beforeDisplay: 5,
      afterDisplay: 3.78,
    }),
  ];
  // Exhaustive narrowing proves the union covers every case at the type level.
  for (const e of events) {
    switch (e.type) {
      case "EXTERNAL_STIMULUS":
        assert.ok(e.stimulus);
        break;
      case "SURFACE_ACTION":
        assert.ok(e.action);
        assert.ok(e.outcome);
        break;
      case "ID_THOUGHT":
        assert.ok(e.thought);
        break;
      case "ID_ADJUSTMENT":
        assert.ok(e.adjustment);
        break;
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }
});

test("auto-generated ids are unique across rapid constructions", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const e = createIdThoughtEvent({ role: "reflection", content: `t${i}` });
    assert.ok(!seen.has(e.id), `duplicate id ${e.id}`);
    seen.add(e.id);
  }
});
