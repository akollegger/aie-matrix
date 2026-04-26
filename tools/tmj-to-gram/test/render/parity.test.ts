import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { gramPathToRenderModel } from "./gram-adapter.js";
import { renderParityPng } from "./svg-renderer.js";
import { tmjPathToRenderModel } from "./tmj-adapter.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const sandboxDir = join(repoRoot, "maps/sandbox");
const goldenDir = fileURLToPath(new URL("golden", import.meta.url));

function sandboxTmjStems(): string[] {
  return readdirSync(sandboxDir)
    .filter((f) => f.endsWith(".tmj"))
    .map((f) => f.replace(/\.tmj$/i, ""));
}

function mapsEqual(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [k, v] of a) {
    if (b.get(k) !== v) {
      return false;
    }
  }
  return true;
}

function sortItems<T extends { h3: string; itemClass: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    a.h3 < b.h3 ? -1 : a.h3 > b.h3 ? 1 : a.itemClass.localeCompare(b.itemClass),
  );
}

describe("Layer 3 visual parity (TMJ vs committed gram)", () => {
  for (const stem of sandboxTmjStems()) {
    it(`${stem}: terrain + items match; PNG pixel-diff is zero`, async () => {
      const tmjPath = join(sandboxDir, `${stem}.tmj`);
      const gramPath = join(sandboxDir, `${stem}.map.gram`);

      const tmjModel = await tmjPathToRenderModel(tmjPath);
      const gramModel = await gramPathToRenderModel(gramPath, tmjModel.frame);

      expect(mapsEqual(tmjModel.terrain, gramModel.terrain)).toBe(true);
      expect(sortItems(tmjModel.items)).toEqual(sortItems(gramModel.items));

      const a = renderParityPng(tmjModel);
      const b = renderParityPng(gramModel);
      const imgA = PNG.sync.read(a);
      const imgB = PNG.sync.read(b);
      expect(imgA.width).toBe(imgB.width);
      expect(imgA.height).toBe(imgB.height);

      const diffAb = new Uint8ClampedArray(imgA.width * imgA.height * 4);
      const diffTmGram = pixelmatch(imgA.data, imgB.data, diffAb, imgA.width, imgA.height, {
        threshold: 0,
        includeAA: false,
      });
      expect(diffTmGram, `TMJ vs gram PNG mismatch for ${stem}`).toBe(0);

      const goldenPath = join(goldenDir, `${stem}.png`);
      if (process.env.REGEN_VISUAL_GOLDENS === "1") {
        mkdirSync(goldenDir, { recursive: true });
        writeFileSync(goldenPath, a);
      }

      const expected = readFileSync(goldenPath);
      const imgE = PNG.sync.read(expected);
      expect(imgE.width).toBe(imgA.width);
      expect(imgE.height).toBe(imgA.height);

      const diffGolden = new Uint8ClampedArray(imgA.width * imgA.height * 4);
      const numDiffGolden = pixelmatch(imgA.data, imgE.data, diffGolden, imgA.width, imgA.height, {
        threshold: 0,
        includeAA: false,
      });
      expect(
        numDiffGolden,
        `golden PNG drift for ${stem} — run pnpm --filter @aie-matrix/tmj-to-gram golden:regen`,
      ).toBe(0);
    });
  }
});
