/**
 * @see `specs/011-intermedium-client/data-model.md` (GhostPosition)
 * @see IC-001
 */

export interface GhostPosition {
  readonly ghostId: string;
  readonly h3Index: string;
  readonly previousH3Index?: string;
}
