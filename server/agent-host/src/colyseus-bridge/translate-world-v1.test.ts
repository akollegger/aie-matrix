import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translateColyseusWorldV1 } from "./translate-world-v1.js";

const PACIFIC_OFFSET_RE = /[+-]\d{2}:00$/;

describe("translateColyseusWorldV1", () => {
  it("returns null for invalid input", () => {
    assert.equal(translateColyseusWorldV1(null), null);
    assert.equal(translateColyseusWorldV1("string"), null);
    assert.equal(translateColyseusWorldV1({ t: "message.new" }), null); // missing targetGhostId
  });

  it("produces a WorldEvent with timestamp in Pacific ISO 8601 format", () => {
    const raw = {
      t: "message.new",
      targetGhostId: "ghost_abc",
      payload: { from: "ghost_xyz", text: "hello" },
    };
    const event = translateColyseusWorldV1(raw);
    assert.ok(event !== null);
    assert.ok(typeof event!.timestamp === "string", "timestamp should be a string");
    assert.match(
      event!.timestamp,
      PACIFIC_OFFSET_RE,
      "timestamp should have a Pacific UTC offset like -07:00 or -08:00",
    );
    // sentAt is still present for backwards compatibility
    assert.ok(typeof event!.sentAt === "string", "sentAt should still be present");
  });

  it("timestamp and sentAt are both ISO 8601 datetimes", () => {
    const raw = { t: "proximity.enter", targetGhostId: "ghost_1", payload: {} };
    const event = translateColyseusWorldV1(raw);
    assert.ok(event !== null);
    assert.ok(!isNaN(Date.parse(event!.timestamp)), "timestamp must be parseable");
    assert.ok(!isNaN(Date.parse(event!.sentAt)), "sentAt must be parseable");
  });
});
