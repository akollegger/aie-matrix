/**
 * @see `specs/011-intermedium-client/spec.md` FR-014 / US2 navigation
 */
export type PickTarget = { type: "tile"; h3: string } | { type: "ghost"; ghostId: string };
export type ArrowDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export interface ViewNavigation {
  /** Hover / keyboard "selection" (Enter) context for FR-014. */
  readonly pickTarget: PickTarget | null;
  readonly setPickTarget: (p: PickTarget | null) => void;
  /** Advance one stop forward in the ordered sequence (zoom-in key). */
  readonly cycleIn: () => void;
  /** Jump from Plan/Room to Room/Situational focused on a tile (double-click tile). */
  readonly zoomInFromTile: (h3: string) => void;
  /** Jump from Situational to Personal focused on a ghost (double-click ghost). */
  readonly zoomInFromGhost: (ghostId: string) => void;
  readonly zoomOut: () => void;
  /** Fire the zoom-in for the current pickTarget (Enter key). */
  readonly triggerEnterZoom: () => void;
  /** Move focus to the neighboring H3 cell in the given direction (Room stop arrow keys). */
  readonly moveFocus: (dir: ArrowDirection) => void;
  /** Re-center the Room focus on a specific tile without changing stop (double-click in Room). */
  readonly relocateFocus: (h3: string) => void;
  /** Set the fallback focus cell used when viewState.focus is null (e.g. after cycleIn to Room). */
  readonly setDefaultFocus: (h3: string | null) => void;
}
