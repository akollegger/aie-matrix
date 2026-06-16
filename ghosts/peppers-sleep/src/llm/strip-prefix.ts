/**
 * Strip the "<speaker>: " prefix that agent-memory writes onto
 * incoming-utterance messages. Used to compute an intent embedding
 * that captures what was said rather than who said it.
 *
 * Examples that get stripped:
 *   "Clint Edgewood: Maybe. I'm just doing the rounds…"
 *   "ghost_b1e9b566: Evening. I'm…"
 *   "Sergeant Hartman: Listen up, recruit."
 *
 * Examples that pass through (no leading "<word>: " pattern):
 *   "Sheriff Hashbrown. You headed for Black Bart's poker?"
 *   "Hey, what's going on?"
 *
 * The regex caps the speaker capture at 60 chars to avoid eating
 * the first clause of an unprefixed message that happens to contain
 * a colon.
 */
const SPEAKER_PREFIX = /^[^:\n]{1,60}: /;

export function stripSpeakerPrefix(content: string): string {
  return content.replace(SPEAKER_PREFIX, "");
}
