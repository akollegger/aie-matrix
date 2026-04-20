import test from "node:test";
import assert from "node:assert/strict";
import { cellToLatLng } from "h3-js";
import { GhostOverlay } from "./overlay.js";

test("cellToLatLng returns numeric lat/lng for a known res-15 index", () => {
  const [lat, lng] = cellToLatLng("8f2830828052d25");
  assert.equal(typeof lat, "number");
  assert.equal(typeof lng, "number");
  assert.ok(Number.isFinite(lat) && Number.isFinite(lng));
});

test("updateGhost with invalid h3 logs a warning and does not throw", () => {
  const warnings: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    warnings.push(a);
  };
  try {
    const overlay = new GhostOverlay({} as never);
    overlay.updateGhost("ghost-1", "not-a-valid-h3-index-string");
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.length >= 1);
  assert.match(String(warnings[0]?.[0] ?? ""), /overlay: invalid h3Index for ghost/);
});
