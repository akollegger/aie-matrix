import { describe, it, expect } from "vitest";
import { evaluateDialog, initialDialogState } from "../src/dialog/dialog-engine.js";
import type { DialogTree, DialogState } from "../src/types.js";

// ── Fixtures: AI Engineer World's Fair conference guide ───────────────────────

/**
 * greet → (on "hello/hi/hey") → respond → transition to schedule
 * schedule → (on "schedule/talk/session/when") → respond → transition to farewell
 * farewell → (on "thanks/bye/goodbye") → respond → no transition (stays)
 * fallback → (no trigger, fallback: true) → catch-all
 */
const CONFERENCE_TREE: DialogTree = {
  rootId: "greet",
  fallbackId: "fallback",
  nodes: new Map([
    [
      "greet",
      {
        id: "greet",
        triggerConditions: ["hello", "hi", "hey"],
        responses: ["Welcome to the AI Engineer World's Fair! What brings you here?"],
        transition: "schedule",
      },
    ],
    [
      "schedule",
      {
        id: "schedule",
        triggerConditions: ["schedule", "talk", "session", "when"],
        responses: ["Keynotes start at 9am in Hall A. Workshops run all day in Hall B."],
        transition: "farewell",
      },
    ],
    [
      "farewell",
      {
        id: "farewell",
        triggerConditions: ["thanks", "bye", "goodbye"],
        responses: ["Enjoy the Fair!", "See you around!"],
      },
    ],
    [
      "fallback",
      {
        id: "fallback",
        triggerConditions: [],
        responses: ["I'm just a guide bot — try asking about the schedule!"],
        fallback: true,
      },
    ],
  ]),
};

function freshState(): DialogState {
  return initialDialogState(CONFERENCE_TREE);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateDialog — trigger matching", () => {
  it("matches a greeting trigger case-insensitively", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "Hello there!");
    expect(result.response).toBe("Welcome to the AI Engineer World's Fair! What brings you here?");
  });

  it("matches using substring (not exact word)", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "when does the schedule start?");
    expect(result.response).toBe(
      "Keynotes start at 9am in Hall A. Workshops run all day in Hall B.",
    );
  });

  it("fires fallback when no trigger matches", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "Where is the nearest coffee?");
    expect(result.response).toBe(
      "I'm just a guide bot — try asking about the schedule!",
    );
  });

  it("trigger match is case-insensitive", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "BYE BYE");
    expect(result.response).toMatch(/Enjoy|See you/);
  });
});

describe("evaluateDialog — response selection", () => {
  it("returns a response from the matching node's responses array", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "bye");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(result.response);
  });

  it("always returns one of the listed responses (100 trials)", () => {
    const allowed = ["Enjoy the Fair!", "See you around!"];
    for (let i = 0; i < 100; i++) {
      const r = evaluateDialog(CONFERENCE_TREE, freshState(), "bye");
      expect(allowed).toContain(r.response);
    }
  });

  it("fallback response is returned when no trigger matched", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "xyzzy");
    expect(result.response).toBe(
      "I'm just a guide bot — try asking about the schedule!",
    );
  });
});

describe("evaluateDialog — state transitions", () => {
  it("advances state to the transition target after a match", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "hello");
    expect(result.nextNodeId).toBe("schedule");
  });

  it("stays at the matched node when no transition is defined", () => {
    const state: DialogState = { currentNodeId: "farewell", lastUpdated: "" };
    const result = evaluateDialog(CONFERENCE_TREE, state, "bye");
    expect(result.nextNodeId).toBe("farewell");
  });

  it("fallback node stays at fallback (no transition)", () => {
    const result = evaluateDialog(CONFERENCE_TREE, freshState(), "xyzzy");
    expect(result.nextNodeId).toBe("fallback");
  });
});

describe("evaluateDialog — two partners track independent state", () => {
  it("state for partner-A does not affect partner-B", () => {
    const stateA: DialogState = { currentNodeId: "greet", lastUpdated: "" };
    const stateB: DialogState = { currentNodeId: "greet", lastUpdated: "" };

    // Partner A says hello → advances A's state to schedule
    const resultA = evaluateDialog(CONFERENCE_TREE, stateA, "hello");
    expect(resultA.nextNodeId).toBe("schedule");

    // Partner B's state is unchanged — still at greet
    expect(stateB.currentNodeId).toBe("greet");

    // Partner B also says hello → still matches greet
    const resultB = evaluateDialog(CONFERENCE_TREE, stateB, "hi");
    expect(resultB.response).toBe(
      "Welcome to the AI Engineer World's Fair! What brings you here?",
    );
  });
});

describe("evaluateDialog — multi-turn conversation", () => {
  it("follows greet → schedule → farewell over three turns", () => {
    let state = freshState();

    const r1 = evaluateDialog(CONFERENCE_TREE, state, "hi");
    expect(r1.response).toBe(
      "Welcome to the AI Engineer World's Fair! What brings you here?",
    );
    state = { currentNodeId: r1.nextNodeId, lastUpdated: "" };

    const r2 = evaluateDialog(CONFERENCE_TREE, state, "what sessions are on?");
    expect(r2.response).toBe(
      "Keynotes start at 9am in Hall A. Workshops run all day in Hall B.",
    );
    state = { currentNodeId: r2.nextNodeId, lastUpdated: "" };

    const r3 = evaluateDialog(CONFERENCE_TREE, state, "thanks!");
    expect(["Enjoy the Fair!", "See you around!"]).toContain(r3.response);
  });
});

describe("evaluateDialog — cycle guard", () => {
  it("does not follow a self-referential transition into an infinite loop", () => {
    const selfLoopTree: DialogTree = {
      rootId: "loop",
      fallbackId: "fallback",
      nodes: new Map([
        [
          "loop",
          {
            id: "loop",
            triggerConditions: ["ping"],
            responses: ["pong"],
            transition: "loop", // self-loop
          },
        ],
        [
          "fallback",
          { id: "fallback", triggerConditions: [], responses: ["?"], fallback: true },
        ],
      ]),
    };
    const state: DialogState = { currentNodeId: "loop", lastUpdated: "" };
    const result = evaluateDialog(selfLoopTree, state, "ping");
    // Self-loop is guarded; nextNodeId stays at the responding node, not cycling
    expect(result.nextNodeId).toBe("loop");
    expect(result.response).toBe("pong");
  });
});

describe("initialDialogState", () => {
  it("initializes at the tree's rootId", () => {
    const state = initialDialogState(CONFERENCE_TREE);
    expect(state.currentNodeId).toBe("greet");
    expect(state.lastUpdated).toBeTruthy();
  });
});
