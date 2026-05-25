import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { loadHexMap, MapLoadError } from "./mapLoader.js";

const CANONICAL_GRAM_PATH = fileURLToPath(new URL("../../../maps/sandbox/canonical.map.gram", import.meta.url));

test("loadHexMap loads canonical.map.gram with cells and portals", async () => {
  const map = await loadHexMap(CANONICAL_GRAM_PATH);
  assert.ok(map.cells.size > 0, "expected non-empty cells");
  let hasFloor = false;
  for (const rec of map.cells.values()) {
    if (rec.tileClass === "Floor") { hasFloor = true; break; }
  }
  assert.ok(hasFloor, "expected at least one Floor cell");
  assert.ok(Array.isArray(map.portals) && map.portals.length > 0, "expected portals");
  assert.equal(map.portals?.[0]?.fromCell, "8f2800000000195");
});

test("loadHexMap gram: item BrassKey is in initialItemRefs and itemSidecar", async () => {
  const map = await loadHexMap(CANONICAL_GRAM_PATH);
  let foundItemCell = false;
  for (const rec of map.cells.values()) {
    if (rec.initialItemRefs.includes("BrassKey")) { foundItemCell = true; break; }
  }
  assert.ok(foundItemCell, "expected BrassKey in initialItemRefs");
  assert.ok(map.itemSidecar.has("BrassKey"), "expected BrassKey in itemSidecar");
  assert.equal(map.itemSidecar.get("BrassKey")?.glyph, "🔑");
});

test("loadHexMap throws MapLoadError for non-existent file", async () => {
  await assert.rejects(
    () => loadHexMap("/nonexistent/path/missing.map.gram"),
    (e: unknown) => {
      assert.ok(e instanceof MapLoadError || (e instanceof Error && e.message.includes("ENOENT")));
      return true;
    },
  );
});
