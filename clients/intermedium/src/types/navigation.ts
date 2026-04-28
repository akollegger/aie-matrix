/**
 * @see `specs/011-intermedium-client/spec.md` FR-014 / US2 navigation
 */
export type PickTarget = { type: "tile"; h3: string } | { type: "ghost"; ghostId: string };

export interface ViewNavigation {
  /** Hover / keyboard "selection" (Enter) context for FR-014. */
  readonly pickTarget: PickTarget | null;
  readonly setPickTarget: (p: PickTarget | null) => void;
  /** Advance one stop forward in the ordered sequence (zoom-in key). */
  readonly cycleIn: () => void;
  /** Jump from Plan/Room to Situational focused on a tile (double-click tile). */
  readonly zoomInFromTile: (h3: string) => void;
  /** Jump from Situational to Personal focused on a ghost (double-click ghost). */
  readonly zoomInFromGhost: (ghostId: string) => void;
  readonly zoomOut: () => void;
  /** Fire the zoom-in for the current pickTarget (Enter key). */
  readonly triggerEnterZoom: () => void;
}
