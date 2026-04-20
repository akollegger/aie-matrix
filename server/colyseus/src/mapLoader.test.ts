import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { loadHexMap, MapLoadError } from "./mapLoader.js";

const MIN_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.1" name="T" tilewidth="32" tileheight="28" tilecount="1" columns="1">
 <image source="x.png" width="32" height="28"/>
 <tile id="0" type="Blue"/>
</tileset>
`;

function tmjWith(props: Array<{ name: string; type?: string; value: string | number }>): string {
  return JSON.stringify({
    compressionlevel: -1,
    height: 1,
    width: 1,
    properties: props,
    hexsidelength: 16,
    infinite: false,
    layers: [
      {
        data: [1],
        height: 1,
        id: 1,
        name: "L",
        opacity: 1,
        type: "tilelayer",
        visible: true,
        width: 1,
        x: 0,
        y: 0,
      },
    ],
    orientation: "hexagonal",
    renderorder: "right-down",
    staggeraxis: "x",
    staggerindex: "odd",
    tiledversion: "1.12.1",
    tileheight: 28,
    tilesets: [{ firstgid: 1, source: "t.tsx" }],
    tilewidth: 32,
    type: "map",
    version: "1.10",
  });
}

async function withTempMap(
  tmjBody: string,
  fn: (tmjPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "maploader-test-"));
  try {
    await writeFile(join(dir, "t.tsx"), MIN_TSX, "utf8");
    const tmjPath = join(dir, "case.tmj");
    await writeFile(tmjPath, tmjBody, "utf8");
    await fn(tmjPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("MapLoadError when h3_anchor is missing names map file and points to authoring docs", async () => {
  const body = tmjWith([{ name: "h3_resolution", type: "int", value: 15 }]);
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        const msg = (e as Error).message;
        assert.match(msg, /case\.tmj/);
        assert.match(msg, /h3_anchor/i);
        assert.match(msg, /Tiled|rfc\/0004|0004-h3/i);
        return true;
      },
    );
  });
});

test("MapLoadError when h3_anchor has wrong Tiled property type (IC-009)", async () => {
  const body = tmjWith([
    { name: "h3_anchor", type: "int", value: 12345 },
    { name: "h3_resolution", type: "int", value: 15 },
  ]);
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        const msg = (e as Error).message;
        assert.match(msg, /case\.tmj/);
        assert.match(msg, /h3_anchor/);
        assert.match(msg, /string/);
        assert.match(msg, /int/);
        return true;
      },
    );
  });
});

test("MapLoadError when h3_anchor is not a valid H3 index", async () => {
  const body = tmjWith([
    { name: "h3_anchor", type: "string", value: "not-a-valid-h3-cell" },
    { name: "h3_resolution", type: "int", value: 15 },
  ]);
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        const msg = (e as Error).message;
        assert.match(msg, /case\.tmj/);
        assert.match(msg, /not a valid H3/i);
        assert.match(msg, /latLngToCell/i);
        return true;
      },
    );
  });
});

test("MapLoadError when h3_resolution is not 15", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith([
    { name: "h3_anchor", type: "string", value: anchor },
    { name: "h3_resolution", type: "int", value: 14 },
  ]);
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        const msg = (e as Error).message;
        assert.match(msg, /case\.tmj/);
        assert.match(msg, /h3_resolution must be 15/);
        assert.match(msg, /14/);
        return true;
      },
    );
  });
});

test("MapLoadError when anchor is valid H3 but not resolution 15", async () => {
  const anchorLowRes = latLngToCell(37.7749, -122.4194, 10);
  const body = tmjWith([
    { name: "h3_anchor", type: "string", value: anchorLowRes },
    { name: "h3_resolution", type: "int", value: 15 },
  ]);
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        const msg = (e as Error).message;
        assert.match(msg, /case\.tmj/);
        assert.match(msg, /resolution-15/i);
        assert.match(msg, /latLngToCell/i);
        return true;
      },
    );
  });
});

test("loadHexMap succeeds with valid res-15 anchor", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith([
    { name: "h3_anchor", type: "string", value: anchor },
    { name: "h3_resolution", type: "int", value: 15 },
  ]);
  await withTempMap(body, async (tmjPath) => {
    const map = await loadHexMap(tmjPath);
    assert.equal(map.anchorH3, anchor);
    assert.ok(map.cells.size >= 1);
  });
});
