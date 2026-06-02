import type { ItemDefinition, ItemSidecar } from "@aie-matrix/shared-types";
import type { LoadedMap } from "@aie-matrix/server-colyseus";
import { Context, Effect, Layer } from "effect";
import type { ColyseusWorldBridge } from "./colyseus-bridge.js";
import {
  WorldApiInvalidConsumeAmount,
  WorldApiItemNotCarriable,
  WorldApiItemNotCarrying,
  WorldApiItemNotConsumable,
  WorldApiItemNotFound,
  WorldApiItemNotHere,
  WorldApiTileFull,
} from "./world-api-errors.js";

/** Successful consume returns the actual energy taken and what's left. */
export interface ConsumeResult {
  readonly itemRef: string;
  /** Tokens transferred from the item to the consumer. */
  readonly consumed: number;
  /** Tokens still in the instance after this consume. */
  readonly remaining: number;
  /** True when the instance was fully depleted by this consume and
   *  removed from the tile. */
  readonly depleted: boolean;
}

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
  /**
   * Eat some or all of a consumable item's energy in place. `amount`
   * defaults to the instance's remaining tokens; values exceeding
   * remaining are clamped down (no over-eating). Removes the instance
   * when tokens hit zero. Items without `tokens` on their definition
   * are rejected with `ItemNotConsumable`.
   */
  consumeItem(
    h3Index: string,
    itemRef: string,
    amount: number | undefined,
  ): Effect.Effect<
    ConsumeResult,
    WorldApiItemNotFound | WorldApiItemNotHere | WorldApiItemNotConsumable | WorldApiInvalidConsumeAmount
  >;
  /** Remaining tokens for a specific (cell, itemRef) instance, or
   *  undefined when the item is not consumable / not present. Used by
   *  `look` to expose the affordance to the LLM without a tool call. */
  getInstanceTokens(h3Index: string, itemRef: string): number | undefined;
  /** Remaining tokens for an inventory item carried by this ghost, or
   *  undefined when the item is not consumable / not in inventory.
   *  Lets `inventory` show what a ghost is carrying-with-energy. */
  getInventoryTokens(ghostId: string, itemRef: string): number | undefined;
  /** Out-of-band item creation — place an item on a tile and seed its
   *  instance tokens from the type's definition. Used by the food-rain
   *  test mechanism to keep ghosts fed during long-running observations.
   *  Returns true on success; false when the type is unknown or the
   *  tile already has an instance of the same type (no double-stack).
   */
  spawnItem(h3Index: string, itemRef: string): boolean;
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
  /**
   * Mutable per-instance state: remaining tokens for each (h3, itemRef)
   * pair where the item type declared a `tokens` value. Parallel to
   * `tileItems` rather than embedded in it so the existing string-list
   * shape is preserved and most non-consume paths stay untouched.
   * Key format: `${h3}|${itemRef}`. Entries are removed on full consume
   * or take.
   */
  private readonly tileTokens: Map<string, number> = new Map();
  /**
   * Mutable per-inventory-instance state: remaining tokens for each
   * (ghostId, itemRef) pair. Mirrors `tileTokens` but keyed by ghost
   * inventory instead of tile. Lets food retain its energy through a
   * take → carry → drop cycle, which is the mechanical foundation for
   * sharing food between ghosts: A takes food (tokens move to A's
   * inventory state), walks to B's tile, drops the food (tokens move
   * back to that tile), B consumes (mechanically the same as any
   * tile-consume).
   */
  private readonly inventoryTokens: Map<string, number> = new Map();
  private bridge: ColyseusWorldBridge | null = null;

  constructor(loadedMap: LoadedMap) {
    this.sidecar = loadedMap.itemSidecar;
    for (const [h3Index, cell] of loadedMap.cells) {
      if (cell.initialItemRefs.length > 0) {
        this.tileItems.set(h3Index, [...cell.initialItemRefs]);
        // Seed instance tokens from the type's `tokens` field. Each
        // cell that holds a consumable type gets one instance worth.
        for (const ref of cell.initialItemRefs) {
          const def = this.sidecar.get(ref);
          if (def?.tokens !== undefined && def.tokens > 0) {
            this.tileTokens.set(tokenKey(h3Index, ref), def.tokens);
          }
        }
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
      // Preserve the instance's tokens through the take. When the
      // ghost later drops the item, the tokens come back on the tile;
      // when a peer consumes it, the energy is real. This is what
      // makes mechanical sharing possible.
      const tileKey = tokenKey(h3Index, itemRef);
      const tokens = this.tileTokens.get(tileKey);
      this.tileTokens.delete(tileKey);
      if (tokens !== undefined) {
        this.inventoryTokens.set(inventoryKey(ghostId, itemRef), tokens);
      }
      const inv = this.ghostInventory.get(ghostId) ?? [];
      const newInv = [...inv, itemRef];
      this.ghostInventory.set(ghostId, newInv);
      this.bridge?.setTileItems(h3Index, newTile);
      this.bridge?.setGhostInventory(ghostId, newInv);
      return { name: def.name };
    });
  }

  consumeItem(
    h3Index: string,
    itemRef: string,
    amount: number | undefined,
  ): Effect.Effect<
    ConsumeResult,
    WorldApiItemNotFound | WorldApiItemNotHere | WorldApiItemNotConsumable | WorldApiInvalidConsumeAmount
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
      if (def.tokens === undefined) {
        yield* Effect.fail(new WorldApiItemNotConsumable({ itemRef }));
        return undefined as never;
      }
      const key = tokenKey(h3Index, itemRef);
      const remaining = this.tileTokens.get(key) ?? def.tokens;
      // No `amount` → take everything the instance has left (the
      // "affordance default"). Any positive request is clamped to
      // remaining; non-positive numeric requests are an explicit error.
      let consumed: number;
      if (amount === undefined) {
        consumed = remaining;
      } else if (!Number.isFinite(amount) || amount <= 0) {
        yield* Effect.fail(
          new WorldApiInvalidConsumeAmount({ itemRef, requested: amount }),
        );
        return undefined as never;
      } else {
        consumed = Math.min(amount, remaining);
      }
      const next = remaining - consumed;
      const depleted = next <= 0;
      if (depleted) {
        this.tileTokens.delete(key);
        const newTile = [...onTile];
        newTile.splice(idx, 1);
        if (newTile.length === 0) {
          this.tileItems.delete(h3Index);
        } else {
          this.tileItems.set(h3Index, newTile);
        }
        this.bridge?.setTileItems(h3Index, newTile);
      } else {
        this.tileTokens.set(key, next);
      }
      return { itemRef, consumed, remaining: depleted ? 0 : next, depleted };
    });
  }

  getInstanceTokens(h3Index: string, itemRef: string): number | undefined {
    const def = this.sidecar.get(itemRef);
    if (def?.tokens === undefined) return undefined;
    return this.tileTokens.get(tokenKey(h3Index, itemRef)) ?? def.tokens;
  }

  getInventoryTokens(ghostId: string, itemRef: string): number | undefined {
    const def = this.sidecar.get(itemRef);
    if (def?.tokens === undefined) return undefined;
    const inv = this.ghostInventory.get(ghostId) ?? [];
    if (!inv.includes(itemRef)) return undefined;
    return this.inventoryTokens.get(inventoryKey(ghostId, itemRef));
  }

  spawnItem(h3Index: string, itemRef: string): boolean {
    const def = this.sidecar.get(itemRef);
    if (!def) return false;
    const existing = this.tileItems.get(h3Index) ?? [];
    if (existing.includes(itemRef)) return false;
    const newTile = [...existing, itemRef];
    this.tileItems.set(h3Index, newTile);
    if (def.tokens !== undefined && def.tokens > 0) {
      this.tileTokens.set(tokenKey(h3Index, itemRef), def.tokens);
    }
    this.bridge?.setTileItems(h3Index, newTile);
    return true;
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
      // Restore tokens on the dropped tile from whatever the carrier
      // had left in inventory. If the tile already has tokens for the
      // same itemRef (rare — would only happen via a food-rain race),
      // we keep the higher value rather than stacking, since multiple
      // instances of the same type at the same tile is otherwise
      // forbidden by spawnItem.
      const invKey = inventoryKey(ghostId, itemRef);
      const carriedTokens = this.inventoryTokens.get(invKey);
      this.inventoryTokens.delete(invKey);
      if (carriedTokens !== undefined && carriedTokens > 0) {
        const tileKey = tokenKey(h3Index, itemRef);
        const existing = this.tileTokens.get(tileKey);
        this.tileTokens.set(tileKey, Math.max(existing ?? 0, carriedTokens));
      }
      this.bridge?.setGhostInventory(ghostId, newInv);
      this.bridge?.setTileItems(h3Index, newTile);
    });
  }
}

function tokenKey(h3: string, itemRef: string): string {
  return `${h3}|${itemRef}`;
}

function inventoryKey(ghostId: string, itemRef: string): string {
  return `${ghostId}|${itemRef}`;
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
