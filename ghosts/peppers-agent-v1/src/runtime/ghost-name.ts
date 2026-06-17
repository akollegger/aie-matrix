/**
 * Tiny deterministic name generator for peppers ghosts.
 *
 * Default dictionaries: adjective + colour + animal, capitalised and
 * space-separated — e.g. "Brave Crimson Otter", "Quiet Slate Heron".
 * Gives every ghost a recognisably-human handle so the LLM never falls
 * back to "ghost-<hex prefix>" in self-references.
 *
 * Names are seeded by the ghostId so the same ghost gets the same name
 * across restarts (handy when debugging cascade logs across sessions).
 * Seeding uses a small hash of the ghostId; not cryptographic, just
 * stable.
 */
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
  type Config,
} from "unique-names-generator";

const NAME_CONFIG: Config = {
  dictionaries: [adjectives, colors, animals],
  separator: " ",
  style: "capital",
  length: 3,
};

/** Stable 32-bit hash of an arbitrary string. Not cryptographic. */
function hashSeed(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Produce a stable, human-friendly name for a ghost. Seeded by ghostId
 * so calling this multiple times with the same id returns the same
 * name. Pass a non-empty `salt` to vary names within a single demo
 * session if collisions matter (e.g. an index per spawn).
 */
export function generateGhostName(ghostId: string, salt: string | number = ""): string {
  const seedInput = salt === "" ? ghostId : `${ghostId}:${salt}`;
  return uniqueNamesGenerator({
    ...NAME_CONFIG,
    seed: hashSeed(seedInput),
  });
}
