import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { parseGramRulesFile } from "./gram-rules.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("gram-rules", () => {
  it("parses sandbox.rules.gram", async () => {
    const path = join(fixtureDir, "sandbox.rules.gram");
    const patterns = await Effect.runPromise(parseGramRulesFile(path));
    assert.ok(patterns.length > 0);
  });
});
