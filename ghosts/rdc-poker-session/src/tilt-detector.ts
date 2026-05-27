/**
 * Tilt detector — pure function that turns recent hand outcomes and
 * relative chip position into a tilt-pressure score, plus
 * enter/exit-state hysteresis flags.
 *
 * Two inputs (both per-seat, both bounded to a sliding window so this
 * stays a poker mechanic, not a long-memory grudge system):
 *
 *   1. `recentOutcomes`  — last N hand results for this ghost (typically 5).
 *      A losing streak builds tilt fast; a single bad beat shouldn't
 *      necessarily tip a player. The lossRate is `losses / outcomes`.
 *
 *   2. Chip stress     — how much smaller this ghost's stack is vs the
 *      table mean. Computed from `myChips`, `tableChips`, `seatCount`.
 *      A short stack feels desperation; a chip leader feels safe. The
 *      stress is `max(0, (meanShare - myShare) / meanShare)`.
 *
 * The two combine into raw pressure: `0.6 × lossRate + 0.4 × chipStress`.
 * Multiplied by `tiltSusceptibility` (a per-character constant 0..1 from
 * the slider profile) to produce an "effective tilt" — same losing streak
 * tilts a high-suscept Jackal far harder than a low-suscept Mouse.
 *
 * Two thresholds give hysteresis so a player doesn't flicker in and out
 * of tilt every hand:
 *   - enter  if effective > 0.40
 *   - exit   if effective < 0.20
 *
 * Whether the player ACTS poorly while tilted is up to the caller —
 * this module only reports the state. The per-turn poor-decision roll
 * lives in the decision pipeline.
 *
 * Pure function. No I/O, no Effect, no LLM. PR-portable.
 */

export interface TiltInputs {
  /** Sliding window of recent hand outcomes for this ghost. */
  readonly recentOutcomes: ReadonlyArray<"win" | "loss">;
  /** Chips this ghost currently holds at the table. */
  readonly myChips: number;
  /** Sum of all seated chip stacks (this ghost included). */
  readonly tableChips: number;
  /** Number of seats currently occupied (≥1). Used to compute mean share. */
  readonly seatCount: number;
  /** Persona constant 0..1 — how easily this character tilts. Higher
   *  = same pressure produces stronger effective tilt. */
  readonly tiltSusceptibility: number;
}

export interface TiltResult {
  /** Raw 0..1 pressure (before susceptibility scaling). Useful for
   *  overlay rendering / debugging — "is this player under pressure?" */
  readonly rawPressure: number;
  /** Susceptibility-scaled 0..1 score. The basis for enter/exit. */
  readonly effective: number;
  /** Loss rate component (0..1). */
  readonly lossRate: number;
  /** Chip-stress component (0..1, clamped at zero — chip leaders get 0). */
  readonly chipStress: number;
  /** Should a non-tilted seat ENTER tilt this hand? */
  readonly shouldEnter: boolean;
  /** Should a tilted seat EXIT tilt this hand? */
  readonly shouldExit: boolean;
}

const ENTER_THRESHOLD = 0.4;
const EXIT_THRESHOLD = 0.2;

export function computeTilt(input: TiltInputs): TiltResult {
  const window = input.recentOutcomes;
  const losses = window.filter((o) => o === "loss").length;
  const lossRate = window.length > 0 ? losses / window.length : 0;

  // When tableChips is zero (degenerate — no one has any chips yet,
  // probably just-seated) there's nothing to compare against, so the
  // chip-stress signal is meaningless. Treat as zero stress.
  const meanShare = input.seatCount > 0 ? 1 / input.seatCount : 0;
  const myShare = input.tableChips > 0 ? input.myChips / input.tableChips : 0;
  const chipStress =
    meanShare > 0 && input.tableChips > 0
      ? Math.max(0, (meanShare - myShare) / meanShare)
      : 0;

  const rawPressure = clamp01(lossRate * 0.6 + chipStress * 0.4);
  const effective = clamp01(rawPressure * input.tiltSusceptibility);

  return {
    rawPressure,
    effective,
    lossRate,
    chipStress: clamp01(chipStress),
    shouldEnter: effective > ENTER_THRESHOLD,
    shouldExit: effective < EXIT_THRESHOLD,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
