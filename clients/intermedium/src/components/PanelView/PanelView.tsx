import type { ViewState } from "../../types/viewState.js";
import type { HumanPairing } from "../../types/ghost.js";
import { AreaPanel } from "./AreaPanel.js";
import { NeighborPanel } from "./NeighborPanel.js";
import { PersonalPanel } from "./PersonalPanel.js";

export interface PanelViewProps {
  readonly viewState: ViewState;
  readonly pairing: HumanPairing | null;
}

/**
 * Overlay panes per stop (FR-003). The deck.gl world stays full-bleed behind;
 * this is only the panel side — not a resizable flex column.
 */
export function PanelView({ viewState, pairing }: PanelViewProps) {
  // Exterior stops and Plan have no panel.
  if (
    viewState.stop === "global" ||
    viewState.stop === "regional" ||
    viewState.stop === "plan"
  ) {
    return null;
  }
  if (viewState.stop === "room") {
    return <AreaPanel />;
  }
  if (viewState.stop === "situational") {
    return <NeighborPanel />;
  }
  if (viewState.stop === "personal") {
    if (pairing === null) return null;
    return <PersonalPanel />;
  }
  return null;
}
