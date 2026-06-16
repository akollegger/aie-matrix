/**
 * Food physiology — what eating a *specific* food does to the body,
 * beyond the raw Fuel it delivers.
 *
 * The world's `consume` tool already reports `consumed` (tokens), which
 * the run-loop turns into a Fuel restore. That makes every food a flat
 * "Fuel +N". This module adds the *character* of each food on top of
 * that, keyed by `itemRef`:
 *
 *   - `fuelBonus`  extra immediate Fuel display beyond the tokens (a
 *                  sugar rush that overshoots the calories).
 *   - `restDelta`  immediate Rest shift (cake/sweets pull Rest DOWN — a
 *                  sugar high costs wakefulness; coffee pushes it UP).
 *   - `strainDelta` immediate metabolic-strain add (junk strains the
 *                  body now; fresh food can relieve it).
 *   - `crashAfter` / `crashFuel`  a DELAYED Fuel crash: `crashAfter`
 *                  cascades after eating, Fuel drops by `crashFuel`.
 *                  For cake `crashFuel` is set larger than the spike, so
 *                  the binge nets NEGATIVE — the cataclysmic sugar crash.
 *
 * This is the body's response to a food, so it lives with the need
 * mechanics (peppers-inner), not the world: a different ghost lineage
 * could metabolise the same cake differently. The world owns the item
 * (name, glyph, tokens); the body owns the consequence.
 *
 * Mirrors the authoring profile in `maps/props/concession.items.json`
 * (`attrs.strain/tol/rest`); THIS table is the live, enforced source.
 */

import {
  adjustNeed,
  adjustNeedDisplay,
  type NeedName,
  type NeedProfile,
} from "./needs.js";

/** A delayed Fuel crash, expressed RELATIVE to the Fuel the food just
 *  delivered — never as a flat magic number. The crash removes
 *  `ofGain × gain + plus` display units, `after` cascades later. */
export interface FoodCrash {
  /** Cascades after eating until the crash fires. */
  readonly after: number;
  /** Fraction of the eat's Fuel gain the crash removes. Default 1 (the
   *  whole high comes back down). */
  readonly ofGain?: number;
  /** Extra display units removed beyond `ofGain × gain`. Cake uses
   *  `plus: 1` so the binge nets exactly −1 (loses one more than it
   *  gained). Default 0. */
  readonly plus?: number;
}

export interface FoodEffect {
  /** Extra immediate Fuel display delta beyond the world's reported
   *  tokens. The sugar overshoot. Default 0. */
  readonly fuelBonus?: number;
  /** Immediate Rest display delta. Negative drains (sweets), positive
   *  restores (caffeine). Default 0. */
  readonly restDelta?: number;
  /** Immediate metabolic-strain delta. Positive strains (junk),
   *  negative relieves (fresh). Default 0. */
  readonly strainDelta?: number;
  /** Delayed sugar crash, relative to what the food delivered. Omit for
   *  foods with no crash. */
  readonly crash?: FoodCrash;
}

/** A scheduled need adjustment that fires on a future cascade. Threaded
 *  through the run loop alongside `metabolicStrain`. */
export interface PendingNeedEffect {
  /** Cascade index at (or after) which this fires. */
  readonly dueAtCascade: number;
  readonly need: NeedName;
  readonly direction: "up" | "down";
  /** Display-units magnitude (always positive; direction carries sign). */
  readonly amount: number;
  /** How the magnitude is applied: "display" removes/adds EXACT display
   *  units (linear, sigmoid-bypassed — used by crashes so "gain + 1"
   *  lands precisely); "sigmoid" goes through the normal compressed
   *  event math. Default treated as "sigmoid" if absent. */
  readonly mode: "display" | "sigmoid";
  /** Human-readable origin, e.g. "food-cake crash". For capture/logs. */
  readonly reason: string;
}

/**
 * Per-food physiology. Keyed by `itemRef` (matches the concession pack).
 * Unknown foods fall through to the empty profile — Fuel-from-tokens
 * only, no side effects.
 */
export const FOOD_EFFECTS: Readonly<Record<string, FoodEffect>> = {
  // ── Treats: cheap, calorie-dense, a high that you pay for ──
  // Cake is the flagship sugar bomb: a big immediate Fuel spike and a
  // sharp Rest drop, then 3 cascades later a crash that removes the
  // ENTIRE high plus one more — the binge nets exactly −1 Fuel.
  "food-cake": { fuelBonus: 2.0, restDelta: -2.5, strainDelta: 0.6, crash: { after: 3, ofGain: 1, plus: 1 } },
  "food-chocolate": { fuelBonus: 0.5, restDelta: -0.8, strainDelta: 0.5, crash: { after: 3, ofGain: 0.6 } },
  "food-pastry": { restDelta: -0.6, strainDelta: 0.4, crash: { after: 4, ofGain: 0.5 } },
  // ── Drinks ──
  "food-soda": { restDelta: 0.4, strainDelta: 0.4, crash: { after: 2, ofGain: 0.5 } },
  "food-coffee": { restDelta: 0.8 }, // caffeine: a clean wakefulness lift
  // ── Snacks / street: salt and strain, mild crash ──
  "food-crisps": { strainDelta: 0.3, crash: { after: 4, ofGain: 0.3 } },
  "food-hotdog": { strainDelta: 0.5 },
  "food-energybar": { strainDelta: 0.1 },
  // ── Staples / meals: honest fuel, little character ──
  "food-bread": {},
  "food-sandwich": { strainDelta: 0.1 },
  "food-noodles": { strainDelta: 0.1 },
  // ── Fresh: pricier, kind to the body (relieves strain) ──
  "food-salad": { strainDelta: -0.2 },
  "food-wrap": { strainDelta: -0.1 },
  "food-fruit": { strainDelta: -0.1 },
  "food-water": {},
};

/** The physiology of one food. Empty profile for unknown items. */
export function foodEffectFor(itemRef: string | undefined): FoodEffect {
  if (itemRef === undefined) return {};
  return FOOD_EFFECTS[itemRef] ?? {};
}

/**
 * Apply a food's IMMEDIATE side effects (fuelBonus, restDelta) on top of
 * the Fuel-from-tokens the caller has already applied, and return the
 * strain delta plus any DELAYED effects to enqueue. Pure — the caller
 * threads `enqueue` into the pending-effects list and adds `strainDelta`
 * to the running metabolic strain.
 *
 * `fuelDisplayBeforeEating` is the Fuel display BEFORE this cascade's
 * eating (before the world tokens AND fuelBonus were applied). It lets a
 * crash be sized relative to the ACTUAL Fuel the food delivered — so
 * cake's crash removes "the whole gain + 1" rather than a flat constant.
 */
export function applyFoodConsume(
  needs: NeedProfile,
  itemRef: string | undefined,
  cascadeIndex: number,
  fuelDisplayBeforeEating: number,
): { needs: NeedProfile; strainDelta: number; enqueue: PendingNeedEffect[] } {
  const fx = foodEffectFor(itemRef);
  let next = needs;
  if (fx.fuelBonus && fx.fuelBonus > 0) {
    next = adjustNeed(next, "Fuel", "up", fx.fuelBonus);
  }
  if (fx.restDelta && fx.restDelta !== 0) {
    next = adjustNeed(next, "Rest", fx.restDelta > 0 ? "up" : "down", Math.abs(fx.restDelta));
  }
  const enqueue: PendingNeedEffect[] = [];
  if (fx.crash !== undefined) {
    // Gain = the full Fuel display this eating delivered (tokens applied
    // by the caller + fuelBonus above), measured against the pre-eat
    // level. The crash removes a multiple of that gain, plus an extra.
    const gain = Math.max(0, next.Fuel.display - fuelDisplayBeforeEating);
    const ofGain = fx.crash.ofGain ?? 1;
    const plus = fx.crash.plus ?? 0;
    const amount = gain * ofGain + plus;
    if (amount > 0) {
      enqueue.push({
        dueAtCascade: cascadeIndex + fx.crash.after,
        need: "Fuel",
        direction: "down",
        amount,
        mode: "display", // remove EXACT display units, no sigmoid compression
        reason: `${itemRef ?? "food"} crash`,
      });
    }
  }
  return { needs: next, strainDelta: fx.strainDelta ?? 0, enqueue };
}

/**
 * Fire every pending effect whose `dueAtCascade <= cascadeIndex` against
 * the needs, returning the updated needs, the effects still pending, and
 * the ones that fired (for capture/logging). Pure.
 */
export function applyDuePendingEffects(
  needs: NeedProfile,
  pending: ReadonlyArray<PendingNeedEffect>,
  cascadeIndex: number,
): { needs: NeedProfile; remaining: PendingNeedEffect[]; fired: PendingNeedEffect[] } {
  let next = needs;
  const remaining: PendingNeedEffect[] = [];
  const fired: PendingNeedEffect[] = [];
  for (const e of pending) {
    if (e.dueAtCascade <= cascadeIndex) {
      next =
        e.mode === "display"
          ? adjustNeedDisplay(next, e.need, e.direction, e.amount)
          : adjustNeed(next, e.need, e.direction, e.amount);
      fired.push(e);
    } else {
      remaining.push(e);
    }
  }
  return { needs: next, remaining, fired };
}
