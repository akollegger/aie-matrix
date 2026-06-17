/**
 * Felt-language translation at the prompt/tool boundary.
 *
 * The substrate's clock is the cascade counter (an integer). The agent
 * should never see that number — it sees vocabulary words. This file
 * is the single mapping from gap (currentCascade - pastCascade) to a
 * vocabulary string. All callers in `reason-surface.ts` route through
 * here so the translation is consistent everywhere.
 *
 * Tune the bands by editing only this file.
 */

export type FeltDuration =
  | "this cascade"
  | "just now"
  | "a moment ago"
  | "earlier"
  | "a while back"
  | "some time ago"
  | "a long time ago"
  | "you can't quite remember when";

export function feltDurationFromGap(gap: number): FeltDuration {
  if (!Number.isFinite(gap) || gap < 0) return "you can't quite remember when";
  if (gap === 0) return "this cascade";
  if (gap === 1) return "just now";
  if (gap <= 3) return "a moment ago";
  if (gap <= 8) return "earlier";
  if (gap <= 20) return "a while back";
  if (gap <= 50) return "some time ago";
  return "a long time ago";
}

/** Shorthand for callers that have current + past cascade indexes. */
export function feltDurationBetween(currentCascade: number, pastCascade: number): FeltDuration {
  return feltDurationFromGap(currentCascade - pastCascade);
}

/** Honest fallback when the substrate hasn't supplied a cascade index. */
export function unknownFeltDuration(): FeltDuration {
  return "you can't quite remember when";
}
