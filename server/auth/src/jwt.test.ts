import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { mintGhostToken, verifyGhostToken } from "./jwt.js";

test("mintGhostToken includes role when provided", () => {
  const token = mintGhostToken({ sub: "test-id", ghostId: "test-id", role: "human" });
  assert.ok(typeof token === "string" && token.length > 0);
});

test("verifyGhostToken returns role: human for guest tokens", async () => {
  const ghostId = "01TEST000000000000000000001";
  const token = mintGhostToken({ sub: ghostId, ghostId, role: "human" });
  const claims = await Effect.runPromise(verifyGhostToken(token));
  assert.equal(claims.ghostId, ghostId);
  assert.equal(claims.role, "human");
  assert.equal(claims.sub, ghostId);
});

test("verifyGhostToken role is undefined when not set", async () => {
  const ghostId = "01TEST000000000000000000002";
  const token = mintGhostToken({ sub: ghostId, ghostId });
  const claims = await Effect.runPromise(verifyGhostToken(token));
  assert.equal(claims.role, undefined);
});

test("mintGhostToken omits role when undefined", async () => {
  const ghostId = "01TEST000000000000000000003";
  const token = mintGhostToken({ sub: ghostId, ghostId });
  // Decode payload manually to confirm no role key
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
  assert.ok(!("role" in payload));
});
