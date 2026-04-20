import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeCellId, type LoadedMap } from "@aie-matrix/server-colyseus";
import { Effect } from "effect";
import { evaluateGo } from "./movement.js";
import { authoredRuleset, permissiveRuleset } from "./rules/movement-rules-service.js";
import { parseGramRulesFile } from "./rules/gram-rules.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "rules", "fixtures");

function redBlueMap(): LoadedMap {
  const r = makeCellId(0, 0);
  const b = makeCellId(1, 0);
  return {
    width: 2,
    height: 1,
    anchorH3: "test-anchor",
    cells: new Map([
      [r, { col: 0, row: 0, h3Index: r, tileClass: "Red", neighbors: { ne: b } }],
      [b, { col: 1, row: 0, h3Index: b, tileClass: "Blue", neighbors: { sw: r } }],
    ]),
  };
}

describe("evaluateGo with authored rules", () => {
  it("permits Red->Blue when a GO rule exists", async () => {
    const path = join(fixtureDir, "sandbox.rules.gram");
    const patterns = await Effect.runPromise(parseGramRulesFile(path));
    const rules = authoredRuleset(patterns);
    const map = redBlueMap();
    const r = makeCellId(0, 0);
    const out = evaluateGo(map, r, "ne", rules);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.tileId, makeCellId(1, 0));
    }
  });

  it("denies Red->Blue when rules only allow Blue->Blue", async () => {
    const path = join(fixtureDir, "restrictive.rules.gram");
    const patterns = await Effect.runPromise(parseGramRulesFile(path));
    const rules = authoredRuleset(patterns);
    const map = redBlueMap();
    const r = makeCellId(0, 0);
    const out = evaluateGo(map, r, "ne", rules);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.code, "RULESET_DENY");
      assert.ok(out.reason.length > 0);
    }
  });

  it("permissive mode allows geometrically valid steps", () => {
    const map = redBlueMap();
    const r = makeCellId(0, 0);
    const out = evaluateGo(map, r, "ne", permissiveRuleset());
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.tileId, makeCellId(1, 0));
    }
  });
});
