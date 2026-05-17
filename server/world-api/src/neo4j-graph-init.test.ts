import test from "node:test";
import assert from "node:assert/strict";
import { TILE_H3_UNIQUE_CONSTRAINT_CYPHER } from "./neo4j-graph-init.js";

test("TILE_H3_UNIQUE_CONSTRAINT_CYPHER targets Tile.h3Index", () => {
  assert.match(TILE_H3_UNIQUE_CONSTRAINT_CYPHER, /tile_h3_unique/);
  assert.match(TILE_H3_UNIQUE_CONSTRAINT_CYPHER, /h3Index/);
  assert.match(TILE_H3_UNIQUE_CONSTRAINT_CYPHER, /Tile/);
});
