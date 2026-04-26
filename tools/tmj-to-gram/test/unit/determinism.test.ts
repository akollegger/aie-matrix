import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGramUtf8 } from "../../src/convert.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const freeplayTmj = join(repoRoot, "maps/sandbox/freeplay.tmj");

describe("determinism", () => {
  it("buildGramUtf8 yields byte-identical UTF-8 for the same TMJ twice", async () => {
    const a = await buildGramUtf8(freeplayTmj);
    const b = await buildGramUtf8(freeplayTmj);
    expect(a).toBe(b);
    expect(Buffer.from(a, "utf8").equals(Buffer.from(b, "utf8"))).toBe(true);
  });
});
