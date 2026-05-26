import { describe, expect, it } from "vitest";
import type { AvailableActions } from "@aie-matrix/ghost-rdc-poker";

import type { PokerAction, SchoolDecision } from "./school-rules.js";
import { pruneByTier } from "./tier-pruner.js";

function fullMenu(): AvailableActions {
  return {
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    canAllIn: true,
    callAmount: 2,
    minRaise: 4,
    maxRaise: 100,
    allInAmount: 100,
  };
}

function mkDecision(forbidden: PokerAction[]): SchoolDecision {
  return {
    school: "Sklansky",
    recommendation: "call",
    optimalPlay: { action: "call", amount: 2 },
    forbidden: new Set(forbidden),
    reasonLines: [],
  };
}

describe("pruneByTier", () => {
  it("Greenhorn: never prunes, even when school forbids actions", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["fold", "call"]), "Greenhorn");
    expect(r.pruned).toBe(false);
    expect(r.removed).toEqual([]);
    expect(r.actions).toEqual(fullMenu());
  });

  it("Journeyman: never prunes (advice only)", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["fold"]), "Journeyman");
    expect(r.pruned).toBe(false);
    expect(r.actions.canFold).toBe(true);
  });

  it("Veteran: mechanically removes forbidden actions", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["call", "raise"]), "Veteran");
    expect(r.pruned).toBe(true);
    expect([...r.removed].sort()).toEqual(["call", "raise"]);
    expect(r.actions.canCall).toBe(false);
    expect(r.actions.canRaise).toBe(false);
    expect(r.actions.canFold).toBe(true);
  });

  it("Eagle: same pruning behavior as Veteran", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["fold"]), "Eagle");
    expect(r.pruned).toBe(true);
    expect(r.removed).toEqual(["fold"]);
    expect(r.actions.canFold).toBe(false);
    expect(r.actions.canCall).toBe(true);
  });

  it("empty forbidden set: no-op even at Veteran", () => {
    const r = pruneByTier(fullMenu(), mkDecision([]), "Veteran");
    expect(r.pruned).toBe(false);
    expect(r.removed).toEqual([]);
  });

  it("school tries to forbid an already-illegal action: no-op (idempotent)", () => {
    // No canCheck on this menu — forbidding check should not register
    // as 'removed' since check wasn't legal to begin with.
    const r = pruneByTier(fullMenu(), mkDecision(["check"]), "Veteran");
    expect(r.removed).toEqual([]);
  });

  it("safety: if school would remove the ENTIRE menu, fall back to original (no deadlock)", () => {
    // Forbid every legal action. The pruner must NOT leave the LLM
    // with zero choices — fall back to the original menu and surface
    // pruned=false so the caller can log the degenerate.
    const r = pruneByTier(
      fullMenu(),
      mkDecision(["fold", "check", "call", "raise", "all-in"]),
      "Veteran",
    );
    expect(r.pruned).toBe(false);
    expect(r.actions).toEqual(fullMenu());
  });

  it("undefined tier: treated as legacy (no prune)", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["fold"]), undefined);
    expect(r.pruned).toBe(false);
  });

  it("preserves bet amounts (callAmount, minRaise, maxRaise, allInAmount) under pruning", () => {
    const r = pruneByTier(fullMenu(), mkDecision(["call"]), "Veteran");
    expect(r.actions.callAmount).toBe(2);
    expect(r.actions.minRaise).toBe(4);
    expect(r.actions.maxRaise).toBe(100);
    expect(r.actions.allInAmount).toBe(100);
  });
});

describe("pruneByTier — the user's flagship scenarios", () => {
  it("Veteran Sklansky Mouse with A2o 4-way (equity 30%, req 40%): only fold remains", () => {
    // School verdict: equity 30%, required 40% → margin -10% → forbid call+raise
    const sklanskyVerdict = mkDecision(["call", "raise"]);
    const r = pruneByTier(fullMenu(), sklanskyVerdict, "Veteran");
    expect(r.actions.canFold).toBe(true);
    expect(r.actions.canCall).toBe(false);
    expect(r.actions.canRaise).toBe(false);
    expect(r.actions.canAllIn).toBe(true); // still legal — all-in isn't "call"
  });

  it("Greenhorn Hellmuth Lion with A2o UTG: every option survives", () => {
    // Greenhorn never prunes. Even if Hellmuth said forbid fold (top-10
    // override) and forbid raise (random rigidity), Greenhorn ignores it.
    const verdict = mkDecision(["fold", "raise"]);
    const r = pruneByTier(fullMenu(), verdict, "Greenhorn");
    expect(r.actions).toEqual(fullMenu());
  });
});
