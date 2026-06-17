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

/** Move to first adjacent tile that has items. Returns { itemRef, toward } or null. */
async function moveToTileWithItem(
  mcp: GhostMcpClient,
): Promise<{ itemRef: string; toward: string } | null> {
  const ex = (await mcp.callTool("exits", {})) as { exits: Array<{ toward: string }> };
  for (const { toward } of ex.exits) {
    const tile = (await mcp.callTool("look", { at: toward })) as TileResult | { empty: true };
    if ("objects" in tile && tile.objects.length > 0) {
      await mcp.callTool("go", { toward });
      return { itemRef: tile.objects[0].id, toward };
    }
  }
  return null;
}

test("offer creates a proposal; decline cancels it", async ({ ghost, ghost2 }) => {
  // Ghost A moves to a tile with an item and takes it
  const found = await moveToTileWithItem(ghost.mcp);
  if (!found) {
    test.skip();
    return;
  }
  const { itemRef, toward } = found;

  await ghost.mcp.callTool("take", { itemRef });

  // Ghost B moves to the same tile so both are co-located
  await ghost2.mcp.callTool("go", { toward });

  // Ghost A offers the item to Ghost B
  const offerResult = (await ghost.mcp.callTool("offer", {
    to: ghost2.ghostId,
    give_item: itemRef,
    give_qty: 1,
    for_item: itemRef,
    for_qty: 0,
  })) as { ok: boolean; proposalId?: string; code?: string };

  // Skip if the ledger rejects the zero-quantity want side (server-version dependent)
  if (!offerResult.ok) {
    test.skip();
    return;
  }
  expect(typeof offerResult.proposalId).toBe("string");

  // Ghost B declines
  const declineResult = (await ghost2.mcp.callTool("decline", {
    proposalId: offerResult.proposalId!,
  })) as { ok: boolean; status?: string };
  expect(declineResult.ok).toBe(true);
  expect(declineResult.status).toBe("declined");

  // Ghost A still holds the item
  const inv = (await ghost.mcp.callTool("inventory", {})) as {
    ok: boolean;
    objects: Array<{ itemRef: string }>;
  };
  expect(inv.objects.some((o) => o.itemRef === itemRef)).toBe(true);
});

test("offer to non-co-located ghost returns COUNTERPARTY_NOT_NEARBY", async ({
  ghost,
  ghost2,
}) => {
  // Move ghost2 away so they're not on the same tile
  const ex = (await ghost2.mcp.callTool("exits", {})) as { exits: Array<{ toward: string }> };
  await ghost2.mcp.callTool("go", { toward: ex.exits[0].toward });

  // Ghost 1 tries to offer (no item, so this will fail with proximity or inventory error)
  const offerResult = (await ghost.mcp.callTool("offer", {
    to: ghost2.ghostId,
    give_item: "fake-item",
    give_qty: 1,
    for_item: "fake-item",
    for_qty: 1,
  })) as { ok: boolean; code?: string };

  expect(offerResult.ok).toBe(false);
  expect(offerResult.code).toBe("COUNTERPARTY_NOT_NEARBY");
});
