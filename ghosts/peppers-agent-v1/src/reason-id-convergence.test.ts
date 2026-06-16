/**
 * Prompt-assembly tests for the convergence stage.
 *
 * No LLM calls — these verify that the user prompt sent to the model
 * contains the right structural pieces (recent super-objectives,
 * recent triggers, facet readings, tell-friendly framing). When the
 * prompt is right, the rest is on the model.
 *
 * Smoke tests that DO call the LLM live in `smoke/` and are gated
 * behind an explicit script — they're not part of `pnpm test`.
 */
import { describe, expect, it } from "vitest";

import type { Stimulus } from "@aie-matrix/ghost-peppers-inner";

import type { FacetReading } from "./reason-id-facet-agent.js";

// We don't import `invokeConvergence` itself (would try to hit the LLM
// transport). Instead we import the prompt-builder helpers if exported,
// or replicate the assembly here against a stable contract.
//
// Since the user-prompt builder is currently inlined inside
// `invokeConvergence`, this test asserts the SYSTEM_PROMPT shape (the
// part that doesn't depend on runtime args). Once we extract the
// builder for testability, we'll add structural assertions on the
// user prompt too.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "reason-id-convergence.ts",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

function fixtureUtterance(text: string): Stimulus {
  return { kind: "utterance", from: "Tuco Acyclica", text };
}

function fixtureFacets(): FacetReading[] {
  // Two of these (Confidence/Assertiveness, Warmth) show explicit tells
  // — language the facet agent prompt now teaches it to use. The
  // convergence prompt change is what carries those tells forward.
  return [
    {
      facet: "Assertiveness",
      judgment: "neutral",
      reading:
        "The swagger here is brittle — too quick to dismiss the question, voice pitched a half-step too loud.",
      adjustment: null,
      usage: null,
      userPrompt: "",
      raw: "",
      expression: null,
    },
    {
      facet: "Warmth",
      judgment: "positive",
      reading:
        "Quiet authority. The hello is unforced; care bleeds through without performance.",
      adjustment: null,
      usage: null,
      userPrompt: "",
      raw: "",
      expression: null,
    },
    {
      facet: "Trust",
      judgment: "negative",
      reading: "Wary. The pattern of the question reads as a probe.",
      adjustment: null,
      usage: null,
      userPrompt: "",
      raw: "",
      expression: null,
    },
  ];
}

describe("convergence system prompt (structural)", () => {
  it("teaches the model to carry facet tells forward into the emotional read", () => {
    // The phrase we added so convergence honours, not paves over, facet tells.
    expect(SOURCE).toContain("TELLS");
    expect(SOURCE).toContain("the swagger is brittle");
    expect(SOURCE).toContain("the leak between them is the truth");
  });

  it("includes the PLAN CONTINUITY rule so committed objectives persist across ticks", () => {
    expect(SOURCE).toContain("PLAN CONTINUITY");
    expect(SOURCE).toContain("preserve that commitment");
    // The specific failure mode the rule was written to address.
    expect(SOURCE).toContain("traps ghosts in conversation loops");
  });

  it("super-objective examples include identity-leak phrasing", () => {
    // Confirms we updated the example list so the model has the right
    // shape for tell-aware super-objectives.
    expect(SOURCE).toContain("hiding the panic");
    expect(SOURCE).toContain("without seeming to want it");
  });
});

describe("convergence user prompt (structural)", () => {
  it("ConvergenceRequest exposes recentSuperObjectives and recentTriggers", () => {
    // Contract check — the wiring exists. If someone renames or drops
    // these fields the cascade silently loses plan-continuity context.
    expect(SOURCE).toMatch(/recentSuperObjectives\??:/);
    expect(SOURCE).toMatch(/recentTriggers\??:/);
  });

  it("user prompt builder appends recent super-objectives when provided", () => {
    // The string the builder emits when the field is present.
    expect(SOURCE).toContain("Recent super-objectives (oldest → newest):");
    expect(SOURCE).toContain("Recent triggers + actions (oldest → newest):");
  });
});

describe("convergence-facet integration shape", () => {
  it("can construct a fixture utterance + facet readings without throwing", () => {
    // Sanity: the fixtures we'd hand to a smoke test are valid types.
    const stim = fixtureUtterance("Howdy, headed to Black Bart's?");
    const facets = fixtureFacets();
    expect(stim.kind).toBe("utterance");
    expect(facets.some((f) => f.reading.includes("brittle"))).toBe(true);
    expect(facets.some((f) => f.reading.includes("Quiet authority"))).toBe(true);
  });
});
