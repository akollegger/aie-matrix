/**
 * Single source of truth for rendering a `Stimulus` as a one-line
 * string. Used by every Id-pipeline stage (facet / convergence /
 * synthesis / impulse) so the same trigger reads identically across
 * agents.
 *
 * `run-house.ts` and `reason-surface.ts` keep their own variants —
 * they have specialised framings (e.g., the Surface adds a "go choose
 * a verb" hint to idle stimuli) that don't belong in the Id chain.
 */

import type { Stimulus } from "@aie-matrix/ghost-peppers-inner";

export function formatStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return `${s.from} says: "${s.text}"`;
    case "cluster-entered":
      return `Ghosts entered cluster: ${s.ghostIds.join(", ")}`;
    case "cluster-left":
      return `Ghosts left cluster: ${s.ghostIds.join(", ")}`;
    case "mcguffin-in-view":
      return `${s.itemRef} appears at ${s.at}`;
    case "tile-entered":
      return `Stepped onto a ${s.tileClass} tile`;
    case "idle":
      return `Quiet for ${Math.round(s.quietForMs / 1000)}s`;
  }
}
