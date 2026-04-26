import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const cliJs = join(repoRoot, "tools/tmj-to-gram/dist/main.js");
const colorSetSrc = join(repoRoot, "maps/sandbox/color-set.tsx");
const mapWithPolygons = join(repoRoot, "maps/sandbox/map-with-polygons.tmj");

function runConvert(args: string[], cwd: string = repoRoot): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, [cliJs, "convert", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

let cleanupDir: string | undefined;

afterEach(async () => {
  if (cleanupDir !== undefined) {
    await rm(cleanupDir, { recursive: true, force: true });
    cleanupDir = undefined;
  }
});

async function prepDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tmj-poly-"));
  cleanupDir = dir;
  await writeFile(join(dir, "color-set.tsx"), await readFile(colorSetSrc));
  return dir;
}

function layoutLayer(): Record<string, unknown> {
  const data = Array(25).fill(5);
  return {
    class: "layout",
    data,
    height: 5,
    width: 5,
    id: 1,
    name: "layout",
    opacity: 1,
    type: "tilelayer",
    visible: true,
    x: 0,
    y: 0,
  };
}

function baseMap(objects: unknown[]): Record<string, unknown> {
  return {
    compressionlevel: -1,
    height: 5,
    hexsidelength: 14,
    infinite: false,
    layers: [
      layoutLayer(),
      {
        class: "tile-area",
        draworder: "topdown",
        id: 2,
        name: "areas",
        objects,
        opacity: 1,
        type: "objectgroup",
        visible: true,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 3,
    nextobjectid: 10,
    orientation: "hexagonal",
    properties: [
      { name: "h3_anchor", type: "string", value: "8f2830828052d25" },
      { name: "h3_resolution", type: "int", value: 15 },
    ],
    renderorder: "right-down",
    staggeraxis: "x",
    staggerindex: "odd",
    tiledversion: "1.12.1",
    tileheight: 28,
    tilesets: [{ firstgid: 1, source: "color-set.tsx" }],
    tilewidth: 32,
    type: "map",
    version: "1.10",
    width: 5,
  };
}

describe("tile-area CLI geometry errors", () => {
  it("ellipse object exits 2 naming id and name", async () => {
    const dir = await prepDir();
    const tmj = join(dir, "e.tmj");
    await writeFile(
      tmj,
      JSON.stringify(
        baseMap([
          {
            id: 7,
            name: "roundy",
            type: "Red",
            x: 40,
            y: 40,
            width: 32,
            height: 28,
            ellipse: true,
            rotation: 0,
            visible: true,
          },
        ]),
      ),
      "utf8",
    );
    const { status, stderr } = runConvert([tmj]);
    expect(status).toBe(2);
    expect(stderr).toContain("[error]");
    expect(stderr).toContain("id=7");
    expect(stderr).toContain("name=roundy");
    expect(stderr).toMatch(/ellipse/i);
  });

  it("gutter vertex exits 2 with id, vertex index, and pixel", async () => {
    const dir = await prepDir();
    const tmj = join(dir, "g.tmj");
    await writeFile(
      tmj,
      JSON.stringify(
        baseMap([
          {
            id: 3,
            name: "bad-poly",
            type: "Red",
            x: 10,
            y: 10,
            width: 0,
            height: 0,
            rotation: 0,
            visible: true,
            polygon: [
              { x: 0, y: 0 },
              { x: 30, y: 0 },
              { x: 99_999, y: 99_999 },
            ],
          },
        ]),
      ),
      "utf8",
    );
    const { status, stderr } = runConvert([tmj]);
    expect(status).toBe(2);
    expect(stderr).toContain("[error]");
    expect(stderr).toContain("id=3");
    expect(stderr).toMatch(/vertex\s+2/i);
    expect(stderr).toMatch(/100009/);
    expect(stderr).toMatch(/gutter/i);
  });

  it("overlapping tile-areas exit 2 naming both ids and overlap count", async () => {
    const dir = await prepDir();
    const tmj = join(dir, "o.tmj");
    await writeFile(
      tmj,
      JSON.stringify(
        baseMap([
          {
            id: 10,
            name: "a",
            type: "Red",
            x: 20,
            y: 20,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
          },
          {
            id: 11,
            name: "b",
            type: "Red",
            x: 20,
            y: 20,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
          },
        ]),
      ),
      "utf8",
    );
    const { status, stderr } = runConvert([tmj]);
    expect(status).toBe(2);
    expect(stderr).toContain("[error]");
    expect(stderr).toContain("id=10");
    expect(stderr).toContain("id=11");
    expect(stderr).toMatch(/share\s+\d+\s+cell/i);
  });

  it("map-with-polygons fixture exits 0 (valid non-overlap including shared map vertices)", () => {
    const { status, stderr } = runConvert([mapWithPolygons]);
    expect(status).toBe(0);
    expect(stderr).not.toContain("[error]");
  });
});
