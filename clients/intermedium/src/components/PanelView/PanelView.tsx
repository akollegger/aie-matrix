import type { ViewState } from "../../types/viewState.js";
import type { HumanPairing } from "../../types/ghost.js";
import { AreaPanel } from "./AreaPanel.js";
import { NeighborPanel } from "./NeighborPanel.js";
import { PartnerPanel } from "./PartnerPanel.js";
import { GhostPanel } from "./GhostPanel.js";

export interface PanelViewProps {
  readonly viewState: ViewState;
  readonly pairing: HumanPairing | null;
}

/**
 * Overlay panes for scales below `map` (FR-003). The deck.gl world stays full-bleed behind; this
 * is only the panel side — not a resizable flex column.
 */
export function PanelView({ viewState, pairing }: PanelViewProps) {
  if (viewState.scale === "map") {
    return null;
  }
  if (viewState.scale === "area") {
    return <AreaPanel />;
  }
  if (viewState.scale === "neighbor") {
    return <NeighborPanel />;
  }
  if (viewState.scale === "partner") {
    if (pairing === null) {
      return null;
    }
    return <PartnerPanel />;
  }
  if (viewState.scale === "ghost") {
    if (pairing === null) {
      return null;
    }
    return <GhostPanel />;
  }
  return null;
}
