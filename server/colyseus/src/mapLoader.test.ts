import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { loadHexMap, MapLoadError } from "./mapLoader.js";
import type { ItemSidecar } from "@aie-matrix/shared-types";

const MIN_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.1" name="T" tilewidth="32" tileheight="28" tilecount="1" columns="1">
 <image source="x.png" width="32" height="28"/>
 <tile id="0" type="Blue"/>
</tileset>
`;

/** Tileset with `items` and `capacity` properties on the Blue tile */
const TSX_WITH_ITEMS = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.1" name="T" tilewidth="32" tileheight="28" tilecount="1" columns="1">
 <image source="x.png" width="32" height="28"/>
 <tile id="0" type="Blue">
  <properties>
   <property name="items" value="key-brass"/>
   <property name="capacity" value="2"/>
  </properties>
 </tile>
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

async function withTempMapAndSidecar(
  tmjBody: string,
  tsxContent: string,
  sidecar: ItemSidecar | null,
  fn: (tmjPath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "maploader-items-test-"));
  try {
    await writeFile(join(dir, "t.tsx"), tsxContent, "utf8");
    const tmjPath = join(dir, "case.tmj");
    await writeFile(tmjPath, tmjBody, "utf8");
    if (sidecar !== null) {
      await writeFile(join(dir, "case.items.json"), JSON.stringify(sidecar), "utf8");
    }
    await fn(tmjPath, dir);
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

// ── Object sidecar tests ──────────────────────────────────────────────────────

const VALID_ANCHOR_PROPS = (anchor: string) => [
  { name: "h3_anchor", type: "string", value: anchor },
  { name: "h3_resolution", type: "int", value: 15 },
];

test("map without sidecar has empty itemSidecar (no error)", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  await withTempMap(body, async (tmjPath) => {
    const map = await loadHexMap(tmjPath);
    assert.ok(map.itemSidecar instanceof Map);
    assert.equal(map.itemSidecar.size, 0);
  });
});

test("map with sidecar loads item definitions into itemSidecar", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  const sidecar: ItemSidecar = {
    "key-brass": {
      name: "Brass Key",
      itemClass: "Key",
      carriable: true,
      capacityCost: 0,
    },
  };
  await withTempMapAndSidecar(body, MIN_TSX, sidecar, async (tmjPath) => {
    const map = await loadHexMap(tmjPath);
    assert.equal(map.itemSidecar.size, 1);
    assert.equal(map.itemSidecar.get("key-brass")?.name, "Brass Key");
  });
});

test("tile class items property populates initialItemRefs on all matching cells", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  const sidecar: ItemSidecar = {
    "key-brass": { name: "Brass Key", itemClass: "Key", carriable: true, capacityCost: 0 },
  };
  await withTempMapAndSidecar(body, TSX_WITH_ITEMS, sidecar, async (tmjPath) => {
    const map = await loadHexMap(tmjPath);
    const cell = map.cells.values().next().value;
    assert.ok(cell, "expected at least one cell");
    assert.deepEqual(cell.initialItemRefs, ["key-brass"]);
  });
});

test("tile class capacity property is captured on CellRecord", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  const sidecar: ItemSidecar = {
    "key-brass": { name: "Brass Key", itemClass: "Key", carriable: true, capacityCost: 0 },
  };
  await withTempMapAndSidecar(body, TSX_WITH_ITEMS, sidecar, async (tmjPath) => {
    const map = await loadHexMap(tmjPath);
    const cell = map.cells.values().next().value;
    assert.ok(cell, "expected at least one cell");
    assert.equal(cell.capacity, 2);
  });
});

test("unknown itemRef in tile class property is skipped with a warning (no startup error)", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  // sidecar does NOT contain key-brass
  const sidecar: ItemSidecar = {};
  const warnings: string[] = [];
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await withTempMapAndSidecar(body, TSX_WITH_ITEMS, sidecar, async (tmjPath) => {
      const map = await loadHexMap(tmjPath);
      const cell = map.cells.values().next().value;
      assert.ok(cell, "expected at least one cell");
      assert.deepEqual(cell.initialItemRefs, []);
    });
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warnings.some((w) => w.includes("key-brass")), "expected warning about unknown itemRef");
});

test("malformed sidecar JSON throws MapLoadError", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  const dir = await mkdtemp(join(tmpdir(), "maploader-malformed-"));
  try {
    await writeFile(join(dir, "t.tsx"), MIN_TSX, "utf8");
    const tmjPath = join(dir, "case.tmj");
    await writeFile(tmjPath, body, "utf8");
    await writeFile(join(dir, "case.items.json"), "{ not valid json", "utf8");
    await assert.rejects(
      () => loadHexMap(tmjPath),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        assert.match((e as Error).message, /invalid JSON/i);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit itemsPath that does not exist throws MapLoadError", async () => {
  const anchor = latLngToCell(37.7749, -122.4194, 15);
  const body = tmjWith(VALID_ANCHOR_PROPS(anchor));
  await withTempMap(body, async (tmjPath) => {
    await assert.rejects(
      () => loadHexMap(tmjPath, { itemsPath: "/nonexistent/path/items.json" }),
      (e: unknown) => {
        assert.ok(e instanceof MapLoadError);
        assert.match((e as Error).message, /AIE_MATRIX_ITEMS/);
        return true;
      },
    );
  });
});
