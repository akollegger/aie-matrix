import { test, expect } from "./fixtures.js";
import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

interface TileItem {
  id: string;
  name: string;
}

interface TileResult {
  tileId: string;
  objects: TileItem[];
}

/** Navigate to the first adjacent tile that has items. Returns the itemRef, or null if none found. */
async function moveToTileWithItem(mcp: GhostMcpClient): Promise<string | null> {
  const ex = (await mcp.callTool("exits", {})) as { exits: Array<{ toward: string }> };
  for (const { toward } of ex.exits) {
    const tile = (await mcp.callTool("look", { at: toward })) as TileResult | { empty: true };
    if ("objects" in tile && tile.objects.length > 0) {
      await mcp.callTool("go", { toward });
      return tile.objects[0].id;
    }
  }
  return null;
}

test("look here returns a tile result with objects array", async ({ ghost }) => {
  const tile = (await ghost.mcp.callTool("look", { at: "here" })) as TileResult;
  expect(typeof tile.tileId).toBe("string");
  expect(Array.isArray(tile.objects)).toBe(true);
});

test("take moves item into inventory, drop returns it to tile", async ({ ghost }) => {
  const itemRef = await moveToTileWithItem(ghost.mcp);
  if (!itemRef) {
    test.skip();
    return;
  }

  const takeResult = (await ghost.mcp.callTool("take", { itemRef })) as { ok: boolean; name?: string };
  expect(takeResult.ok).toBe(true);

  const inv = (await ghost.mcp.callTool("inventory", {})) as {
    ok: boolean;
    objects: Array<{ itemRef: string; name: string }>;
  };
  expect(inv.ok).toBe(true);
  expect(inv.objects.some((o) => o.itemRef === itemRef)).toBe(true);

  const dropResult = (await ghost.mcp.callTool("drop", { itemRef })) as { ok: boolean };
  expect(dropResult.ok).toBe(true);

  const invAfter = (await ghost.mcp.callTool("inventory", {})) as {
    ok: boolean;
    objects: Array<{ itemRef: string }>;
  };
  expect(invAfter.objects.some((o) => o.itemRef === itemRef)).toBe(false);

  const tileAfter = (await ghost.mcp.callTool("look", { at: "here" })) as TileResult;
  expect(tileAfter.objects.some((o) => o.id === itemRef)).toBe(true);
});

test("taking a nonexistent item returns a structured error", async ({ ghost }) => {
  const result = (await ghost.mcp.callTool("take", { itemRef: "definitely-does-not-exist" })) as {
    ok: boolean;
    code?: string;
  };
  expect(result.ok).toBe(false);
  expect(["NOT_HERE", "NOT_FOUND"]).toContain(result.code);
});
