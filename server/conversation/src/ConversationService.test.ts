import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  ConversationGhostNoPosition,
  makeConversationLayer,
  ConversationService,
} from "./ConversationService.js";

// Minimal in-memory store stub
const makeStore = () => {
  const records: unknown[] = [];
  return {
    append: async (r: unknown) => { records.push(r); },
    records,
  };
};

// Minimal bridge stub — only ghost "broker-1" has a position
const makeBridge = (positioned: string[] = ["broker-1"]) => ({
  getGhostCell: (ghostId: string) => positioned.includes(ghostId) ? "8a1234567ffffff" : undefined,
  listOccupantsOnCell: () => [],
  setGhostMode: () => {},
  getGhostMode: () => "normal" as const,
});

function runSay(
  ghostId: string,
  to: string | undefined,
  callerRole: string | undefined,
  positioned: string[] = ["broker-1"],
) {
  const store = makeStore();
  const bridge = makeBridge(positioned);
  const layer = makeConversationLayer(bridge, store as never);
  return Effect.runPromise(
    Effect.provide(
      ConversationService.pipe(
        Effect.flatMap((svc) => svc.say(ghostId, "hello", to, undefined, undefined, callerRole)),
      ),
      layer,
    ),
  );
}

test("ghost with position: directed say succeeds", async () => {
  const result = await runSay("broker-1", "some-target", undefined, ["broker-1"]);
  assert.deepEqual(result.mx_listeners, ["some-target"]);
});

test("ghost without position: broadcast fails with ConversationGhostNoPosition", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.provide(
      ConversationService.pipe(
        Effect.flatMap((svc) => svc.say("human-ghost", "hello", undefined, undefined, undefined, undefined)),
      ),
      makeConversationLayer(makeBridge(["broker-1"]), makeStore() as never),
    ),
  );
  assert.ok(exit._tag === "Failure");
  const cause = exit.cause;
  assert.ok("error" in cause && cause.error instanceof ConversationGhostNoPosition);
});

test("human role + directed: succeeds without position", async () => {
  const result = await runSay("human-ghost", "broker-1", "human", ["broker-1"]);
  assert.deepEqual(result.mx_listeners, ["broker-1"]);
});

test("human role + broadcast (no to): fails with ConversationGhostNoPosition", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.provide(
      ConversationService.pipe(
        Effect.flatMap((svc) => svc.say("human-ghost", "hello", undefined, undefined, undefined, "human")),
      ),
      makeConversationLayer(makeBridge(["broker-1"]), makeStore() as never),
    ),
  );
  assert.ok(exit._tag === "Failure");
  const cause = exit.cause;
  assert.ok("error" in cause && cause.error instanceof ConversationGhostNoPosition);
});

test("human role + directed: mx_tile is empty string", async () => {
  const store = makeStore();
  const bridge = makeBridge(["broker-1"]);
  const layer = makeConversationLayer(bridge, store as never);
  await Effect.runPromise(
    Effect.provide(
      ConversationService.pipe(
        Effect.flatMap((svc) => svc.say("human-ghost", "accept", "broker-1", "Human", "agree", "human")),
      ),
      layer,
    ),
  );
  const record = store.records[0] as { mx_tile: string };
  assert.equal(record.mx_tile, "");
});
