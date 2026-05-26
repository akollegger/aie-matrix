import { describe, expect, it } from "vitest";
import { formatStimulus } from "./reason-surface.js";

// ---------------------------------------------------------------------------
// formatStimulus
//
// (Tests for the old hand-rolled `parseAction` were removed: tool-call
// parsing is now done by OpenAI's tool-calling API and arrives as
// already-validated `{ name, arguments }`. There's nothing to parse.)
// ---------------------------------------------------------------------------

describe("formatStimulus", () => {
  it("formats utterance", () => {
    const result = formatStimulus({ kind: "utterance", from: "ghost_abc", text: "hello there" });
    expect(result).toBe('ghost_abc says: "hello there"');
  });

  it("formats cluster-entered with one ghost", () => {
    const result = formatStimulus({ kind: "cluster-entered", ghostIds: ["ghost_abc"] });
    expect(result).toContain("ghost_abc");
    expect(result).toContain("entered");
  });

  it("formats cluster-entered with multiple ghosts", () => {
    const result = formatStimulus({
      kind: "cluster-entered",
      ghostIds: ["ghost_abc", "ghost_def"],
    });
    expect(result).toContain("ghost_abc");
    expect(result).toContain("ghost_def");
  });

  it("formats cluster-left", () => {
    const result = formatStimulus({ kind: "cluster-left", ghostIds: ["ghost_abc"] });
    expect(result).toContain("ghost_abc");
    expect(result).toContain("left");
  });

  it("formats mcguffin-in-view", () => {
    const result = formatStimulus({ kind: "mcguffin-in-view", itemRef: "badge-42", at: "here" });
    expect(result).toContain("badge-42");
    expect(result).toContain("here");
  });

  it("formats tile-entered", () => {
    const result = formatStimulus({ kind: "tile-entered", h3Index: "8f2830828052d25", tileClass: "plaza" });
    expect(result).toContain("plaza");
  });

  it("formats idle with rounded seconds", () => {
    const result = formatStimulus({ kind: "idle", quietForMs: 4000 });
    expect(result).toContain("4s");
    expect(result).toContain("quiet");
  });

  it("formats idle rounds to nearest second", () => {
    expect(formatStimulus({ kind: "idle", quietForMs: 1400 })).toContain("1s");
    expect(formatStimulus({ kind: "idle", quietForMs: 1500 })).toContain("2s");
  });

  it("formats utterance with intent tag when present", () => {
    const result = formatStimulus({
      kind: "utterance",
      from: "Sundance Cypher",
      text: "you in?",
      intent: "propose",
    });
    expect(result).toContain("[intent: propose]");
    expect(result).toContain("Sundance Cypher");
    expect(result).toContain('"you in?"');
  });

  it("omits intent tag when not declared (backwards compat)", () => {
    const result = formatStimulus({
      kind: "utterance",
      from: "Sundance Cypher",
      text: "you in?",
    });
    expect(result).not.toContain("[intent:");
    expect(result).toBe('Sundance Cypher says: "you in?"');
  });
});
