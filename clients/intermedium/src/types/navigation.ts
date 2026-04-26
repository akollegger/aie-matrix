/**
 * @see `specs/011-intermedium-client/data-model.md` (ViewState) / US2 navigation
 */
export type PickTarget = { type: "tile"; h3: string } | { type: "ghost"; ghostId: string };

export interface ViewNavigation {
  /** Hover / keyboard “selection” (Enter) context for FR-014. */
  readonly pickTarget: PickTarget | null;
  readonly setPickTarget: (p: PickTarget | null) => void;
  readonly zoomInFromMapTile: (h3: string) => void;
  readonly zoomInFromAreaGhost: (ghostId: string) => void;
  readonly zoomOut: () => void;
  /** If Enter should fire a zoom; implemented in `useViewState`. */
  readonly triggerEnterZoom: () => void;
}
