import { IconLayer } from "@deck.gl/layers";
import { cellToLatLng } from "h3-js";
import type { WorldTile } from "../types/worldTile.js";

type IconMapEntry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mask: boolean;
  readonly anchorX: number;
  readonly anchorY: number;
};

type AtlasMap = Record<string, IconMapEntry>;

export type IconTile = {
  readonly h3Index: string;
  readonly kind: "vendor" | "session" | "lounge" | "other";
  readonly position: [number, number, number];
};

let semanticAtlas: { src: string; mapping: AtlasMap } | null = null;

/**
 * 4 small glyphs in a row for vendor/session/lounge/other.
 */
function getSemanticIconAtlas(): { src: string; mapping: AtlasMap } {
  if (semanticAtlas) {
    return semanticAtlas;
  }
  if (typeof document === "undefined") {
    const e: IconMapEntry = { x: 0, y: 0, width: 1, height: 1, mask: false, anchorX: 0, anchorY: 0 };
    const m: AtlasMap = { v: e, s: e, l: e, o: e };
    semanticAtlas = { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9l8cAAAAASUVORK5CYII=", mapping: m };
    return semanticAtlas;
  }
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 8;
  const ctx = c.getContext("2d")!;
  const colors = ["#5ec8ff", "#8feda3", "#ffd080", "#d4b8ff"] as const;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = colors[i] ?? "#fff";
    ctx.beginPath();
    ctx.arc(4 + i * 8, 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const src = c.toDataURL("image/png");
  const mapping: AtlasMap = {
    v: { x: 0, y: 0, width: 8, height: 8, mask: false, anchorX: 4, anchorY: 4 },
    s: { x: 8, y: 0, width: 8, height: 8, mask: false, anchorX: 4, anchorY: 4 },
    l: { x: 16, y: 0, width: 8, height: 8, mask: false, anchorX: 4, anchorY: 4 },
    o: { x: 24, y: 0, width: 8, height: 8, mask: false, anchorX: 4, anchorY: 4 },
  };
  semanticAtlas = { src, mapping };
  return semanticAtlas;
}

function classify(t: WorldTile): "vendor" | "session" | "lounge" | "other" {
  const x = t.tileType.toLowerCase();
  if (x.includes("vendor") || x.includes("booth")) {
    return "vendor";
  }
  if (x.includes("session") || x.includes("room")) {
    return "session";
  }
  if (x.includes("lounge") || x.includes("corridor")) {
    return "lounge";
  }
  if (t.items.length > 0) {
    return "other";
  }
  return "other";
}

function toIconId(k: ReturnType<typeof classify>): "v" | "s" | "l" | "o" {
  if (k === "vendor") {
    return "v";
  }
  if (k === "session") {
    return "s";
  }
  if (k === "lounge") {
    return "l";
  }
  return "o";
}

export function buildIconTileData(
  tiles: ReadonlyMap<string, WorldTile>,
  filter: (t: WorldTile) => boolean = (t) =>
    t.items.length > 0 || /vendor|session|lounge|booth|room|corridor/i.test(t.tileType),
): IconTile[] {
  const out: IconTile[] = [];
  for (const t of tiles.values()) {
    if (!filter(t)) {
      continue;
    }
    const [lat, lng] = cellToLatLng(t.h3Index);
    out.push({
      h3Index: t.h3Index,
      kind: classify(t),
      position: [lng, lat, 0],
    });
  }
  return out;
}

export function createTileIconLayer(data: readonly IconTile[], id = "tile-icons"): IconLayer<IconTile> {
  const { src, mapping } = getSemanticIconAtlas();
  return new IconLayer<IconTile>({
    id,
    data,
    pickable: false,
    iconAtlas: src,
    iconMapping: mapping,
    getPosition: (d) => d.position,
    getIcon: (d) => toIconId(d.kind),
    getSize: 22,
    sizeMinPixels: 8,
    sizeMaxPixels: 32,
  });
}
