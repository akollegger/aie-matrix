import type { ItemDefinition, ItemSidecar } from "@aie-matrix/shared-types";
import type { LoadedMap } from "@aie-matrix/server-colyseus";
import { Context, Effect, Layer } from "effect";
import type { ColyseusWorldBridge } from "./colyseus-bridge.js";
import {
  WorldApiItemNotCarriable,
  WorldApiItemNotCarrying,
  WorldApiItemNotFound,
  WorldApiItemNotHere,
  WorldApiTileFull,
} from "./world-api-errors.js";

export interface ItemServiceOps {
  getItemsOnTile(h3Index: string): readonly string[];
  getGhostInventory(ghostId: string): readonly string[];
  inspectItem(
    h3Index: string,
    itemRef: string,
  ): Effect.Effect<
    { name: string; description?: string },
    WorldApiItemNotHere | WorldApiItemNotFound
  >;
  takeItem(
    ghostId: string,
    h3Index: string,
    itemRef: string,
  ): Effect.Effect<
    { name: string },
    WorldApiItemNotFound | WorldApiItemNotHere | WorldApiItemNotCarriable
  >;
  dropItem(
    ghostId: string,
    h3Index: string,
    itemRef: string,
    tileCapacity: number | undefined,
    tileGhostCount: number,
  ): Effect.Effect<void, WorldApiItemNotCarrying | WorldApiTileFull>;
  getSidecar(): Map<string, ItemDefinition>;
}

export class ItemService extends Context.Tag("aie-matrix/ItemService")<
  ItemService,
  ItemServiceOps
>() {}

export class ItemServiceImpl implements ItemServiceOps {
  private readonly tileItems: Map<string, string[]> = new Map();
  private readonly ghostInventory: Map<string, string[]> = new Map();
  private readonly sidecar: Map<string, ItemDefinition>;
  private bridge: ColyseusWorldBridge | null = null;

  constructor(loadedMap: LoadedMap) {
    this.sidecar = loadedMap.itemSidecar;
    for (const [h3Index, cell] of loadedMap.cells) {
      if (cell.initialItemRefs.length > 0) {
        this.tileItems.set(h3Index, [...cell.initialItemRefs]);
      }
    }
  }

  setBridge(bridge: ColyseusWorldBridge): void {
    this.bridge = bridge;
  }

  broadcastAllTileItems(bridge: ColyseusWorldBridge): void {
    for (const [h3Index, refs] of this.tileItems) {
      if (refs.length > 0) {
        bridge.setTileItems(h3Index, refs);
      }
    }
  }

  getSidecar(): Map<string, ItemDefinition> {
    return this.sidecar;
  }

  getItemsOnTile(h3Index: string): readonly string[] {
    return [...(this.tileItems.get(h3Index) ?? [])];
  }

  getGhostInventory(ghostId: string): readonly string[] {
    return [...(this.ghostInventory.get(ghostId) ?? [])];
  }

  inspectItem(
    h3Index: string,
    itemRef: string,
  ): Effect.Effect<
    { name: string; description?: string },
    WorldApiItemNotHere | WorldApiItemNotFound
  > {
    return Effect.gen(this, function* () {
      const def = this.sidecar.get(itemRef);
      if (!def) {
        yield* Effect.fail(new WorldApiItemNotFound({ itemRef }));
        return undefined as never;
      }
      const onTile = this.tileItems.get(h3Index) ?? [];
      if (!onTile.includes(itemRef)) {
        yield* Effect.fail(new WorldApiItemNotHere({ itemRef }));
        return undefined as never;
      }
      const result: { name: string; description?: string } = { name: def.name };
      if (def.description !== undefined) {
        result.description = def.description;
      }
      return result;
    });
  }

  takeItem(
    ghostId: string,
    h3Index: string,
    itemRef: string,
  ): Effect.Effect<
    { name: string },
    WorldApiItemNotFound | WorldApiItemNotHere | WorldApiItemNotCarriable
  > {
    return Effect.gen(this, function* () {
      const def = this.sidecar.get(itemRef);
      if (!def) {
        yield* Effect.fail(new WorldApiItemNotFound({ itemRef }));
        return undefined as never;
      }
      const onTile = this.tileItems.get(h3Index) ?? [];
      const idx = onTile.indexOf(itemRef);
      if (idx === -1) {
        yield* Effect.fail(new WorldApiItemNotHere({ itemRef }));
        return undefined as never;
      }
      if (!def.carriable) {
        yield* Effect.fail(new WorldApiItemNotCarriable({ itemRef }));
        return undefined as never;
      }
      const newTile = [...onTile];
      newTile.splice(idx, 1);
      if (newTile.length === 0) {
        this.tileItems.delete(h3Index);
      } else {
        this.tileItems.set(h3Index, newTile);
      }
      const inv = this.ghostInventory.get(ghostId) ?? [];
      const newInv = [...inv, itemRef];
      this.ghostInventory.set(ghostId, newInv);
      this.bridge?.setTileItems(h3Index, newTile);
      this.bridge?.setGhostInventory(ghostId, newInv);
      return { name: def.name };
    });
  }

  dropItem(
    ghostId: string,
    h3Index: string,
    itemRef: string,
    tileCapacity: number | undefined,
    tileGhostCount: number,
  ): Effect.Effect<void, WorldApiItemNotCarrying | WorldApiTileFull> {
    return Effect.gen(this, function* () {
      const inv = this.ghostInventory.get(ghostId) ?? [];
      const idx = inv.indexOf(itemRef);
      if (idx === -1) {
        yield* Effect.fail(new WorldApiItemNotCarrying({ itemRef }));
        return;
      }

      if (tileCapacity !== undefined) {
        const onTile = this.tileItems.get(h3Index) ?? [];
        const itemCost = onTile.reduce((sum, ref) => {
          const d = this.sidecar.get(ref);
          return sum + (d?.capacityCost ?? 0);
        }, 0);
        const droppingCost = this.sidecar.get(itemRef)?.capacityCost ?? 0;
        if (tileGhostCount + itemCost + droppingCost > tileCapacity) {
          yield* Effect.fail(new WorldApiTileFull({ h3Index }));
          return;
        }
      }

      const newInv = [...inv];
      newInv.splice(idx, 1);
      if (newInv.length === 0) {
        this.ghostInventory.delete(ghostId);
      } else {
        this.ghostInventory.set(ghostId, newInv);
      }
      const onTile = this.tileItems.get(h3Index) ?? [];
      const newTile = [...onTile, itemRef];
      this.tileItems.set(h3Index, newTile);
      this.bridge?.setGhostInventory(ghostId, newInv);
      this.bridge?.setTileItems(h3Index, newTile);
    });
  }
}

export const makeItemServiceLayer = (impl: ItemServiceImpl): Layer.Layer<ItemService> =>
  Layer.succeed(ItemService, impl);

/** Broadcast initial tile item state to Colyseus after ItemService is seeded. */
export function broadcastInitialItemState(
  impl: ItemServiceImpl,
  bridge: ColyseusWorldBridge,
): void {
  impl.broadcastAllTileItems(bridge);
}

/** Compute the total capacity cost of items currently on a tile. */
export function computeTileItemCost(
  h3Index: string,
  itemService: ItemServiceOps,
): number {
  const refs = itemService.getItemsOnTile(h3Index);
  const sidecar = itemService.getSidecar();
  return refs.reduce((sum, ref) => {
    const def = sidecar.get(ref);
    return sum + (def?.capacityCost ?? 0);
  }, 0);
}

export type { ItemSidecar };
