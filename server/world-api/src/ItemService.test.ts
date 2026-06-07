import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { ItemTypeDef } from "@aie-matrix/map-gram";
import type { LoadedMap } from "@aie-matrix/server-colyseus";
import { ItemServiceImpl } from "./ItemService.js";
import { LedgerInsufficientFunds } from "./ledger-errors.js";
import type { LedgerServiceOps } from "./LedgerService.js";

function makeLoadedMap(
  cells: Array<{ h3Index: string; itemRefs?: string[]; capacity?: number }>,
  sidecar: Record<string, ItemTypeDef>,
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

const KEY_DEF: ItemTypeDef = {
  identity: "brassKey",
  typeName: "BrassKey",
  name: "Brass Key",
  takeable: true,
  capacityCost: 0,
};

const SIGN_DEF: ItemTypeDef = {
  identity: "welcomeSign",
  typeName: "WelcomeSign",
  name: "Welcome Sign",
  takeable: false,
  capacityCost: 0,
};

const STATUE_DEF: ItemTypeDef = {
  identity: "stoneStatue",
  typeName: "StoneStatue",
  name: "Stone Statue",
  takeable: false,
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
  const carriableStatueDef: ItemTypeDef = { ...STATUE_DEF, takeable: true };
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
  const carriableStatueDef: ItemTypeDef = { ...STATUE_DEF, takeable: true };
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
  const def: ItemTypeDef = { ...KEY_DEF, description: "A shiny key." };
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

// ---------------------------------------------------------------------------
// Ledger integration via setLedger()
// ---------------------------------------------------------------------------

type CommitArg = Parameters<LedgerServiceOps["commit"]>[0];

function makeMockLedger(): LedgerServiceOps & { commits: CommitArg[] } {
  const commits: CommitArg[] = [];
  const mock: LedgerServiceOps & { commits: CommitArg[] } = {
    commits,
    init: () => Effect.void,
    bag: (actorId) => Effect.succeed({ actorId, holdings: [] }),
    quote: () => Effect.die(new Error("not implemented")),
    commit: (tx) => {
      commits.push(tx);
      return Effect.succeed({ ...tx, prevHash: "", hash: "" }) as ReturnType<LedgerServiceOps["commit"]>;
    },
    verify: () => Effect.die(new Error("not implemented")),
  };
  return mock;
}

function makeFailingLedger(): LedgerServiceOps {
  return {
    init: () => Effect.void,
    bag: (actorId) => Effect.succeed({ actorId, holdings: [] }),
    quote: () => Effect.die(new Error("not implemented")),
    commit: () => Effect.fail(new LedgerInsufficientFunds({ actorId: "world@tile-A", resource: "key-brass", required: 1, available: 0 })) as unknown as ReturnType<LedgerServiceOps["commit"]>,
    verify: () => Effect.die(new Error("not implemented")),
  };
}

test("takeItem commits ledger transfer world@h3 → ghost when ledger is set", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  const ledger = makeMockLedger();
  svc.setLedger(ledger);
  await Effect.runPromise(svc.takeItem("ghost-1", "tile-A", "key-brass"));
  assert.equal(ledger.commits.length, 1);
  const t = ledger.commits[0]!.transfers[0]!;
  assert.equal(t.resource, "key-brass");
  assert.equal(t.from, "world@tile-A");
  assert.equal(t.to, "ghost-1");
  assert.equal(t.qty, 1);
});

test("dropItem commits ledger transfer ghost → world@h3 when ledger is set", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }, { h3Index: "tile-B" }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  const ledger = makeMockLedger();
  svc.setLedger(ledger);
  await Effect.runPromise(svc.takeItem("ghost-1", "tile-A", "key-brass"));
  await Effect.runPromise(svc.dropItem("ghost-1", "tile-B", "key-brass", undefined, 1));
  // First commit = take (tile-A), second = drop (tile-B)
  assert.equal(ledger.commits.length, 2);
  const dropTransfer = ledger.commits[1]!.transfers[0]!;
  assert.equal(dropTransfer.resource, "key-brass");
  assert.equal(dropTransfer.from, "ghost-1");
  assert.equal(dropTransfer.to, "world@tile-B");
  assert.equal(dropTransfer.qty, 1);
});

test("takeItem propagates LedgerInsufficientFunds when ledger rejects take", async () => {
  const map = makeLoadedMap(
    [{ h3Index: "tile-A", itemRefs: ["key-brass"] }],
    { "key-brass": KEY_DEF },
  );
  const svc = new ItemServiceImpl(map);
  svc.setLedger(makeFailingLedger());
  const err = await Effect.runPromise(
    svc.takeItem("ghost-1", "tile-A", "key-brass").pipe(Effect.flip),
  );
  assert.equal(err._tag, "LedgerError.InsufficientFunds");
  // In-memory state must be unchanged — tile still has the item
  assert.deepEqual(svc.getItemsOnTile("tile-A"), ["key-brass"]);
  assert.deepEqual(svc.getGhostInventory("ghost-1"), []);
});
