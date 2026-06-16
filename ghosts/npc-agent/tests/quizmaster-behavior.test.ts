import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadExam } from "../src/behavior/quizmaster-behavior.js";

const CATALOG_DIR = resolve(import.meta.dirname, "../catalog");

describe("loadExam", () => {
  it("loads bitcoin-basics.exam.gram and returns correct question count", async () => {
    const exam = await loadExam("bitcoin-basics.exam.gram", CATALOG_DIR);
    expect(exam.questions.length).toBe(3);
  });

  it("artifactRef and disclosureRef are 64-char hex strings", async () => {
    const exam = await loadExam("bitcoin-basics.exam.gram", CATALOG_DIR);
    expect(exam.artifactRef).toMatch(/^[0-9a-f]{64}$/);
    expect(exam.disclosureRef).toMatch(/^[0-9a-f]{64}$/);
  });

  it("artifactRef differs from disclosureRef", async () => {
    const exam = await loadExam("bitcoin-basics.exam.gram", CATALOG_DIR);
    expect(exam.artifactRef).not.toBe(exam.disclosureRef);
  });

  it("prompt-only snippets contain no correct field", async () => {
    const exam = await loadExam("bitcoin-basics.exam.gram", CATALOG_DIR);
    for (const snippet of exam.promptSnippets) {
      expect(snippet).not.toContain("correct:");
    }
  });

  it("full snippets each contain a correct field", async () => {
    const exam = await loadExam("bitcoin-basics.exam.gram", CATALOG_DIR);
    for (const snippet of exam.fullSnippets) {
      expect(snippet).toContain("correct:");
    }
  });
});
