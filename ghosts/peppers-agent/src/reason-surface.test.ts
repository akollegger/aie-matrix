import { describe, expect, it } from "vitest";
import { formatStimulus, parseAction } from "./reason-surface.js";

// ---------------------------------------------------------------------------
// parseAction
// ---------------------------------------------------------------------------

describe("parseAction", () => {
  describe("valid actions", () => {
    it("parses say", () => {
      expect(parseAction({ kind: "say", text: "hello" })).toEqual({ kind: "say", text: "hello" });
    });

    it("parses go", () => {
      expect(parseAction({ kind: "go", toward: "n" })).toEqual({ kind: "go", toward: "n" });
    });

    it("parses take", () => {
      expect(parseAction({ kind: "take", itemRef: "badge-42" })).toEqual({
        kind: "take",
        itemRef: "badge-42",
      });
    });

    it("parses drop", () => {
      expect(parseAction({ kind: "drop", itemRef: "badge-42" })).toEqual({
        kind: "drop",
        itemRef: "badge-42",
      });
    });

    it("parses inspect", () => {
      expect(parseAction({ kind: "inspect", itemRef: "badge-42" })).toEqual({
        kind: "inspect",
        itemRef: "badge-42",
      });
    });

    it("parses look here", () => {
      expect(parseAction({ kind: "look", at: "here" })).toEqual({ kind: "look", at: "here" });
    });

    it("parses look around", () => {
      expect(parseAction({ kind: "look", at: "around" })).toEqual({ kind: "look", at: "around" });
    });

    it.each(["exits", "inventory", "whoami", "whereami", "bye"] as const)(
      "parses %s (no-arg action)",
      (kind) => {
        expect(parseAction({ kind })).toEqual({ kind });
      },
    );
  });

  describe("invalid inputs", () => {
    it("throws on null", () => {
      expect(() => parseAction(null)).toThrow(/must be an object/);
    });

    it("throws on primitive", () => {
      expect(() => parseAction("say")).toThrow(/must be an object/);
    });

    it("throws on unknown kind", () => {
      expect(() => parseAction({ kind: "fly" })).toThrow(/unknown action kind/);
    });

    it("throws on missing kind", () => {
      expect(() => parseAction({})).toThrow(/unknown action kind/);
    });

    it("throws on missing text for say", () => {
      expect(() => parseAction({ kind: "say" })).toThrow(/text/);
    });

    it("throws on empty text for say", () => {
      expect(() => parseAction({ kind: "say", text: "" })).toThrow(/text/);
    });

    it("throws on missing toward for go", () => {
      expect(() => parseAction({ kind: "go" })).toThrow(/toward/);
    });

    it("throws on missing itemRef for take", () => {
      expect(() => parseAction({ kind: "take" })).toThrow(/itemRef/);
    });

    it("throws on missing itemRef for drop", () => {
      expect(() => parseAction({ kind: "drop" })).toThrow(/itemRef/);
    });

    it("throws on missing itemRef for inspect", () => {
      expect(() => parseAction({ kind: "inspect" })).toThrow(/itemRef/);
    });

    it('throws on look.at neither "here" nor "around"', () => {
      expect(() => parseAction({ kind: "look", at: "everywhere" })).toThrow(/here.*around|around.*here/i);
    });

    it("throws on missing look.at", () => {
      expect(() => parseAction({ kind: "look" })).toThrow(/at/);
    });
  });
});

// ---------------------------------------------------------------------------
// formatStimulus
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
    // Math.round(1.4) = 1, Math.round(1.5) = 2
    expect(formatStimulus({ kind: "idle", quietForMs: 1400 })).toContain("1s");
    expect(formatStimulus({ kind: "idle", quietForMs: 1500 })).toContain("2s");
  });
});
