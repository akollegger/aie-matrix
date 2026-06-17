/**
 * Artwork registry — RFC-0031.
 *
 * A work of art is a 2D image hung on a wall cell, with a description card
 * (an href to the work's museum object page) on an adjacent cell. The gram's
 * items layer authors WHERE each painting + card sit (as `Artwork` / `ArtCard`
 * items); this registry holds the per-work data the gram can't carry (image
 * URL, object-page href, title/artist/date), seeded once at startup from the
 * curated catalog.
 *
 * Looking at a painting (`inspect`) returns its image — fed to the ghost's
 * next cascade as a multimodal prompt. Reading a card (`read`, the ahref
 * function) dereferences its href into page text. The substrate only delivers
 * the artifact; the ghost chose to engage, and its cognition reacts unframed.
 *
 * A small module singleton (like `vendors.ts`): read in one place (the MCP
 * handlers), seeded once at boot.
 */

export interface ArtworkInfo {
  /** Stable perception id, `artwork-<cell>`. */
  readonly artworkId: string;
  /** Cell the painting hangs on. */
  readonly cell: string;
  /** Cell the description card sits on (adjacent; may equal `cell`). */
  readonly cardCell: string;
  /** Public-domain image URL (the literal prompt when looked at). */
  readonly imageUrl: string;
  /** Museum object-page URL — the card's href. */
  readonly objectUrl: string;
  readonly title: string;
  readonly artist: string;
  readonly date: string;
}

const byCell = new Map<string, ArtworkInfo>();
const byCardCell = new Map<string, ArtworkInfo>();

export function registerArtwork(info: ArtworkInfo): void {
  byCell.set(info.cell, info);
  byCardCell.set(info.cardCell, info);
}

/** Paintings hanging on a given cell — for a co-located ghost's perception. */
export function artworksOnCell(cell: string): ArtworkInfo[] {
  const a = byCell.get(cell);
  return a !== undefined ? [a] : [];
}

/** Description cards on a given cell. */
export function cardsOnCell(cell: string): ArtworkInfo[] {
  const a = byCardCell.get(cell);
  return a !== undefined ? [a] : [];
}

/** The first painting reachable from any of `cells` (the buyer's own cell,
 *  then its neighbours) — lets a ghost look at a painting it's standing at or
 *  beside without naming an opaque id. `cells[0]` should be the ghost's own
 *  cell so it wins ties. */
export function findReachableArtwork(cells: readonly string[]): ArtworkInfo | undefined {
  for (const c of cells) {
    const a = byCell.get(c);
    if (a !== undefined) return a;
  }
  return undefined;
}

export function getArtworkById(artworkId: string): ArtworkInfo | undefined {
  for (const a of byCell.values()) if (a.artworkId === artworkId) return a;
  return undefined;
}

export function listArtworks(): ArtworkInfo[] {
  return [...byCell.values()];
}

/** Test-only reset. */
export function _clearArtworks(): void {
  byCell.clear();
  byCardCell.clear();
}
