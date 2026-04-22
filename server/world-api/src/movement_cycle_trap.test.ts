import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCellId, type LoadedMap } from "@aie-matrix/server-colyseus";
import { Effect } from "effect";
import { evaluateGo } from "./movement.js";
import { authoredRuleset } from "./rules/movement-rules-service.js";
import { parseGramRulesFile } from "./rules/gram-rules.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "rules", "fixtures");

/**
 * Four tiles in a row: Green — Red — Blue — End
 * Blue also connects back to Green to form the cycle.
 *
 *   g --ne--> r --ne--> b --ne--> end
 *             ^         |
 *             \---nw----/  (cycle back)
 */
function cycleWithTrapMap(): LoadedMap {
  const g = makeCellId(0, 0);
  const r = makeCellId(1, 0);
  const b = makeCellId(2, 0);
  const end = makeCellId(3, 0);
  return {
    width: 4,
    height: 1,
    anchorH3: "test-anchor",
    cells: new Map([
      [g,   { col: 0, row: 0, h3Index: g, tileClass: "Green", initialItemRefs: [], neighbors: { ne: r } }],
      [r,   { col: 1, row: 0, h3Index: r, tileClass: "Red",   initialItemRefs: [], neighbors: { sw: g, ne: b } }],
      [b,   { col: 2, row: 0, h3Index: b, tileClass: "Blue",  initialItemRefs: [], neighbors: { sw: r, nw: g, ne: end } }],
      [end, { col: 3, row: 0, h3Index: end, tileClass: "End",  initialItemRefs: [], neighbors: { sw: b } }],
    ]),
    itemSidecar: new Map(),
  };
}

describe("cycle-with-trap rules", () => {
  it("permits the full Green→Red→Blue→Green cycle", async () => {
    const path = join(fixtureDir, "cycle-with-trap.rules.gram");
    const rules = authoredRuleset(await Effect.runPromise(parseGramRulesFile(path)));
    const map = cycleWithTrapMap();
    const g = makeCellId(0, 0);
    const r = makeCellId(1, 0);
    const b = makeCellId(2, 0);

    const s1 = evaluateGo(map, g, "ne", rules);
    assert.equal(s1.ok, true, "Green→Red should be permitted");
    if (s1.ok) assert.equal(s1.tileId, r);

    const s2 = evaluateGo(map, r, "ne", rules);
    assert.equal(s2.ok, true, "Red→Blue should be permitted");
    if (s2.ok) assert.equal(s2.tileId, b);

    const s3 = evaluateGo(map, b, "nw", rules);
    assert.equal(s3.ok, true, "Blue→Green should be permitted");
    if (s3.ok) assert.equal(s3.tileId, g);
  });

  it("permits Blue→End and then denies any move from End", async () => {
    const path = join(fixtureDir, "cycle-with-trap.rules.gram");
    const rules = authoredRuleset(await Effect.runPromise(parseGramRulesFile(path)));
    const map = cycleWithTrapMap();
    const b = makeCellId(2, 0);
    const end = makeCellId(3, 0);

    const enter = evaluateGo(map, b, "ne", rules);
    assert.equal(enter.ok, true, "Blue→End should be permitted");
    if (enter.ok) assert.equal(enter.tileId, end);

    const escape = evaluateGo(map, end, "sw", rules);
    assert.equal(escape.ok, false, "End→Blue should be denied (trap)");
    if (!escape.ok) assert.equal(escape.code, "RULESET_DENY");
  });

  it("denies reverse traversal of the cycle", async () => {
    const path = join(fixtureDir, "cycle-with-trap.rules.gram");
    const rules = authoredRuleset(await Effect.runPromise(parseGramRulesFile(path)));
    const map = cycleWithTrapMap();
    const g = makeCellId(0, 0);
    const r = makeCellId(1, 0);
    const b = makeCellId(2, 0);

    const s1 = evaluateGo(map, r, "sw", rules);
    assert.equal(s1.ok, false, "Red→Green should be denied");
    if (!s1.ok) assert.equal(s1.code, "RULESET_DENY");

    const s2 = evaluateGo(map, b, "sw", rules);
    assert.equal(s2.ok, false, "Blue→Red should be denied");
    if (!s2.ok) assert.equal(s2.code, "RULESET_DENY");

    const s3 = evaluateGo(map, g, "ne", rules);
    assert.equal(s3.ok, true, "Green→Red is still permitted forward");
  });
});
