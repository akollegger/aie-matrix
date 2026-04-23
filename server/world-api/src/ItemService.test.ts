import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { ItemDefinition } from "@aie-matrix/shared-types";
import type { LoadedMap } from "@aie-matrix/server-colyseus";
import { ItemServiceImpl } from "./ItemService.js";

function makeLoadedMap(
  cells: Array<{ h3Index: string; itemRefs?: string[]; capacity?: number }>,
  sidecar: Record<string, ItemDefinition>,
): LoadedMap {
  const itemSidecar = new Map(Object.entries(sidecar));
  const cellMap = new Map(
    cells.map((c) => [
      c.h3Index,
      {
        col: 0,
        row: 0,
        h3Index: c.h3Index,
        tileClass: "Test",
        initialItemRefs: c.itemRefs ?? [],
        capacity: c.capacity,
        neighbors: {},
      },
    ]),
  );
  return {
    width: 1,
    height: cells.length,
    anchorH3: "test",
    cells: cellMap,
    itemSidecar,
  };
}

const KEY_DEF: ItemDefinition = {
  name: "Brass Key",
  itemClass: "Key",
  carriable: true,
  capacityCost: 0,
};

const SIGN_DEF: ItemDefinition = {
  name: "Welcome Sign",
  itemClass: "Sign",
  carriable: false,
  capacityCost: 0,
};

const STATUE_DEF: ItemDefinition = {
  name: "Stone Statue",
  itemClass: "Obstacle",
  carriable: false,
  capacityCost: 1,
};

test("ItemService seeds tileItems from LoadedMap initialItemRefs", () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  assert.deepEqual(svc.getItemsOnTile("tile-A"), ["key-brass"]);
  assert.deepEqual(svc.getItemsOnTile("tile-B"), []);
});

test("takeItem moves ref from tile to ghost inventory", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  const result = await Effect.runPromise(svc.takeItem("ghost-1", "tile-A", "key-brass"));
  assert.equal(result.name, "Brass Key");
  assert.deepEqual(svc.getItemsOnTile("tile-A"), []);
  assert.deepEqual(svc.getGhostInventory("ghost-1"), ["key-brass"]);
});

test("dropItem moves ref from ghost inventory to tile", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }, { h3Index: "tile-B" }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  await Effect.runPromise(svc.takeItem("ghost-1", "tile-A", "key-brass"));
  await Effect.runPromise(svc.dropItem("ghost-1", "tile-B", "key-brass", undefined, 1));
  assert.deepEqual(svc.getItemsOnTile("tile-B"), ["key-brass"]);
  assert.deepEqual(svc.getGhostInventory("ghost-1"), []);
});

test("dropItem respects tile capacity (TILE_FULL)", async () => {
  // carriable statue variant for drop-blocking test
  const carriableStatueDef: ItemDefinition = { ...STATUE_DEF, carriable: true };
  const map = makeLoadedMap(
    [
      { h3Index: "statue-src", itemRefs: ["c-statue"] },
      { h3Index: "tiny", capacity: 1 },
    ],
    { "c-statue": carriableStatueDef },
  );
  const svc = new ItemServiceImpl(map);
  await Effect.runPromise(svc.takeItem("ghost-1", "statue-src", "c-statue"));
  // tiny has capacity 1; ghost counts as 1; dropping c-statue (cost 1): 1+1 > 1 → TILE_FULL
  const err = await Effect.runPromise(
    svc.dropItem("ghost-1", "tiny", "c-statue", 1, 1).pipe(Effect.flip),
  );
  assert.equal(err._tag, "WorldApiError.TileFull");
});

test("dropItem counts all ghosts already on the tile", async () => {
  const carriableStatueDef: ItemDefinition = { ...STATUE_DEF, carriable: true };
  const map = makeLoadedMap(
    [
      { h3Index: "statue-src", itemRefs: ["c-statue"] },
      { h3Index: "crowded", capacity: 2 },
    ],
    { "c-statue": carriableStatueDef },
  );
  const svc = new ItemServiceImpl(map);
  await Effect.runPromise(svc.takeItem("ghost-1", "statue-src", "c-statue"));
  const err = await Effect.runPromise(
    svc.dropItem("ghost-1", "crowded", "c-statue", 2, 2).pipe(Effect.flip),
  );
  assert.equal(err._tag, "WorldApiError.TileFull");
});

test("double-take of same item returns ItemNotHere on second attempt", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  await Effect.runPromise(svc.takeItem("ghost-1", "tile-A", "key-brass"));
  const err = await Effect.runPromise(
    svc.takeItem("ghost-1", "tile-A", "key-brass").pipe(Effect.flip),
  );
  assert.equal(err._tag, "WorldApiError.ItemNotHere");
});

test("take non-carriable item returns ItemNotCarriable", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["sign-welcome"] }],
    { "sign-welcome": SIGN_DEF },
  );
  const svc = new ItemServiceImpl(map);
  const err = await Effect.runPromise(
    svc.takeItem("ghost-1", "tile-A", "sign-welcome").pipe(Effect.flip),
  );
  assert.equal(err._tag, "WorldApiError.ItemNotCarriable");
});

test("inspect returns name and description when item is on tile", async () => {
  const def: ItemDefinition = { ...KEY_DEF, description: "A shiny key." };
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": def },
  );
  const svc = new ItemServiceImpl(map);
  const result = await Effect.runPromise(svc.inspectItem("tile-A", "key-brass"));
  assert.equal(result.name, "Brass Key");
  assert.equal(result.description, "A shiny key.");
});

test("inspect returns ItemNotHere when item not on current tile", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }, { h3Index: "tile-B" }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  const err = await Effect.runPromise(
    svc.inspectItem("tile-B", "key-brass").pipe(Effect.flip),
  );
  assert.equal(err._tag, "WorldApiError.ItemNotHere");
});

test("ghost inventory is empty on creation", () => {
  const map = makeLoadedMap([], {});
  const svc = new ItemServiceImpl(map);
  assert.deepEqual(svc.getGhostInventory("ghost-unknown"), []);
});
