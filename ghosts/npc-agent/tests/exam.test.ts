import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { parseExamGramText } from "../src/exam/parse-exam-gram.js";
import { toPromptOnly, toFull, toSubmission } from "../src/exam/snippet-compiler.js";
import { hashSnippets } from "../src/exam/hash-artifact.js";

const SAMPLE_GRAM = `
(q1:Problem { type: "multiple_choice", weight: 2, correct: "a",
  prompt: "Which consensus algorithm does Bitcoin use?",
  options: { a: "Proof of Work", b: "Proof of Stake" } })

(q2:Problem { type: "short_answer", weight: 1, correct: "Satoshi Nakamoto",
  prompt: "Name the pseudonymous creator of Bitcoin." })
`;

describe("parseExamGramText", () => {
  it("parses Problem nodes into QuestionSnippets sorted by id", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    expect(questions.length).toBe(2);
    expect(questions[0]!.id).toBe("q1");
    expect(questions[1]!.id).toBe("q2");
  });

  it("extracts correct type, weight, and prompt", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    expect(questions[0]!.type).toBe("multiple_choice");
    expect(questions[0]!.weight).toBe(2);
    expect(questions[0]!.promptText).toBe("Which consensus algorithm does Bitcoin use?");
  });

  it("extracts options for multiple_choice", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    expect(questions[0]!.options).toEqual({ a: "Proof of Work", b: "Proof of Stake" });
  });

  it("fails when no Problem nodes found", async () => {
    const result = await Effect.runPromise(Effect.either(parseExamGramText("(foo:Unrelated {})")));
    expect(result._tag).toBe("Left");
  });
});

describe("snippet-compiler", () => {
  it("prompt-only snippet omits correct field", async () => {
    const [q] = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const snippet = toPromptOnly(q!);
    expect(snippet).not.toContain("correct:");
    expect(snippet).toContain("id: q1");
    expect(snippet).toContain("type: multiple_choice");
  });

  it("full snippet includes correct field", async () => {
    const [q] = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const snippet = toFull(q!);
    expect(snippet).toContain("correct: a");
  });

  it("submission snippet includes both correct and answer fields", async () => {
    const [q] = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const snippet = toSubmission(q!, "b");
    expect(snippet).toContain("correct: a");
    expect(snippet).toContain("answer: b");
  });

  it("serialization is deterministic across two calls", async () => {
    const [q] = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    expect(toFull(q!)).toBe(toFull(q!));
  });
});

describe("hashSnippets", () => {
  it("hash is stable across two calls with same input", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const snippets = questions.map(toPromptOnly);
    expect(hashSnippets(snippets)).toBe(hashSnippets(snippets));
  });

  it("artifactRef and disclosureRef differ", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const artifactRef = hashSnippets(questions.map(toPromptOnly));
    const disclosureRef = hashSnippets(questions.map(toFull));
    expect(artifactRef).not.toBe(disclosureRef);
  });

  it("produces a 64-char hex string", async () => {
    const questions = await Effect.runPromise(parseExamGramText(SAMPLE_GRAM));
    const hash = hashSnippets(questions.map(toPromptOnly));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
