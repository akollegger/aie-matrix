/**
 * Economy helpers built on the joint ledger (RFC-0029).
 *
 * Under the item→ledger model, food is a conserved quantity-1 ledger
 * resource carried in a ghost's bag. "Eating" therefore isn't a tile
 * operation — it's a ledger debit of one unit plus the Fuel that unit
 * delivers. The consumed unit returns to the world pool (conserved: food
 * recirculates rather than being destroyed).
 *
 * Buying needs no helper here: it's a plain `offer`/`agree` trade (gold ↔
 * food) committed by the ledger — the dispenser/vendor just auto-agrees.
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import { LedgerService } from "./LedgerService.js";

/**
 * Per-unit Fuel delivered by each food item-resource, keyed by ledger
 * resource id. Transitional home (Wave 1): ledger resource ids carry
 * hyphens (`food-cake`) which gram `ItemType` labels can't, so the
 * sidecar can't key on them yet. Mirrors `concession.items.json` tokens
 * and the peppers `food-effects` base. Folds into the item definition's
 * `fuel` field in Wave 2. Unknown items deliver 0 (not food).
 */
export const FOOD_FUEL: Readonly<Record<string, number>> = {
  "food-water": 0.2,
  "food-bread": 2.5,
  "food-salad": 1.3,
  "food-sandwich": 3.0,
  "food-coffee": 0.6,
  "food-cake": 4.0,
};

export function foodFuelOf(itemRef: string): number {
  return FOOD_FUEL[itemRef] ?? 0;
}

/**
 * A plain-language descriptor of how nourishing a food is — the
 * prompt-boundary rendering of its Fuel value. Ghosts perceive this word,
 * never the raw number, so they can choose food sensibly (prefer "very
 * filling" when starving) without doing arithmetic on a hidden slider. The
 * mapping is a deterministic lookup; the model never computes fuel-per-gold.
 */
export function foodEnergyWord(itemRef: string): string {
  const fuel = foodFuelOf(itemRef);
  if (fuel >= 3.5) return "very filling";
  if (fuel >= 2.0) return "filling";
  if (fuel >= 1.0) return "a light bite";
  if (fuel >= 0.4) return "a snack";
  if (fuel > 0) return "barely any nourishment";
  return "no nourishment";
}

// Ghosts that have already received their starting gold this run.
const stipended = new Set<string>();

/**
 * Grant a ghost its one-time starting gold the first time it's seen, so
 * it can actually afford to buy. Idempotent per ghost per run; a no-op
 * when `amount <= 0` (stipend disabled). Swallows ledger errors (e.g. no
 * `gold` resource seeded on this map) so it never blocks a tool call.
 */
export function ensureStipend(
  ledger: LedgerService["Type"],
  ghostId: string,
  amount: number,
) {
  return Effect.gen(function* () {
    if (amount <= 0 || stipended.has(ghostId)) return;
    stipended.add(ghostId);
    yield* ledger.commit({
      id: ulid(),
      transfers: [{ resource: "gold", qty: amount, from: "world", to: ghostId }],
      cause: "stipend",
      actors: [ghostId],
      ts: Date.now(),
    }).pipe(Effect.catchAll(() => Effect.void));
  });
}

export interface ConsumeFromBagResult {
  readonly ok: boolean;
  /** The item consumed (echoed for the caller). */
  readonly itemRef: string;
  /** Fuel delivered by the one unit consumed (0 when nothing was held). */
  readonly consumed: number;
  /** Units of this item still held after the consume. */
  readonly remaining: number;
}

/**
 * Consume one unit of `itemRef` from `ghostId`'s ledger bag. Returns the
 * per-unit Fuel (`fuelOf(itemRef)`) and the remaining held count. If the
 * ghost holds none, returns `{ ok: false, consumed: 0 }` without touching
 * the ledger. The consumed unit transfers back to `world` (conserved).
 */
export function consumeFromBag(
  ledger: LedgerService["Type"],
  ghostId: string,
  itemRef: string,
  fuelOf: (itemRef: string) => number,
) {
  return Effect.gen(function* () {
    const bag = yield* ledger.bag(ghostId);
    const held = bag.holdings.find((h) => h.resource === itemRef)?.qty ?? 0;
    if (held <= 0) {
      return { ok: false, itemRef, consumed: 0, remaining: 0 } satisfies ConsumeFromBagResult;
    }
    yield* ledger.commit({
      id: ulid(),
      transfers: [{ resource: itemRef, qty: 1, from: ghostId, to: "world" }],
      cause: "consume",
      actors: [ghostId],
      ts: Date.now(),
    });
    return {
      ok: true,
      itemRef,
      consumed: fuelOf(itemRef),
      remaining: held - 1,
    } satisfies ConsumeFromBagResult;
  });
}
