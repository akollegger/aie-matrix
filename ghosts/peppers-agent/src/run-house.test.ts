import { describe, expect, it } from "vitest";
import {
  SOCIAL_ANCHOR_DURATION,
  nextConversationalState,
  type ConversationalState,
} from "./run-house.js";

const neutral: ConversationalState = {
  inConversationalMode: false,
  turnsSinceLastSayWithNoReply: 0,
  socialAnchorTurnsLeft: 0,
};

const inConversation: ConversationalState = {
  inConversationalMode: true,
  turnsSinceLastSayWithNoReply: 0,
  socialAnchorTurnsLeft: 0,
};

const idle = { kind: "idle" as const, quietForMs: 3000 };
const utterance = { kind: "utterance" as const, from: "ghost_abc", text: "hi" };
const sayOk = { action: { kind: "say" as const, text: "hello" }, outcome: { ok: true as const } };
const sayDenied = { action: { kind: "say" as const, text: "hello" }, outcome: { ok: false as const, code: "DENIED" } };
const byeOk = { action: { kind: "bye" as const }, outcome: { ok: true as const } };
const byeDenied = { action: { kind: "bye" as const }, outcome: { ok: false as const, code: "DENIED" } };
const goInConversation = { action: { kind: "go" as const, toward: "n" }, outcome: { ok: false as const, code: "IN_CONVERSATION" } };
const goOk = { action: { kind: "go" as const, toward: "n" }, outcome: { ok: true as const } };

// ---------------------------------------------------------------------------
// Conversational mode
// ---------------------------------------------------------------------------

describe("nextConversationalState — conversational mode", () => {
  it("say ok → enters conversational mode", () => {
    const next = nextConversationalState(neutral, sayOk.action, sayOk.outcome, idle);
    expect(next.inConversationalMode).toBe(true);
  });

  it("say denied → mode unchanged", () => {
    const next = nextConversationalState(neutral, sayDenied.action, sayDenied.outcome, idle);
    expect(next.inConversationalMode).toBe(false);
  });

  it("bye ok → exits conversational mode", () => {
    const next = nextConversationalState(inConversation, byeOk.action, byeOk.outcome, idle);
    expect(next.inConversationalMode).toBe(false);
  });

  it("bye denied → mode unchanged", () => {
    const next = nextConversationalState(inConversation, byeDenied.action, byeDenied.outcome, idle);
    expect(next.inConversationalMode).toBe(true);
  });

  it("IN_CONVERSATION denial → enters conversational mode even if mode was off", () => {
    const next = nextConversationalState(neutral, goInConversation.action, goInConversation.outcome, idle);
    expect(next.inConversationalMode).toBe(true);
  });

  it("successful go → mode unchanged", () => {
    const next = nextConversationalState(neutral, goOk.action, goOk.outcome, idle);
    expect(next.inConversationalMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Turns since last say
// ---------------------------------------------------------------------------

describe("nextConversationalState — turns since last say", () => {
  it("say ok → resets to 0", () => {
    const prev: ConversationalState = { ...inConversation, turnsSinceLastSayWithNoReply: 2 };
    const next = nextConversationalState(prev, sayOk.action, sayOk.outcome, idle);
    expect(next.turnsSinceLastSayWithNoReply).toBe(0);
  });

  it("bye ok → resets to 0", () => {
    const prev: ConversationalState = { ...inConversation, turnsSinceLastSayWithNoReply: 2 };
    const next = nextConversationalState(prev, byeOk.action, byeOk.outcome, idle);
    expect(next.turnsSinceLastSayWithNoReply).toBe(0);
  });

  it("incoming utterance → resets to 0", () => {
    const prev: ConversationalState = { ...inConversation, turnsSinceLastSayWithNoReply: 2 };
    // utterance stimulus takes priority over action in its branch
    const next = nextConversationalState(prev, goOk.action, goOk.outcome, utterance);
    expect(next.turnsSinceLastSayWithNoReply).toBe(0);
  });

  it("silent turn while in conversation → increments", () => {
    const prev: ConversationalState = { ...inConversation, turnsSinceLastSayWithNoReply: 1 };
    const next = nextConversationalState(prev, goOk.action, goOk.outcome, idle);
    expect(next.turnsSinceLastSayWithNoReply).toBe(2);
  });

  it("silent turn while NOT in conversation → does not increment", () => {
    const prev: ConversationalState = { ...neutral, turnsSinceLastSayWithNoReply: 0 };
    const next = nextConversationalState(prev, goOk.action, goOk.outcome, idle);
    expect(next.turnsSinceLastSayWithNoReply).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Social anchor
// ---------------------------------------------------------------------------

describe("nextConversationalState — social anchor", () => {
  it("anchor ticks down by 1 each cascade", () => {
    const prev: ConversationalState = { ...neutral, socialAnchorTurnsLeft: 3 };
    const next = nextConversationalState(prev, goOk.action, goOk.outcome, idle);
    expect(next.socialAnchorTurnsLeft).toBe(2);
  });

  it("anchor at 0 stays at 0", () => {
    const next = nextConversationalState(neutral, goOk.action, goOk.outcome, idle);
    expect(next.socialAnchorTurnsLeft).toBe(0);
  });

  it("incoming utterance re-arms anchor to SOCIAL_ANCHOR_DURATION then ticks down once", () => {
    const next = nextConversationalState(neutral, goOk.action, goOk.outcome, utterance);
    expect(next.socialAnchorTurnsLeft).toBe(SOCIAL_ANCHOR_DURATION - 1);
  });

  it("incoming utterance re-arms anchor even when already anchored", () => {
    const prev: ConversationalState = { ...neutral, socialAnchorTurnsLeft: 1 };
    const next = nextConversationalState(prev, goOk.action, goOk.outcome, utterance);
    expect(next.socialAnchorTurnsLeft).toBe(SOCIAL_ANCHOR_DURATION - 1);
  });

  it("say ok ticks anchor down (not re-armed by say)", () => {
    const prev: ConversationalState = { ...neutral, socialAnchorTurnsLeft: 2 };
    const next = nextConversationalState(prev, sayOk.action, sayOk.outcome, idle);
    expect(next.socialAnchorTurnsLeft).toBe(1);
  });

  it("SOCIAL_ANCHOR_DURATION is 4", () => {
    expect(SOCIAL_ANCHOR_DURATION).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("nextConversationalState — immutability", () => {
  it("does not mutate the input state", () => {
    const prev: ConversationalState = {
      inConversationalMode: false,
      turnsSinceLastSayWithNoReply: 0,
      socialAnchorTurnsLeft: 2,
    };
    const snapshot = { ...prev };
    nextConversationalState(prev, goOk.action, goOk.outcome, idle);
    expect(prev).toEqual(snapshot);
  });
});
