import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMapGram, MapGramParseError } from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const canonicalPath = join(fixturesDir, "canonical.map.gram");

describe("parseMapGram — canonical.map.gram", () => {
  it("returns name from root record", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.name).toBe("canonical");
  });

  it("returns elevation from root record", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.elevation).toBe(0);
  });

  it("extracts TileType declarations", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.tileTypes.has("floor")).toBe(true);
    expect(map.tileTypes.has("pillar")).toBe(true);
    expect(map.tileTypes.get("floor")?.name).toBe("Floor");
  });

  it("extracts ItemType declarations", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.itemTypes.has("brassKey")).toBe(true);
    expect(map.itemTypes.get("brassKey")?.name).toBe("Brass Key");
  });

  it("produces a non-empty cell map", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.cells.size).toBeGreaterThan(0);
  });

  it("tile override wins over polygon fill (Pillar at 8f2800000000012)", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    // The overrides layer sets 8f2800000000012 as Pillar, overriding the polygon Floor fill
    const cell = map.cells.get("8f2800000000012");
    expect(cell).toBeDefined();
    expect(cell?.tileType).toBe("Pillar");
  });

  it("polygon fill covers more than just the 4 vertex cells", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    // The ground polygon has 4 vertex cells but should fill interior cells too
    expect(map.cells.size).toBeGreaterThan(4);
  });

  it("items are attached to cells", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    const itemCell = map.cells.get("8f2800000000015");
    expect(itemCell).toBeDefined();
    expect(itemCell?.items).toContain("BrassKey");
  });

  it("item qty=3 produces three BrassKey entries in cell.items", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    const itemCell = map.cells.get("8f2800000000015");
    const brassKeyCount = itemCell?.items.filter(i => i === "BrassKey").length ?? 0;
    expect(brassKeyCount).toBe(3);
  });

  it("itemPlacements carry qty=3 for the BrassKey placement", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    const placement = map.itemPlacements.find(p => p.itemRef === "BrassKey");
    expect(placement).toBeDefined();
    expect(placement?.qty).toBe(3);
  });

  it("parses [:Grants { role: qty } | (itemRef)] blocks into spawnGrants by role", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    // canonical.map.gram has [:Grants { explorer: 1, attendee: 1 } | (brassKey)]
    expect(map.spawnGrants.length).toBe(2);
    const explorer = map.spawnGrants.find(g => g.role === "explorer");
    const attendee = map.spawnGrants.find(g => g.role === "attendee");
    expect(explorer?.grants).toContainEqual({ itemRef: "BrassKey", qty: 1 });
    expect(attendee?.grants).toContainEqual({ itemRef: "BrassKey", qty: 1 });
  });

  it("merges multiple Grants blocks into the same role entry", async () => {
    const text = `
      { kind: "matrix-map", name: "test", elevation: 0 }
      (brassKey:ItemType:BrassKey { name: "Brass Key", takeable: true })
      (goldCoin:ItemType:GoldCoin { name: "Gold Coin", takeable: true })
      [g:Layer {kind: "items", name: "G"} | (:Item:BrassKey { geometry: [h3\`8f2800000000015\`] })]
      [layers:LayerStack | g]
      [:Grants { attendee: 1, vendor: 5 } | (brassKey)]
      [:Grants { attendee: 10, vendor: 50 } | (goldCoin)]
    `;
    const map = await parseMapGram(text);
    const attendee = map.spawnGrants.find(g => g.role === "attendee");
    const vendor = map.spawnGrants.find(g => g.role === "vendor");
    expect(attendee?.grants).toContainEqual({ itemRef: "BrassKey", qty: 1 });
    expect(attendee?.grants).toContainEqual({ itemRef: "GoldCoin", qty: 10 });
    expect(vendor?.grants).toContainEqual({ itemRef: "BrassKey", qty: 5 });
    expect(vendor?.grants).toContainEqual({ itemRef: "GoldCoin", qty: 50 });
  });

  it("parses portal with correct fromCell", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.portals.length).toBeGreaterThan(0);
    expect(map.portals[0]?.fromCell).toBe("8f2800000000195");
    expect(map.portals[0]?.mode).toBe("Door");
  });

  it("parses movement rules", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const map = await parseMapGram(text);
    expect(map.rules.length).toBe(2);
  });
});

describe("parseMapGram — error handling", () => {
  it("throws missing-layer-stack for document without LayerStack", async () => {
    const gramText = `{ kind: "matrix-map", name: "no-stack", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[layer1:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f2800000000195\`] })]
`;
    await expect(parseMapGram(gramText)).rejects.toMatchObject({ reason: "missing-layer-stack" });
  });

  it("throws gram-syntax for unparseable text", async () => {
    await expect(parseMapGram("not valid gram {{ }}")).rejects.toMatchObject({ reason: "gram-syntax" });
  });

  it("throws resources-block-forbidden when [resources:Resources] block present", async () => {
    const gramText = `{ kind: "matrix-map", name: "old-resources", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[tiles:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f2800000000195\`] })]
[layers:LayerStack | tiles]

[rules:Rules | (floor)-[:GO]->(floor)]

[resources:Resources | (:Resource { id: "gold", label: "Gold", class: "conserved", qty: 100, floor: 0 })]
`;
    await expect(parseMapGram(gramText)).rejects.toMatchObject({ reason: "resources-block-forbidden" });
  });

  it("skips polygon with fewer than 3 vertices and continues parsing", async () => {
    const gramText = `{ kind: "matrix-map", name: "bad-poly", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })

[poly:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3\`8f2800000000195\`, h3\`8f2800000000012\`] })]
[tiles:Layer {kind: "tile"} | (:Tile:Floor { geometry: [h3\`8f2800000000198\`] })]
[layers:LayerStack | poly, tiles]

[rules:Rules | (floor)-[:GO]->(floor)]
`;
    // Should not throw — polygon skipped, tile still added
    const map = await parseMapGram(gramText);
    expect(map.cells.has("8f2800000000198")).toBe(true);
  });
});

describe("parseMapGram — tile override", () => {
  it("tile layer overrides polygon fill at same cell", async () => {
    const gramText = `{ kind: "matrix-map", name: "override-test", elevation: 0 }

(floor:TileType:Floor { name: "Floor" })
(wall:TileType:Wall { name: "Wall" })

[poly:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3\`8f2800000000195\`, h3\`8f2800000000012\`, h3\`8f2800000000015\`, h3\`8f2800000000198\`] })]
[tiles:Layer {kind: "tile"} | (:Tile:Wall { geometry: [h3\`8f2800000000012\`] })]
[layers:LayerStack | poly, tiles]

[rules:Rules | (floor)-[:GO]->(floor)]
`;
    const map = await parseMapGram(gramText);
    const cell = map.cells.get("8f2800000000012");
    expect(cell?.tileType).toBe("Wall");
  });
});
