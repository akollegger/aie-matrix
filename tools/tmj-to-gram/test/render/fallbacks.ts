/**
 * Static fill colors for sandbox tile types when the `.tsx` tileset does not
 * carry a `color` property (Layer 3 parity uses the same table on TMJ and gram paths).
 *
 * **Rule**: When you add a sandbox fixture that introduces a new `type="…"` label,
 * add a row here (or add `color` on the tile in Tiled so `buildTileMetaFromSlices` supplies it).
 */
const TILE_HEX: Readonly<Record<string, string>> = {
  Blue: "#2196F3",
  Cyan: "#00BCD4",
  Green: "#4CAF50",
  Yellow: "#FFEB3B",
  Red: "#F44336",
  Purple: "#9C27B0",
  White: "#ECEFF1",
  Gray1: "#90A4AE",
  Gray2: "#607D8B",
  Blue2: "#1E88E5",
  Cyan2: "#00ACC1",
  Green2: "#43A047",
  Yellow2: "#FDD835",
  Red2: "#E53935",
  Purple2: "#8E24AA",
  Blue3: "#1565C0",
  Cyan3: "#00838F",
  Green3: "#2E7D32",
  Yellow3: "#F9A825",
  Red3: "#C62828",
  Purple3: "#6A1B9A",
  Grad1: "#B39DDB",
  Grad2: "#80CBC4",
  Grad3: "#FFCC80",
};

/** Deterministic RGBA for item marker raster (emoji shapes are skipped for stable pixels). */
const ITEM_MARKER_RGBA: Readonly<Record<string, readonly [number, number, number, number]>> = {
  Key: [30, 30, 30, 255],
  Sign: [120, 60, 20, 255],
  Obstacle: [90, 90, 90, 255],
  Badge: [160, 40, 160, 255],
};

export function tileFillHex(typeLabel: string, fromTileset?: string | undefined): string {
  if (fromTileset !== undefined && fromTileset.length > 0) {
    return fromTileset;
  }
  const c = TILE_HEX[typeLabel];
  if (c !== undefined) {
    return c;
  }
  let h = 0;
  for (let i = 0; i < typeLabel.length; i++) {
    h = (h * 31 + typeLabel.charCodeAt(i)!) >>> 0;
  }
  const rgb = 0x808080 ^ (h & 0xffffff);
  return `#${(0x1000000 + rgb).toString(16).slice(-6)}`;
}

export function itemMarkerRgba(itemClass: string): readonly [number, number, number, number] {
  return ITEM_MARKER_RGBA[itemClass] ?? [40, 40, 120, 255];
}
