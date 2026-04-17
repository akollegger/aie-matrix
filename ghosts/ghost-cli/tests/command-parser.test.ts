import { describe, expect, it } from "vitest";

import { parseReplCommand } from "../src/repl/repl-state.js";

describe("parseReplCommand", () => {
  it("parses vocabulary commands", () => {
    expect(parseReplCommand("whoami")).toEqual({ _tag: "whoami" });
    expect(parseReplCommand("whereami")).toEqual({ _tag: "whereami" });
    expect(parseReplCommand("exits")).toEqual({ _tag: "exits" });
    expect(parseReplCommand("help")).toEqual({ _tag: "help" });
    expect(parseReplCommand("exit")).toEqual({ _tag: "exit" });
    expect(parseReplCommand("quit")).toEqual({ _tag: "exit" });
  });

  it("parses look variants", () => {
    expect(parseReplCommand("look")).toEqual({ _tag: "look", at: "here" });
    expect(parseReplCommand("look here")).toEqual({ _tag: "look", at: "here" });
    expect(parseReplCommand("look around")).toEqual({ _tag: "look", at: "around" });
    expect(parseReplCommand("look ne")).toEqual({ _tag: "look", at: "ne" });
  });

  it("parses go with a face", () => {
    expect(parseReplCommand("go nw")).toEqual({ _tag: "go", toward: "nw" });
  });

  it("returns unknown for invalid face on go", () => {
    const r = parseReplCommand("go zz");
    expect(r).toEqual({ _tag: "unknown", raw: "go zz" });
  });

  it("returns unknown for empty input", () => {
    expect(parseReplCommand("")).toEqual({ _tag: "unknown", raw: "" });
    expect(parseReplCommand("   ")).toEqual({ _tag: "unknown", raw: "" });
  });
});
