/**
 * @see `specs/011-intermedium-client/data-model.md` (ProximityCluster)
 */

import type { GhostIdentity } from "./ghost.js";

export interface ProximityCluster {
  readonly focusGhostId: string;
  /** H3 res-15 indices in the 7-hex focus neighbourhood (ring 1). */
  readonly neighbors: readonly string[];
  readonly ghostsInCluster: readonly GhostIdentity[];
}
