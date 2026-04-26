/**
 * @see `specs/011-intermedium-client/data-model.md` (ViewState)
 * @see FR-004
 */

export type Scale = "map" | "area" | "neighbor" | "partner" | "ghost";

export interface ViewState {
  readonly scale: Scale;
  /** `null` at `map` scale; region (H3 id) or ghost id for deeper scales. */
  readonly focus: string | null;
}
