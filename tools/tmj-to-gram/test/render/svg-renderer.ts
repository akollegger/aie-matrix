import { cellToLocalIj, localIjToCell } from "h3-js";
import { PNG } from "pngjs";
import { hexRenderParams, tileToScreenPolygon } from "../../src/converter/tiled-hex-grid.js";
import type { HexRenderParams } from "../../src/converter/tiled-hex-grid.js";
import { itemMarkerRgba, tileFillHex } from "./fallbacks.js";
import type { HexMapFrame, ParityRenderModel } from "./render-model.js";

export interface CanvasLayout {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly hexP: HexRenderParams;
}

function pointInPolygon(px: number, py: number, poly: ReadonlyArray<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const dy = yj - yi;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (Math.abs(dy) < 1e-12 ? 1e-12 : dy) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    return [200, 200, 200];
  }
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function computeCanvasLayout(frame: HexMapFrame): CanvasLayout {
  const { ctx, mapWidth, mapHeight } = frame;
  const hexP = hexRenderParams(
    ctx.tilewidth,
    ctx.tileheight,
    ctx.hexsidelength,
    ctx.staggeraxis,
    ctx.staggerindex,
  );
  if (hexP === undefined) {
    throw new Error("hexRenderParams returned undefined (unsupported staggeraxis?)");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      for (const pt of tileToScreenPolygon(col, row, hexP)) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }
  }
  const pad = 6;
  const offsetX = -minX + pad;
  const offsetY = -minY + pad;
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad);
  return { width, height, offsetX, offsetY, hexP };
}

function shiftPoly(poly: Array<{ x: number; y: number }>, ox: number, oy: number): Array<{ x: number; y: number }> {
  return poly.map((p) => ({ x: p.x + ox, y: p.y + oy }));
}

function centroid(poly: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

function fillPolygonRgba(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  poly: ReadonlyArray<{ x: number; y: number }>,
  rgba: readonly [number, number, number, number],
): void {
  let minPX = Infinity;
  let minPY = Infinity;
  let maxPX = -Infinity;
  let maxPY = -Infinity;
  for (const p of poly) {
    minPX = Math.min(minPX, p.x);
    minPY = Math.min(minPY, p.y);
    maxPX = Math.max(maxPX, p.x);
    maxPY = Math.max(maxPY, p.y);
  }
  const x0 = Math.max(0, Math.floor(minPX));
  const y0 = Math.max(0, Math.floor(minPY));
  const x1 = Math.min(width - 1, Math.ceil(maxPX));
  const y1 = Math.min(height - 1, Math.ceil(maxPY));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, poly)) {
        const o = (y * width + x) * 4;
        buf[o] = rgba[0]!;
        buf[o + 1] = rgba[1]!;
        buf[o + 2] = rgba[2]!;
        buf[o + 3] = rgba[3]!;
      }
    }
  }
}

function fillRectRgba(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  half: number,
  rgba: readonly [number, number, number, number],
): void {
  const x0 = Math.max(0, Math.floor(cx - half));
  const y0 = Math.max(0, Math.floor(cy - half));
  const x1 = Math.min(width - 1, Math.ceil(cx + half));
  const y1 = Math.min(height - 1, Math.ceil(cy + half));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * width + x) * 4;
      buf[o] = rgba[0]!;
      buf[o + 1] = rgba[1]!;
      buf[o + 2] = rgba[2]!;
      buf[o + 3] = rgba[3]!;
    }
  }
}

/** Flat-color SVG (human inspection). Pixel parity uses {@link renderParityPng} (same geometry). */
export function renderSvg(model: ParityRenderModel): string {
  const { frame, terrain, items, tileColorsFromGram } = model;
  const { width, height, offsetX, offsetY, hexP } = computeCanvasLayout(frame);
  const { mapWidth, mapHeight, ctx } = frame;
  const pieces: string[] = [];

  const cells: Array<{ col: number; row: number; type: string }> = [];
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      let h3: string;
      try {
        h3 = localIjToCell(ctx.h3Anchor, { i: col, j: row });
      } catch {
        continue;
      }
      const t = terrain.get(h3);
      if (t === undefined) {
        continue;
      }
      cells.push({ col, row, type: t });
    }
  }
  cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  for (const c of cells) {
    const poly = shiftPoly([...tileToScreenPolygon(c.col, c.row, hexP)], offsetX, offsetY);
    const pts = poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const hex = tileFillHex(c.type, tileColorsFromGram?.get(c.type));
    pieces.push(`<polygon fill="${hex}" stroke="#222" stroke-width="0.25" points="${pts}" />`);
  }

  for (const it of items) {
    let ij: { i: number; j: number };
    try {
      ij = cellToLocalIj(ctx.h3Anchor, it.h3);
    } catch {
      continue;
    }
    const poly = shiftPoly([...tileToScreenPolygon(ij.i, ij.j, hexP)], offsetX, offsetY);
    const c = centroid(poly);
    const rgba = itemMarkerRgba(it.itemClass);
    const fill = `rgb(${rgba[0]},${rgba[1]},${rgba[2]})`;
    pieces.push(
      `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="3.5" fill="${fill}" stroke="#fff" stroke-width="0.5" />`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${pieces.join("\n")}\n</svg>\n`;
}

/** Deterministic PNG raster for `pixelmatch` (flat fills + item markers; no emoji text). */
export function renderParityPng(model: ParityRenderModel): Buffer {
  const { frame, terrain, items, tileColorsFromGram } = model;
  const { width, height, offsetX, offsetY, hexP } = computeCanvasLayout(frame);
  const { mapWidth, mapHeight, ctx } = frame;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  const cells: Array<{ col: number; row: number; type: string }> = [];
  for (let row = 0; row < mapHeight; row++) {
    for (let col = 0; col < mapWidth; col++) {
      let h3: string;
      try {
        h3 = localIjToCell(ctx.h3Anchor, { i: col, j: row });
      } catch {
        continue;
      }
      const t = terrain.get(h3);
      if (t === undefined) {
        continue;
      }
      cells.push({ col, row, type: t });
    }
  }
  cells.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  for (const c of cells) {
    const poly = shiftPoly([...tileToScreenPolygon(c.col, c.row, hexP)], offsetX, offsetY);
    const hex = tileFillHex(c.type, tileColorsFromGram?.get(c.type));
    const [r, g, b] = hexToRgb(hex);
    fillPolygonRgba(data, width, height, poly, [r, g, b, 255]);
  }

  for (const it of items) {
    let ij: { i: number; j: number };
    try {
      ij = cellToLocalIj(ctx.h3Anchor, it.h3);
    } catch {
      continue;
    }
    const poly = shiftPoly([...tileToScreenPolygon(ij.i, ij.j, hexP)], offsetX, offsetY);
    const c = centroid(poly);
    fillRectRgba(data, width, height, c.x, c.y, 3.5, [...itemMarkerRgba(it.itemClass)] as [number, number, number, number]);
  }

  const png = new PNG({ width, height });
  png.data.set(data);
  return PNG.sync.write(png);
}
