import { describe, expect, it } from "vitest";

import { isGoStructuredFailure } from "../src/oneshot/commands.js";

describe("one-shot movement result", () => {
  it("detects structured go failure", () => {
    expect(isGoStructuredFailure({ ok: false, code: "NO_NEIGHBOR", reason: "blocked" })).toBe(true);
    expect(isGoStructuredFailure({ ok: true })).toBe(false);
    expect(isGoStructuredFailure(null)).toBe(false);
  });
});
