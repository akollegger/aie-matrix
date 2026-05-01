import assert from "node:assert/strict";
import test from "node:test";

import { CascadeBuilder, CascadeClosedError } from "./cascade.js";
import {
  createExternalStimulusEvent,
  createSurfaceActionEvent,
  type Stimulus,
} from "./events.js";
import type { AppliedAdjustment } from "./adjustments.js";

function triggerStimulus(): ReturnType<typeof createExternalStimulusEvent> {
  const s: Stimulus = { kind: "utterance", from: "ghost_42", text: "hey" };
  return createExternalStimulusEvent(s, { id: "ROOT", timestamp: 1000 });
}

const SAMPLE_ADJUSTMENT: AppliedAdjustment = {
  facet: "Warmth",
  axis: "internal",
  direction: "up",
  beforeDisplay: 5,
  afterDisplay: 6.22,
};

test("CascadeBuilder starts with the trigger event as the root and first event", () => {
  const trigger = triggerStimulus();
  const b = new CascadeBuilder("ghost_self", trigger);
  assert.equal(b.ghostId, "ghost_self");
  assert.equal(b.rootEventId, trigger.id);
  assert.equal(b.startedAt, trigger.timestamp);
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0]!.id, trigger.id);
});

test("addThought defaults causedBy to the last event", () => {
  const trigger = triggerStimulus();
  const b = new CascadeBuilder("g", trigger);
  const t = b.addThought({ role: "monologue", content: "hm." });
  assert.equal(t.causedBy, trigger.id);
});

test("causedBy chains linearly through successive additions", () => {
  const trigger = triggerStimulus();
  const b = new CascadeBuilder("g", trigger);
  const t1 = b.addThought({ role: "monologue", content: "a" });
  const t2 = b.addThought({ role: "reflection", content: "b" });
  const action = b.addSurfaceAction({ kind: "say", text: "hi" }, { ok: true });
  assert.equal(t1.causedBy, trigger.id);
  assert.equal(t2.causedBy, t1.id);
  assert.equal(action.causedBy, t2.id);
});

test("explicit causedBy overrides the default chain", () => {
  const trigger = triggerStimulus();
  const b = new CascadeBuilder("g", trigger);
  const action = b.addSurfaceAction(
    { kind: "go", toward: "ne" },
    { ok: true },
    { id: "ACTION" },
  );
  // Both adjustments branch off the action, not each other.
  const a1 = b.addAdjustment(SAMPLE_ADJUSTMENT, { causedBy: action.id });
  const a2 = b.addAdjustment(
    { ...SAMPLE_ADJUSTMENT, direction: "down", afterDisplay: 3.78 },
    { causedBy: action.id },
  );
  assert.equal(a1.causedBy, "ACTION");
  assert.equal(a2.causedBy, "ACTION");
});

test("complete() returns an immutable trace with ordered events", () => {
  const trigger = triggerStimulus();
  const b = new CascadeBuilder("g", trigger);
  b.addThought({ role: "monologue", content: "x" }, { id: "T1", timestamp: 1001 });
  b.addSurfaceAction(
    { kind: "say", text: "hi" },
    { ok: true },
    { id: "S1", timestamp: 1002 },
  );
  b.addAdjustment(SAMPLE_ADJUSTMENT, { id: "A1", timestamp: 1003 });
  const trace = b.complete({ completedAt: 1_100 });
  assert.equal(trace.ghostId, "g");
  assert.equal(trace.rootEventId, trigger.id);
  assert.equal(trace.startedAt, 1000);
  assert.equal(trace.completedAt, 1_100);
  assert.equal(trace.events.length, 4);
  assert.deepEqual(
    trace.events.map((e) => e.id),
    [trigger.id, "T1", "S1", "A1"],
  );
  // Immutability: attempting to mutate should throw under strict mode.
  assert.throws(() => {
    (trace.events as unknown as Event[]).push({} as unknown as Event);
  });
});

test("complete() called twice throws CascadeClosedError", () => {
  const b = new CascadeBuilder("g", triggerStimulus());
  b.complete({ completedAt: 1_050 });
  assert.throws(() => b.complete(), CascadeClosedError);
});

test("addThought after complete() throws CascadeClosedError", () => {
  const b = new CascadeBuilder("g", triggerStimulus());
  b.complete({ completedAt: 1_050 });
  assert.throws(() => b.addThought({ role: "monologue", content: "late" }), CascadeClosedError);
});

test("SurfaceActionEvent can be a cascade trigger (own-action reflection)", () => {
  const trigger = createSurfaceActionEvent(
    { kind: "go", toward: "ne" },
    { ok: false, code: "RULESET_DENY" },
    { id: "SELF_ACTION", timestamp: 500 },
  );
  const b = new CascadeBuilder("g", trigger);
  assert.equal(b.rootEventId, trigger.id);
  // Adjustment following a self-reflective cascade
  const a = b.addAdjustment(SAMPLE_ADJUSTMENT);
  assert.equal(a.causedBy, trigger.id);
});

test("mid-build events getter returns a snapshot, not the live array", () => {
  const b = new CascadeBuilder("g", triggerStimulus());
  const snap1 = b.events;
  b.addThought({ role: "monologue", content: "x" });
  const snap2 = b.events;
  assert.equal(snap1.length, 1);
  assert.equal(snap2.length, 2);
});

// Needed for the immutability test above — Event is the local event union.
import type { Event } from "./events.js";
