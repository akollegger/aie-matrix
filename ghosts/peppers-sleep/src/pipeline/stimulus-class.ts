/**
 * Stimulus-class normaliser.
 *
 * The world emits stimuli with location qualifiers ("Food in view at
 * here", "Food in view at ne", "entered Blue at 8f283082aa20cb0").
 * For policy purposes those are the same stimulus class — the prior
 * synthesis agent flagged qualifier noise as the #1 source of missed
 * matches in contradiction detection.
 *
 * Grammar observed in live ReasoningTrace.task values:
 *   "respond to: <stimulus>"            — trace task prefix
 *   "<Thing> in view at here|n|ne|…"    — item sighting
 *   "entered <Region> at 8f<hex>"       — cell entry
 *   "cluster entered: <Random Name>"    — cluster entry (names are random)
 *   "idle for 5s"                       — idle tick
 *   "<Display Name>: <utterance>"       — peer speech
 *
 * Used by: contradiction judge input prep, entropy measurement,
 * cascade-time skill matching. One implementation, three consumers.
 */

const TASK_PREFIX = /^respond to:\s*/;
const COMPASS = "here|n|ne|e|se|s|sw|w|nw";
const TRAILING_LOCATION = new RegExp(`\\s+at\\s+(?:${COMPASS}|8f[0-9a-f]+)\\s*$`, "i");
const IDLE = /^idle for \d+(?:\.\d+)?s$/i;
const CLUSTER_ENTERED = /^cluster entered:\s*.+$/i;
const CLUSTER_LEFT = /^cluster left:\s*.+$/i;
/** "Name Surname: text" — display names are 1-4 capitalised words. */
const PEER_UTTERANCE = /^[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3}:\s+\S/;

/**
 * Normalise a raw stimulus (or ReasoningTrace.task) to its class.
 * Idempotent; safe to call on already-normalised strings.
 */
export function normalizeStimulusClass(raw: string): string {
  let s = raw.trim().replace(TASK_PREFIX, "");
  if (IDLE.test(s)) return "idle";
  if (CLUSTER_ENTERED.test(s)) return "cluster entered";
  if (CLUSTER_LEFT.test(s)) return "cluster left";
  if (PEER_UTTERANCE.test(s)) return "peer utterance";
  s = s.replace(TRAILING_LOCATION, "");
  return s.trim();
}

/**
 * Strip location qualifiers from free prose (consolidation bullet
 * text) without otherwise re-shaping it. Applied to the judge's
 * INPUT only — the stored Consolidation content is never mutated.
 */
export function stripLocationQualifiers(text: string): string {
  const inline = new RegExp(`\\bat\\s+(?:${COMPASS})\\b`, "gi");
  const cells = /\bat\s+8f[0-9a-f]+\b/gi;
  return text.replace(inline, "").replace(cells, "").replace(/[ \t]{2,}/g, " ");
}
