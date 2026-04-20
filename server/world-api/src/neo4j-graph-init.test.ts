import test from "node:test";
import assert from "node:assert/strict";
import { CELL_H3_UNIQUE_CONSTRAINT_CYPHER } from "./neo4j-graph-init.js";

test("CELL_H3_UNIQUE_CONSTRAINT_CYPHER targets Cell.h3Index", () => {
  assert.match(CELL_H3_UNIQUE_CONSTRAINT_CYPHER, /cell_h3_unique/);
  assert.match(CELL_H3_UNIQUE_CONSTRAINT_CYPHER, /h3Index/);
  assert.match(CELL_H3_UNIQUE_CONSTRAINT_CYPHER, /Cell/);
});
