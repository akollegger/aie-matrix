/**
 * Tier-warped candidate generator.
 *
 * Takes the school's optimal play and the legal action menu, returns
 * exactly THREE candidates {action, amount} that the LLM will choose
 * from. The LLM is locked to these three — it never sees the raw
 * legal menu and cannot reach outside the candidates.
 *
 * The shape of the three depends on `tier`:
 *
 *   Greenhorn  — three warped candidates. The least-warped one IS the
 *                noob's best-guess. The other two are bigger mistakes.
 *                Noob can pick correctly within their amateur frame,
 *                but cannot find the true optimal — it isn't on the menu.
 *
 *   Journeyman — one near-optimal candidate (right action, slightly
 *                wrong sizing), two distractors that are plausibly wrong.
 *                The math line is "close" but not quite right; the
 *                Journeyman has to dodge the distractors to land it.
 *
 *   Veteran    — three competent candidates clustered tightly around the
 *                optimal. The "best" one IS optimal. The LLM is just
 *                picking among nuances — any choice is near-correct.
 *
 *   Eagle      — three competent candidates including the optimal,
 *                plus deliberate exploit/mix-frequency lines (a bluff,
 *                a thin value, or a check-raise trap). They get tools
 *                Veterans don't.
 *
 * BOTH action and amount get warped independently — a Noob raising
 * $5 into a $50 pot is the most common amateur tell, even when they
 * picked the right action class.
 *
 * Pure function. No Effect, no LLM, no I/O. PR-portable.
 */

import type { AvailableActions } from "@aie-matrix/ghost-rdc-poker";
import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { PokerAction, SchoolPlay } from "./school-rules.js";

export interface Candidate {
  /** Letter shown to the LLM. Always "A", "B", or "C". */
  readonly letter: "A" | "B" | "C";
  readonly action: PokerAction;
  readonly amount: number;
  /** Short label for the prompt + trace. Pure shape — no "optimal" leak. */
  readonly label: string;
}

export interface CandidateSet {
  readonly candidates: readonly [Candidate, Candidate, Candidate];
  /** Index (0/1/2) of the candidate closest to the school's optimal.
   *  For Veteran this IS the optimal; for Noob this is the noob's
   *  least-warped guess. Used for traces and overlay — NOT shown to
   *  the LLM. */
  readonly nearestOptimalIndex: 0 | 1 | 2;
}

export interface GenerateCandidatesRequest {
  readonly optimal: SchoolPlay;
  readonly available: AvailableActions;
  readonly tier: SkillTier | undefined;
  /** Deterministic seed for the ordering shuffle (tests). */
  readonly seed?: number;
}

/**
 * Generate the three-candidate menu for the LLM.
 *
 * Implementation: each tier has a function that produces an UNORDERED
 * triple `[optimal-ish, alternative-1, alternative-2]`. Then we
 * shuffle (seeded for tests) so the order doesn't leak "A is always
 * the right answer."
 */
export function generateCandidates(req: GenerateCandidatesRequest): CandidateSet {
  const tier = req.tier ?? "Greenhorn";

  let triple: [Triple0, Triple0, Triple0];
  let optimalSlot: 0 | 1 | 2;
  if (tier === "Veteran") {
    triple = veteranTriple(req.optimal, req.available);
    optimalSlot = 0;
  } else if (tier === "Eagle") {
    triple = eagleTriple(req.optimal, req.available);
    optimalSlot = 0;
  } else if (tier === "Journeyman") {
    triple = journeymanTriple(req.optimal, req.available);
    optimalSlot = 0;
  } else {
    triple = greenhornTriple(req.optimal, req.available);
    optimalSlot = 0;
  }

  // Shuffle so position never reveals correctness. Deterministic when
  // seed is provided.
  const order = shuffleIndices(req.seed);
  const reorderedTriple: [Triple0, Triple0, Triple0] = [
    triple[order[0]]!,
    triple[order[1]]!,
    triple[order[2]]!,
  ];
  const nearestOptimalIndex = order.indexOf(optimalSlot) as 0 | 1 | 2;

  const letters: ReadonlyArray<"A" | "B" | "C"> = ["A", "B", "C"];
  const candidates = reorderedTriple.map((t, i): Candidate => ({
    letter: letters[i]!,
    action: t.action,
    amount: t.amount,
    label: t.label,
  })) as unknown as readonly [Candidate, Candidate, Candidate];

  return { candidates, nearestOptimalIndex };
}

// ─── internal triple shape ────────────────────────────────────────────

interface Triple0 {
  readonly action: PokerAction;
  readonly amount: number;
  readonly label: string;
}

// ─── helpers ──────────────────────────────────────────────────────────

function clampAmount(amount: number, action: PokerAction, a: AvailableActions): number {
  if (action === "fold" || action === "check") return 0;
  if (action === "call") return a.callAmount;
  if (action === "all-in") return a.allInAmount;
  // raise
  if (!a.canRaise) return 0;
  return Math.max(a.minRaise, Math.min(amount, a.maxRaise));
}

function legalAction(action: PokerAction, a: AvailableActions): boolean {
  if (action === "fold") return a.canFold;
  if (action === "check") return a.canCheck;
  if (action === "call") return a.canCall;
  if (action === "raise") return a.canRaise;
  if (action === "all-in") return a.canAllIn;
  return false;
}

/**
 * Return a triple after substituting any illegal candidates with the
 * closest legal alternative. Guarantees no candidate is illegal — the
 * engine would reject those and the user would see weird behavior.
 *
 * Legality fallback order (per action class):
 *   raise illegal → call → check → fold
 *   call illegal  → check → fold
 *   check illegal → call (free) → fold
 *   fold illegal  → check → call (mostly impossible in real poker)
 *   all-in illegal → raise → call → fold
 */
function legalize(t: Triple0, a: AvailableActions): Triple0 {
  if (legalAction(t.action, a)) {
    return { ...t, amount: clampAmount(t.amount, t.action, a) };
  }
  const fallback = ((): PokerAction => {
    if (t.action === "raise") {
      if (a.canCall) return "call";
      if (a.canCheck) return "check";
      return "fold";
    }
    if (t.action === "all-in") {
      if (a.canRaise) return "raise";
      if (a.canCall) return "call";
      return "fold";
    }
    if (t.action === "call") return a.canCheck ? "check" : "fold";
    if (t.action === "check") return a.canCall ? "call" : "fold";
    // fold illegal — engine shouldn't allow this but degrade gracefully.
    return a.canCheck ? "check" : a.canCall ? "call" : "all-in";
  })();
  return {
    action: fallback,
    amount: clampAmount(t.amount, fallback, a),
    label: `${t.label} (substituted from illegal ${t.action})`,
  };
}

/** Deduplicate identical (action, amount) candidates — when warping
 *  produces the same pair twice, jitter the amount or substitute. */
function deduplicate(triple: [Triple0, Triple0, Triple0], a: AvailableActions): [Triple0, Triple0, Triple0] {
  const seen = new Set<string>();
  const out: Triple0[] = [];
  for (const t of triple) {
    const key = `${t.action}:${t.amount}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
      continue;
    }
    // Try jittering raise amount up or down by minRaise increment.
    if (t.action === "raise") {
      const bigger = clampAmount(t.amount + a.minRaise, "raise", a);
      const smaller = clampAmount(t.amount - a.minRaise, "raise", a);
      for (const amt of [bigger, smaller]) {
        const k2 = `raise:${amt}`;
        if (!seen.has(k2) && amt !== t.amount) {
          seen.add(k2);
          out.push({ ...t, amount: amt });
          break;
        }
      }
      if (out.length === seen.size) continue; // already pushed
    }
    // Fall back: substitute with an unused legal action.
    const candidates: PokerAction[] = ["fold", "check", "call", "raise", "all-in"];
    for (const c of candidates) {
      if (!legalAction(c, a)) continue;
      const amt = clampAmount(0, c, a);
      const k2 = `${c}:${amt}`;
      if (!seen.has(k2)) {
        seen.add(k2);
        out.push({ action: c, amount: amt, label: `${t.label} (deduped)` });
        break;
      }
    }
  }
  // Backfill if we lost entries (shouldn't happen with sane menus).
  while (out.length < 3) {
    out.push({ action: "fold", amount: 0, label: "fold" });
  }
  return [out[0]!, out[1]!, out[2]!];
}

// ─── tier-specific triples ────────────────────────────────────────────

function veteranTriple(optimal: SchoolPlay, a: AvailableActions): [Triple0, Triple0, Triple0] {
  // Three competent options clustered around the optimal.
  const candidates: Triple0[] = [];
  candidates.push({ action: optimal.action, amount: optimal.amount, label: describe(optimal) });

  // Variant 2: same action, slightly different sizing OR adjacent good action.
  if (optimal.action === "raise") {
    const smaller = clampAmount(Math.round(optimal.amount * 0.7), "raise", a);
    candidates.push({ action: "raise", amount: smaller, label: `raise to ${smaller}` });
  } else if (optimal.action === "call") {
    // A defensible alternative to call: small raise (price-set + isolate).
    if (a.canRaise) {
      const minR = a.minRaise;
      candidates.push({ action: "raise", amount: minR, label: `raise to ${minR} (price-set)` });
    } else {
      candidates.push({ action: "fold", amount: 0, label: "fold (give up the spot)" });
    }
  } else if (optimal.action === "fold") {
    // A defensible alternative to fold: check if legal, else small call.
    if (a.canCheck) {
      candidates.push({ action: "check", amount: 0, label: "check" });
    } else if (a.canCall) {
      candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (peel one street)` });
    } else {
      candidates.push({ action: "all-in", amount: a.allInAmount, label: "shove" });
    }
  } else if (optimal.action === "check") {
    if (a.canRaise) {
      candidates.push({ action: "raise", amount: a.minRaise, label: `bet ${a.minRaise} (probe)` });
    } else {
      candidates.push({ action: "fold", amount: 0, label: "fold" });
    }
  } else if (optimal.action === "all-in") {
    if (a.canRaise) {
      const big = clampAmount(Math.round(a.maxRaise * 0.7), "raise", a);
      candidates.push({ action: "raise", amount: big, label: `raise to ${big} (leave room)` });
    } else {
      candidates.push({ action: "fold", amount: 0, label: "fold" });
    }
  }

  // Variant 3: the "defensible alternative" — the other strong line.
  if (optimal.action === "raise") {
    if (a.canCall) {
      candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (slowplay)` });
    } else if (a.canCheck) {
      candidates.push({ action: "check", amount: 0, label: "check (trap)" });
    } else {
      candidates.push({ action: "fold", amount: 0, label: "fold" });
    }
  } else if (optimal.action === "call") {
    if (a.canFold) candidates.push({ action: "fold", amount: 0, label: "fold (give up)" });
    else candidates.push({ action: "check", amount: 0, label: "check" });
  } else if (optimal.action === "fold") {
    if (a.canCall) candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (defend)` });
    else if (a.canCheck) candidates.push({ action: "check", amount: 0, label: "check" });
    else candidates.push({ action: "all-in", amount: a.allInAmount, label: "shove" });
  } else {
    candidates.push({ action: "fold", amount: 0, label: "fold" });
  }

  return finalize(candidates, a);
}

function eagleTriple(optimal: SchoolPlay, a: AvailableActions): [Triple0, Triple0, Triple0] {
  // Three competent options, with one being an exploit/mix-frequency line
  // (bluff, thin value, check-raise trap) that Veterans don't reach for.
  const candidates: Triple0[] = [];
  candidates.push({ action: optimal.action, amount: optimal.amount, label: describe(optimal) });

  // Variant 2: alternative balanced line (close to optimal, different shape).
  if (optimal.action === "raise") {
    const halfPot = clampAmount(Math.round(optimal.amount * 0.6), "raise", a);
    candidates.push({ action: "raise", amount: halfPot, label: `raise to ${halfPot} (smaller, balanced)` });
  } else if (optimal.action === "call") {
    candidates.push({ action: "raise", amount: a.minRaise, label: `raise to ${a.minRaise} (3-bet light)` });
  } else if (optimal.action === "fold" && a.canCall) {
    candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (peel)` });
  } else {
    candidates.push({ action: "check", amount: 0, label: "check" });
  }

  // Variant 3: the exploit/mix line — deliberate unbalance.
  if (a.canRaise) {
    // A bluff/value-thin raise — pot-sized when optimal was passive.
    const bluffSize = clampAmount(Math.round(a.maxRaise * 0.4), "raise", a);
    candidates.push({ action: "raise", amount: bluffSize, label: `raise to ${bluffSize} (exploit line)` });
  } else if (a.canCall) {
    candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (float)` });
  } else {
    candidates.push({ action: "fold", amount: 0, label: "fold" });
  }

  return finalize(candidates, a);
}

function journeymanTriple(optimal: SchoolPlay, a: AvailableActions): [Triple0, Triple0, Triple0] {
  // One near-correct (right action, wrong sizing) + two plausible distractors.
  const candidates: Triple0[] = [];

  // Slot 1: optimal action but wrong sizing (under-bet a raise; if not
  // raising, keep the action exact).
  if (optimal.action === "raise") {
    const tooSmall = clampAmount(Math.round(optimal.amount * 0.5), "raise", a);
    candidates.push({ action: "raise", amount: tooSmall, label: `raise to ${tooSmall}` });
  } else {
    // Fold/check/call: no sizing to warp. Slot 1 = the right action.
    candidates.push({ action: optimal.action, amount: optimal.amount, label: describe(optimal) });
  }

  // Slot 2: passive distractor — call when should raise, check/fold when should call.
  if (optimal.action === "raise") {
    if (a.canCall) candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (slowplay)` });
    else if (a.canCheck) candidates.push({ action: "check", amount: 0, label: "check" });
    else candidates.push({ action: "fold", amount: 0, label: "fold" });
  } else if (optimal.action === "call") {
    if (a.canFold) candidates.push({ action: "fold", amount: 0, label: "fold (over-fold)" });
    else candidates.push({ action: "check", amount: 0, label: "check" });
  } else if (optimal.action === "fold") {
    if (a.canCall) candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (hero-call)` });
    else if (a.canCheck) candidates.push({ action: "check", amount: 0, label: "check" });
    else candidates.push({ action: "all-in", amount: a.allInAmount, label: "shove" });
  } else if (optimal.action === "check") {
    candidates.push({ action: "fold", amount: 0, label: "fold (over-fold a free street)" });
  } else { // all-in
    candidates.push({ action: a.canFold ? "fold" : "call", amount: a.canFold ? 0 : a.callAmount, label: "back off" });
  }

  // Slot 3: aggressive distractor — over-bet the value spot, or jam a marginal.
  if (a.canRaise) {
    const tooBig = clampAmount(Math.round(a.maxRaise * 0.85), "raise", a);
    candidates.push({ action: "raise", amount: tooBig, label: `raise to ${tooBig} (over-bet)` });
  } else if (a.canAllIn) {
    candidates.push({ action: "all-in", amount: a.allInAmount, label: "shove" });
  } else {
    candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount}` });
  }

  return finalize(candidates, a);
}

function greenhornTriple(optimal: SchoolPlay, a: AvailableActions): [Triple0, Triple0, Triple0] {
  // Three warped candidates. Slot 1 = "noob's amateur best guess" — right
  // direction, wrong details. Slots 2 & 3 = bigger amateur mistakes.
  const candidates: Triple0[] = [];

  // Slot 1: closest-to-truth amateur play.
  if (optimal.action === "raise") {
    // Noob raises but with completely wrong sizing — either tiny min-raise
    // or jam — both are common amateur tells.
    const minR = a.minRaise;
    candidates.push({ action: "raise", amount: minR, label: `raise to ${minR} (min-raise)` });
  } else if (optimal.action === "call") {
    // Noob calls (right) but might also stash an under-bet here.
    candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount}` });
  } else if (optimal.action === "fold") {
    // Noob folds (right direction) — slot 1 is the safe fold.
    candidates.push({ action: "fold", amount: 0, label: "fold" });
  } else if (optimal.action === "check") {
    candidates.push({ action: "check", amount: 0, label: "check" });
  } else { // all-in
    if (a.canRaise) {
      const halfMax = clampAmount(Math.round(a.maxRaise * 0.5), "raise", a);
      candidates.push({ action: "raise", amount: halfMax, label: `raise to ${halfMax} (under-jam)` });
    } else {
      candidates.push({ action: "all-in", amount: a.allInAmount, label: "shove" });
    }
  }

  // Slot 2: opposite-direction amateur error. Folds a winner; calls a loser.
  if (optimal.action === "raise" || optimal.action === "call") {
    // Should bet/call: noob folds.
    if (a.canFold) candidates.push({ action: "fold", amount: 0, label: "fold (scared)" });
    else if (a.canCheck) candidates.push({ action: "check", amount: 0, label: "check (timid)" });
    else candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount}` });
  } else {
    // Should fold/check: noob calls.
    if (a.canCall) candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount} (curious)` });
    else if (a.canRaise) candidates.push({ action: "raise", amount: a.minRaise, label: `raise to ${a.minRaise} (out of nothing)` });
    else candidates.push({ action: "check", amount: 0, label: "check" });
  }

  // Slot 3: wild amateur — overbet or jam.
  if (a.canAllIn) {
    candidates.push({ action: "all-in", amount: a.allInAmount, label: "all-in (yolo)" });
  } else if (a.canRaise) {
    const tooBig = clampAmount(a.maxRaise, "raise", a);
    candidates.push({ action: "raise", amount: tooBig, label: `raise to ${tooBig} (jam)` });
  } else {
    candidates.push({ action: "call", amount: a.callAmount, label: `call ${a.callAmount}` });
  }

  return finalize(candidates, a);
}

// ─── post-processing ──────────────────────────────────────────────────

function describe(p: SchoolPlay): string {
  if (p.action === "fold") return "fold";
  if (p.action === "check") return "check";
  if (p.action === "call") return `call ${p.amount}`;
  if (p.action === "raise") return `raise to ${p.amount}`;
  return "all-in";
}

function finalize(triple: Triple0[], a: AvailableActions): [Triple0, Triple0, Triple0] {
  while (triple.length < 3) triple.push({ action: "fold", amount: 0, label: "fold" });
  const t3: [Triple0, Triple0, Triple0] = [
    legalize(triple[0]!, a),
    legalize(triple[1]!, a),
    legalize(triple[2]!, a),
  ];
  return deduplicate(t3, a);
}

/**
 * Permutation of [0,1,2] derived from `seed` (or Math.random when no
 * seed). Used to randomize letter ordering so position never reveals
 * which candidate is the school's answer.
 */
function shuffleIndices(seed: number | undefined): [number, number, number] {
  const order: [number, number, number] = [0, 1, 2];
  const rng = seed === undefined ? Math.random : mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
