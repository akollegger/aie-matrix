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

function redBlueMap(): LoadedMap {
  const r = makeCellId(0, 0);
  const b = makeCellId(1, 0);
  return {
    width: 2,
    height: 1,
    anchorH3: "test-anchor",
    cells: new Map([
      [r, { col: 0, row: 0, h3Index: r, tileClass: "Red", initialItemRefs: [], neighbors: { ne: b } }],
      [b, { col: 1, row: 0, h3Index: b, tileClass: "Blue", initialItemRefs: [], neighbors: { sw: r } }],
    ]),
    itemSidecar: new Map(),
  };
}

describe("rules mode switch (same map)", () => {
  it("permits Red->Blue under sandbox but denies under restrictive", async () => {
    const map = redBlueMap();
    const r = makeCellId(0, 0);
    const sandbox = authoredRuleset(
      await Effect.runPromise(parseGramRulesFile(join(fixtureDir, "sandbox.rules.gram"))),
    );
    const restrictive = authoredRuleset(
      await Effect.runPromise(parseGramRulesFile(join(fixtureDir, "restrictive.rules.gram"))),
    );
    assert.equal(evaluateGo(map, r, "ne", sandbox).ok, true);
    assert.equal(evaluateGo(map, r, "ne", restrictive).ok, false);
  });
});
