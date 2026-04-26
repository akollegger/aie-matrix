/**
 * @see `specs/011-intermedium-client/data-model.md` (ClientState, composed)
 */

import type { ConversationThread } from "./conversation.js";
import type { GhostInteriority, HumanPairing, GhostIdentity } from "./ghost.js";
import type { GhostPosition } from "./ghostPosition.js";
import type { WorldTile } from "./worldTile.js";
import type { ViewState } from "./viewState.js";
import type { ColyseusLinkState, MapGramStatus } from "./spectator.js";
import type { ViewNavigation } from "./navigation.js";

export type { ViewState, GhostPosition, HumanPairing, WorldTile, GhostIdentity };
export type { ColyseusLinkState, MapGramStatus };
export type { PickTarget, ViewNavigation } from "./navigation.js";

export interface ClientState {
  readonly viewState: ViewState;
  /** US2+ zoom, pick target, Enter/Escape. */
  readonly nav: ViewNavigation;
  readonly ghosts: ReadonlyMap<string, GhostPosition>;
  /** Catalog-derived public identity, keyed by ghostId. */
  readonly identities: ReadonlyMap<string, GhostIdentity>;
  /** Parsed map cells, keyed by H3 index. */
  readonly tiles: ReadonlyMap<string, WorldTile>;
  readonly thread: ConversationThread | null;
  readonly interiority: GhostInteriority | null;
  readonly pairing: HumanPairing | null;
  readonly mapGramStatus: MapGramStatus;
  readonly mapGramError: string | null;
  readonly colyseusLinkState: ColyseusLinkState;
  /** Retry map fetch (FR-023). */
  readonly retryMapLoad: () => void;
}
