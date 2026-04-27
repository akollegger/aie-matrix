/**
 * @see `specs/011-intermedium-client/spec.md` FR-003, FR-004
 * @see `specs/011-intermedium-client/mockups/00-stop-transitions.pdf`
 */

/** Exterior stops: deck.gl, extruded board, ghosts invisible. */
export type ExteriorStop = "global" | "regional";

/** Interior stops: deck.gl, flat tiles, ghosts visible. */
export type InteriorStop = "plan" | "room" | "situational";

/** Personal stop: React Three Fiber, non-geospatial (ADR-0006, FR-029). */
export type PersonalStop = "personal";

export type CameraStop = ExteriorStop | InteriorStop | PersonalStop;

export interface ViewState {
  readonly stop: CameraStop;
  /** `null` for fixed-center stops; tile H3 index or ghost ID for Situational / Personal. */
  readonly focus: string | null;
}
