import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { GhostMcpService, type GhostMcpServiceShape, type EvalContractOpenArgs } from "../src/mcp-effect.js";
import {
  clearQuizmasterState,
  setExam,
  quizmasterHandleAccept,
  quizmasterHandleAnswer,
  scoreAnswer,
  type ExamDefinition,
} from "../src/behavior/quizmaster-behavior.js";
import type { QuestionSnippet } from "../src/exam/parse-exam-gram.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const Q1: QuestionSnippet = {
  id: "q1",
  type: "multiple_choice",
  weight: 2,
  correct: "a",
  options: { a: "Proof of Work", b: "Proof of Stake" },
  promptText: "Which consensus algorithm does Bitcoin use?",
};

const Q2: QuestionSnippet = {
  id: "q2",
  type: "short_answer",
  weight: 1,
  correct: "Satoshi Nakamoto",
  promptText: "Name the creator of Bitcoin.",
};

const Q3: QuestionSnippet = {
  id: "q3",
  type: "numerical",
  weight: 1,
  correct: 21000000,
  tolerance: 0,
  promptText: "Max supply of Bitcoin?",
};

const EXAM: ExamDefinition = {
  questions: [Q1, Q2, Q3],
  promptSnippets: ["---\nid: q1\n---\nprompt", "---\nid: q2\n---\nprompt", "---\nid: q3\n---\nprompt"],
  fullSnippets: ["---\nid: q1\ncorrect: a\n---\nprompt", "---\nid: q2\ncorrect: Satoshi Nakamoto\n---\nprompt", "---\nid: q3\ncorrect: 21000000\n---\nprompt"],
  artifactRef: "a".repeat(64),
  disclosureRef: "b".repeat(64),
};

// ── MCP mock ──────────────────────────────────────────────────────────────────

type Call = { name: string; args: unknown };

function makeMcpLayer(overrides: {
  evalContractOpenResult?: unknown;
  holdings?: Array<{ resource: string; qty: number }>;
} = {}): { layer: Layer.Layer<GhostMcpService>; calls: Call[] } {
  const calls: Call[] = [];

  const service: GhostMcpServiceShape = {
    whereami: Effect.succeed({ h3Index: "abc", name: "test" } as never),
    exits: Effect.succeed({ exits: [] } as never),
    look: () => Effect.succeed({ objects: [], ghosts: [] } as never),
    go: () => Effect.succeed({ ok: true } as never),
    take: () => Effect.succeed({ ok: true } as never),
    traverse: () => Effect.succeed({ ok: true } as never),
    inventory: Effect.succeed({
      ok: true,
      objects: [],
      holdings: overrides.holdings ?? [{ resource: "broker-credit", qty: 10, label: "Broker Credit" }],
    } as never),
    say: (args) => { calls.push({ name: "say", args }); return Effect.succeed({ ok: true } as never); },
    inbox: Effect.succeed({ notifications: [] } as never),
    evalContractOpen: (args: EvalContractOpenArgs) => {
      calls.push({ name: "evalContractOpen", args });
      return Effect.succeed(overrides.evalContractOpenResult ?? { contractId: "contract-abc" } as never);
    },
    evalContractEvaluate: (args) => {
      calls.push({ name: "evalContractEvaluate", args });
      return Effect.succeed({ ok: true } as never);
    },
  };

  return {
    calls,
    layer: Layer.succeed(GhostMcpService, service),
  };
}

function run<A>(effect: Effect.Effect<A, unknown, GhostMcpService>, layer: Layer.Layer<GhostMcpService>) {
  return Effect.runPromise(Effect.provide(effect, layer));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scoreAnswer", () => {
  it("multiple_choice: case-insensitive exact match → 1.0", () => {
    expect(scoreAnswer(Q1, "A")).toBe(1.0);
    expect(scoreAnswer(Q1, "a")).toBe(1.0);
  });

  it("multiple_choice: wrong answer → 0.0", () => {
    expect(scoreAnswer(Q1, "b")).toBe(0.0);
  });

  it("short_answer: exact match → 1.0", () => {
    expect(scoreAnswer(Q2, "Satoshi Nakamoto")).toBe(1.0);
  });

  it("short_answer: wrong → 0.0", () => {
    expect(scoreAnswer(Q2, "Vitalik Buterin")).toBe(0.0);
  });

  it("numerical: within tolerance → 1.0", () => {
    expect(scoreAnswer(Q3, "21000000")).toBe(1.0);
  });

  it("numerical: outside tolerance → 0.0", () => {
    expect(scoreAnswer(Q3, "21000001")).toBe(0.0);
  });
});

describe("quizmasterHandleAccept", () => {
  const GHOST_ID = "qm-test";

  beforeEach(() => {
    clearQuizmasterState(GHOST_ID);
    setExam(GHOST_ID, EXAM);
  });

  it("opens contract with artifactRef and disclosureRef", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "contestant-1", 5), layer);
    const openCall = calls.find(c => c.name === "evalContractOpen");
    expect(openCall).toBeDefined();
    const args = openCall!.args as EvalContractOpenArgs;
    expect(args.artifactRef).toBe(EXAM.artifactRef);
    expect(args.disclosureRef).toBe(EXAM.disclosureRef);
  });

  it("sends first question via say after opening contract", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "contestant-1", 5), layer);
    const sayCalls = calls.filter(c => c.name === "say");
    expect(sayCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("declines if no exam loaded", async () => {
    clearQuizmasterState(GHOST_ID);
    // don't call setExam
    const { layer, calls } = makeMcpLayer();
    // setExam not called — but we need to clear it from the module-level map
    // Use a different ghostId with no exam
    await run(quizmasterHandleAccept("qm-no-exam", "contestant-1", 5), layer);
    const sayCalls = calls.filter(c => c.name === "say");
    expect(sayCalls.some(c => (c.args as { content?: string }).content?.includes("No exam"))).toBe(true);
  });
});

describe("quizmasterHandleAnswer — question sequencing", () => {
  const GHOST_ID = "qm-seq";

  beforeEach(() => {
    clearQuizmasterState(GHOST_ID);
    setExam(GHOST_ID, EXAM);
  });

  it("sends next question after first answer", async () => {
    const { layer, calls } = makeMcpLayer();
    // First open the contract to get into conducting state
    await run(quizmasterHandleAccept(GHOST_ID, "c1", 5), layer);
    calls.length = 0;
    // Answer first question
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "a"), layer);
    const sayCalls = calls.filter(c => c.name === "say");
    expect(sayCalls.length).toBeGreaterThanOrEqual(1);
    // Should NOT have called evalContractEvaluate yet
    expect(calls.find(c => c.name === "evalContractEvaluate")).toBeUndefined();
  });

  it("calls evalContractEvaluate after last answer", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "c1", 5), layer);
    // Answer all 3 questions
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "a"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "Satoshi Nakamoto"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "21000000"), layer);
    expect(calls.find(c => c.name === "evalContractEvaluate")).toBeDefined();
  });

  it("verdict is 1.0 for fully correct answers", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "c1", 5), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "a"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "Satoshi Nakamoto"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "21000000"), layer);
    const evalCall = calls.find(c => c.name === "evalContractEvaluate");
    expect((evalCall!.args as { verdict: number }).verdict).toBe(1.0);
  });

  it("verdict is 0.0 for all wrong answers", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "c1", 5), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "b"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "wrong"), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "0"), layer);
    const evalCall = calls.find(c => c.name === "evalContractEvaluate");
    expect((evalCall!.args as { verdict: number }).verdict).toBe(0.0);
  });

  it("partial verdict: only q1 correct (weight 2 of 4 total)", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(quizmasterHandleAccept(GHOST_ID, "c1", 5), layer);
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "a"), layer);    // correct (weight 2)
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "wrong"), layer); // wrong (weight 1)
    await run(quizmasterHandleAnswer(GHOST_ID, "c1", "0"), layer);    // wrong (weight 1)
    const evalCall = calls.find(c => c.name === "evalContractEvaluate");
    expect((evalCall!.args as { verdict: number }).verdict).toBeCloseTo(0.5);
  });
});
