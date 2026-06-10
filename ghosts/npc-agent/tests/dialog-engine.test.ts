import { describe, it, expect } from "vitest";
import { evaluateDialog, initialDialogState } from "../src/dialog/dialog-engine.js";
import type { DialogTree, DialogState } from "../src/types.js";

// ── Fixture: AI Engineer World's Fair conference guide ────────────────────────
//
// States:   idle → schedule → (wildcard) → idle
//                → farewell → (wildcard) → idle
//                → (wildcard self-loop)  → idle
//
// FSM: idle is the root; every state returns to idle via its wildcard edge.
// The idle state's wildcard edge is an explicit self-loop (authors must include it).

const CONFERENCE_TREE: DialogTree = {
  id: "dialog_1",
  rootId: "idle",
  nodes: new Map([
    [
      "idle",
      {
        id: "idle",
        responses: ["How can I help? Ask about the schedule, sessions, or say goodbye."],
      },
    ],
    [
      "schedule",
      {
        id: "schedule",
        responses: ["Keynotes start at 9am in Hall A. Workshops run all day in Hall B."],
      },
    ],
    [
      "farewell",
      {
        id: "farewell",
        responses: ["Enjoy the Fair!", "See you around!"],
      },
    ],
  ]),
  edges: [
    { fromId: "idle", toId: "schedule", triggers: ["schedule", "talk", "session", "when"] },
    { fromId: "idle", toId: "farewell", triggers: ["thanks", "bye", "goodbye"] },
    { fromId: "idle", toId: "idle",     triggers: [] }, // explicit idle self-loop
    { fromId: "schedule", toId: "idle", triggers: [] }, // return to idle
    { fromId: "farewell", toId: "idle", triggers: [] }, // return to idle
  ],
};

function freshState(): DialogState {
  return initialDialogState(CONFERENCE_TREE);
}

// ── Trigger matching ──────────────────────────────────────────────────────────

describe("evaluateDialog — trigger matching", () => {
  it("matches a schedule trigger and responds with the target node's text", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "when does it start?");
    expect(result.response).toBe(
      "Keynotes start at 9am in Hall A. Workshops run all day in Hall B.",
    );
  });

  it("matches using substring (not exact word)", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "what sessions are there?");
    expect(result.response).toBe(
      "Keynotes start at 9am in Hall A. Workshops run all day in Hall B.",
    );
  });

  it("wildcard self-loop fires when no specific trigger matches from idle", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "Where is the nearest coffee?");
    expect(result.response).toBe(
      "How can I help? Ask about the schedule, sessions, or say goodbye.",
    );
  });

  it("trigger match is case-insensitive", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "BYE BYE");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(result.response);
  });
});

// ── Response selection ────────────────────────────────────────────────────────

describe("evaluateDialog — response selection", () => {
  it("returns a response from the TARGET node's responses array", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "bye");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(result.response);
  });

  it("always returns one of the listed responses (100 trials)", () => {
    const allowed = ["Enjoy the Fair!", "See you around!"];
    for (let i = 0; i < 100; i++) {
      const r = evaluateDialog(CONFERENCE_TREE, freshState(), "goodbye");
      expect(allowed).toContain(r.response);
    }
  });

  it("wildcard self-loop response comes from idle node", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "xyzzy");
    expect(result.response).toBe(
      "How can I help? Ask about the schedule, sessions, or say goodbye.",
    );
  });
});

// ── State transitions ─────────────────────────────────────────────────────────

describe("evaluateDialog — state transitions", () => {
  it("advances to the target node after a specific trigger match", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "session");
    expect(result.nextNodeId).toBe("schedule");
  });

  it("wildcard self-loop keeps idle at idle", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "xyzzy");
    expect(result.nextNodeId).toBe("idle");
  });

  it("wildcard return edge sends non-idle state back to idle", () => {
    const atSchedule: DialogState = { currentNodeId: "schedule", lastUpdated: "" };
    const result = evaluateDialog(CONFERENCE_TREE, atSchedule, "something unrelated");
    expect(result.nextNodeId).toBe("idle");
  });

  it("returns idle's responses when returning from a non-idle state via wildcard", () => {
    const atSchedule: DialogState = { currentNodeId: "schedule", lastUpdated: "" };
    const result = evaluateDialog(CONFERENCE_TREE, atSchedule, "something unrelated");
    expect(result.response).toBe(
      "How can I help? Ask about the schedule, sessions, or say goodbye.",
    );
  });
});

// ── Partner state isolation ───────────────────────────────────────────────────

describe("evaluateDialog — two partners track independent state", () => {
  it("advancing state for partner A does not affect partner B", () => {
    const stateA: DialogState = { currentNodeId: "idle", lastUpdated: "" };
    const stateB: DialogState = { currentNodeId: "idle", lastUpdated: "" };

    // Partner A asks about sessions → advances to schedule
    const resultA = evaluateDialog(CONFERENCE_TREE, stateA, "what sessions are on?");
    expect(resultA.nextNodeId).toBe("schedule");

    // Partner B's object is unmodified — still at idle
    expect(stateB.currentNodeId).toBe("idle");

    // Partner B says goodbye → matches farewell from idle
    const resultB = evaluateDialog(CONFERENCE_TREE, stateB, "bye");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(resultB.response);
    expect(resultB.nextNodeId).toBe("farewell");
  });
});

// ── Multi-turn conversation ───────────────────────────────────────────────────

describe("evaluateDialog — multi-turn conversation", () => {
  it("follows idle → schedule → idle (wildcard) → farewell over three turns", () => {
    let state = freshState();

    // Turn 1: specific trigger → schedule
    const r1 = evaluateDialog(CONFERENCE_TREE, state, "what sessions are on?");
    expect(r1.response).toBe(
      "Keynotes start at 9am in Hall A. Workshops run all day in Hall B.",
    );
    expect(r1.nextNodeId).toBe("schedule");
    state = { currentNodeId: r1.nextNodeId, lastUpdated: "" };

    // Turn 2: no match from schedule → wildcard → return to idle
    const r2 = evaluateDialog(CONFERENCE_TREE, state, "cool thanks");
    expect(r2.response).toBe(
      "How can I help? Ask about the schedule, sessions, or say goodbye.",
    );
    expect(r2.nextNodeId).toBe("idle");
    state = { currentNodeId: r2.nextNodeId, lastUpdated: "" };

    // Turn 3: farewell trigger from idle
    const r3 = evaluateDialog(CONFERENCE_TREE, state, "goodbye!");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(r3.response);
    expect(r3.nextNodeId).toBe("farewell");
  });
});

// ── initialDialogState ────────────────────────────────────────────────────────

describe("initialDialogState", () => {
  it("initializes at the tree's rootId", () => {
    const state = initialDialogState(CONFERENCE_TREE);
    expect(state.currentNodeId).toBe("idle");
    expect(state.lastUpdated).toBeTruthy();
  });
});

// ── Concurrent dialog state isolation (stress) ────────────────────────────────
//
// Simulates 50 partners talking to the same NPC simultaneously.
// Each partner advances through the tree independently — no state bleeds across.

describe("concurrent dialog state isolation", () => {
  it("50 partners maintain fully independent FSM state", () => {
    const PARTNER_COUNT = 50;

    // Initialise a separate state object per partner.
    const states = new Map<string, DialogState>();
    for (let i = 0; i < PARTNER_COUNT; i++) {
      states.set(`partner-${i}`, initialDialogState(CONFERENCE_TREE));
    }

    // Even-indexed partners ask about the schedule; odd-indexed say goodbye.
    for (const [id, state] of states) {
      const idx = parseInt(id.split("-")[1]!, 10);
      const input = idx % 2 === 0 ? "what is the schedule?" : "goodbye";
      const result = evaluateDialog(CONFERENCE_TREE, state, input);
      states.set(id, { currentNodeId: result.nextNodeId, lastUpdated: new Date().toISOString() });
    }

    for (const [id, state] of states) {
      const idx = parseInt(id.split("-")[1]!, 10);
      if (idx % 2 === 0) {
        expect(state.currentNodeId).toBe("schedule");
      } else {
        expect(state.currentNodeId).toBe("farewell");
      }
    }
  });

  it("partners in different states advance independently on the same input", () => {
    // partnerA is already in "schedule" state; partnerB is at "idle".
    const stateA: DialogState = { currentNodeId: "schedule", lastUpdated: new Date().toISOString() };
    const stateB: DialogState = initialDialogState(CONFERENCE_TREE);

    // Both receive the same message.
    const resultA = evaluateDialog(CONFERENCE_TREE, stateA, "hello");
    const resultB = evaluateDialog(CONFERENCE_TREE, stateB, "hello");

    // stateA (schedule) has only a wildcard edge → returns to idle.
    expect(resultA.nextNodeId).toBe("idle");
    // stateB (idle) has no specific match → stays at idle via self-loop.
    expect(resultB.nextNodeId).toBe("idle");
  });

  it("100 sequential turns across 10 partners produce consistent state transitions", () => {
    const PARTNERS = 10;
    const TURNS = 10;
    const states = new Map<string, DialogState>();
    for (let i = 0; i < PARTNERS; i++) {
      states.set(`p${i}`, initialDialogState(CONFERENCE_TREE));
    }

    // Interleave turns: each partner advances one step at a time.
    for (let turn = 0; turn < TURNS; turn++) {
      for (const [id, state] of states) {
        // Alternate between asking about schedule and saying goodbye each turn.
        const idx = parseInt(id.slice(1), 10);
        const input = (turn + idx) % 2 === 0 ? "schedule" : "goodbye";
        const result = evaluateDialog(CONFERENCE_TREE, state, input);
        states.set(id, { currentNodeId: result.nextNodeId, lastUpdated: new Date().toISOString() });
      }
    }

    // After an even number of identical alternating turns, all partners must be
    // in a valid tree node — none can be in an undefined or leaked state.
    const validNodeIds = new Set(CONFERENCE_TREE.nodes.keys());
    for (const state of states.values()) {
      expect(validNodeIds.has(state.currentNodeId)).toBe(true);
    }
  });
});
