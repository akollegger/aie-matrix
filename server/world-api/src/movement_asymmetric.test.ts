import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeCellId, type LoadedMap } from "@aie-matrix/server-colyseus";
import { Effect } from "effect";
import { evaluateGo } from "./movement.js";
import { authoredRuleset } from "./rules/movement-rules-service.js";
import { parseGramRulesFile } from "./rules/gram-rules.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "rules", "fixtures");

/** Linear Red — Blue — Blue with a return edge from last Blue to Red for the denied step. */
function asymmetricMap(): LoadedMap {
  const r = makeCellId(0, 0);
  const b1 = makeCellId(1, 0);
  const b2 = makeCellId(2, 0);
  return {
    width: 3,
    height: 1,
    anchorH3: "test-anchor",
    cells: new Map([
      [r, { col: 0, row: 0, h3Index: r, tileClass: "Red", neighbors: { ne: b1 } }],
      [
        b1,
        {
          col: 1,
          row: 0,
          h3Index: b1,
          tileClass: "Blue",
          neighbors: { sw: r, ne: b2 },
        },
      ],
      [
        b2,
        {
          col: 2,
          row: 0,
          h3Index: b2,
          tileClass: "Blue",
          neighbors: { sw: b1, nw: r },
        },
      ],
    ]),
  };
}

describe("asymmetric demo rules", () => {
  it("allows A->B and B->B but denies B->A", async () => {
    const path = join(fixtureDir, "demo-asymmetric.rules.gram");
    const rules = authoredRuleset(await Effect.runPromise(parseGramRulesFile(path)));
    const map = asymmetricMap();
    const r = makeCellId(0, 0);
    const b1 = makeCellId(1, 0);
    const b2 = makeCellId(2, 0);

    const s1 = evaluateGo(map, r, "ne", rules);
    assert.equal(s1.ok, true);
    if (!s1.ok) {
      return;
    }
    assert.equal(s1.tileId, b1);

    const s2 = evaluateGo(map, b1, "ne", rules);
    assert.equal(s2.ok, true);
    if (!s2.ok) {
      return;
    }
    assert.equal(s2.tileId, b2);

    const s3 = evaluateGo(map, b2, "nw", rules);
    assert.equal(s3.ok, false);
    if (!s3.ok) {
      assert.equal(s3.code, "RULESET_DENY");
    }
  });
});
