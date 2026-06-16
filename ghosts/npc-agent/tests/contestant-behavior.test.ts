import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { GhostMcpService, type GhostMcpServiceShape } from "../src/mcp-effect.js";
import {
  clearContestantState,
  contestantTick,
  contestantHandleQuestion,
  contestantHandleResult,
} from "../src/behavior/contestant-behavior.js";

type Call = { name: string; args: unknown };

function makeMcpLayer(notifications: Array<{ thread_id: string; message_id: string }> = []): {
  layer: Layer.Layer<GhostMcpService>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const service: GhostMcpServiceShape = {
    whereami: Effect.succeed({ h3Index: "abc", name: "test" } as never),
    exits: Effect.succeed({ exits: [] } as never),
    look: () => Effect.succeed({ objects: [], ghosts: [] } as never),
    go: () => Effect.succeed({ ok: true } as never),
    take: () => Effect.succeed({ ok: true } as never),
    traverse: () => Effect.succeed({ ok: true } as never),
    inventory: Effect.succeed({ ok: true, objects: [], holdings: [] } as never),
    say: (args) => { calls.push({ name: "say", args }); return Effect.succeed({ ok: true } as never); },
    inbox: Effect.succeed({ notifications } as never),
    evalContractOpen: () => Effect.succeed({ contractId: "c1" } as never),
    evalContractEvaluate: () => Effect.succeed({ ok: true } as never),
  };
  return { calls, layer: Layer.succeed(GhostMcpService, service) };
}

function run<A>(effect: Effect.Effect<A, unknown, GhostMcpService>, layer: Layer.Layer<GhostMcpService>) {
  return Effect.runPromise(Effect.provide(effect, layer));
}

describe("contestantTick", () => {
  const GHOST_ID = "contestant-test";

  beforeEach(() => { clearContestantState(GHOST_ID); });

  it("sends accept when inbox has a notification in idle state", async () => {
    const { layer, calls } = makeMcpLayer([{ thread_id: "qm-1", message_id: "m1" }]);
    await run(contestantTick(GHOST_ID), layer);
    const sayCalls = calls.filter(c => c.name === "say");
    expect(sayCalls.length).toBe(1);
    expect((sayCalls[0]!.args as { content: string }).content).toBe("accept");
  });

  it("does not send accept when inbox is empty", async () => {
    const { layer, calls } = makeMcpLayer([]);
    await run(contestantTick(GHOST_ID), layer);
    expect(calls.filter(c => c.name === "say")).toHaveLength(0);
  });
});

describe("contestantHandleQuestion", () => {
  const GHOST_ID = "contestant-q";

  beforeEach(() => { clearContestantState(GHOST_ID); });

  it("answers 'a' for multiple_choice question", async () => {
    const { layer, calls } = makeMcpLayer();
    const questionSnippet = `---\nid: q1\ntype: multiple_choice\n---\n\nWhich algorithm?`;
    await run(contestantHandleQuestion(GHOST_ID, "qm-1", questionSnippet), layer);
    const sayCall = calls.find(c => c.name === "say");
    expect(sayCall).toBeDefined();
    expect((sayCall!.args as { content: string }).content).toBe("a");
  });

  it("answers '0' for numerical question", async () => {
    const { layer, calls } = makeMcpLayer();
    const questionSnippet = `---\nid: q3\ntype: numerical\n---\n\nMax supply?`;
    await run(contestantHandleQuestion(GHOST_ID, "qm-1", questionSnippet), layer);
    const sayCall = calls.find(c => c.name === "say");
    expect((sayCall!.args as { content: string }).content).toBe("0");
  });

  it("answers 'unknown' for short_answer question", async () => {
    const { layer, calls } = makeMcpLayer();
    const questionSnippet = `---\nid: q2\ntype: short_answer\n---\n\nName the creator?`;
    await run(contestantHandleQuestion(GHOST_ID, "qm-1", questionSnippet), layer);
    const sayCall = calls.find(c => c.name === "say");
    expect((sayCall!.args as { content: string }).content).toBe("unknown");
  });
});

describe("contestantHandleResult", () => {
  it("returns contestant to idle state", () => {
    // Should not throw; state reset is internal
    clearContestantState("contestant-r");
    contestantHandleResult("contestant-r");
    // After reset, tick should be able to accept again
  });
});
