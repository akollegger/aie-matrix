import { readFile } from "node:fs/promises";
import { Gram } from "@relateby/pattern";
import { Effect, HashMap, Option, HashSet } from "effect";
import type { Value } from "@relateby/pattern";

export interface QuestionSnippet {
  id: string;
  type: "multiple_choice" | "short_answer" | "numerical";
  weight: number;
  options?: Record<string, string>;
  correct: string | number;
  tolerance?: number;
  promptText: string;
}

export class ExamParseError extends Error {
  constructor(
    readonly message: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = "ExamParseError";
  }
}

// ── Value helpers ─────────────────────────────────────────────────────────────

function strProp(props: HashMap.HashMap<string, Value>, key: string): string | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => (v._tag === "StringVal" ? v.value : undefined),
  });
}

function numProp(props: HashMap.HashMap<string, Value>, key: string): number | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => (v._tag === "IntVal" || v._tag === "FloatVal" ? v.value : undefined),
  });
}

function mapProp(props: HashMap.HashMap<string, Value>, key: string): Record<string, string> | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => {
      if (v._tag !== "MapVal") return undefined;
      const result: Record<string, string> = {};
      for (const [k, val] of Object.entries(v.entries)) {
        if (val._tag === "StringVal") result[k] = val.value;
      }
      return result;
    },
  });
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse an `.exam.gram` file text into an ordered list of QuestionSnippets.
 *
 * Gram format: each question is a standalone Problem node with all rubric
 * properties included inline. The `prompt` property holds the question text.
 *
 * Example:
 *   (q1:Problem { type: "multiple_choice", weight: 2, correct: "a",
 *     prompt: "Which consensus algorithm does Bitcoin use?",
 *     options: { a: "Proof of Work", b: "Proof of Stake" } })
 */
export function parseExamGramText(
  text: string,
  source?: string,
): Effect.Effect<QuestionSnippet[], ExamParseError> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.mapError(
      Gram.parse(text),
      (e) => new ExamParseError((e as Error).message ?? String(e), source),
    );

    const questions: QuestionSnippet[] = [];

    for (const pattern of parsed) {
      const subj = pattern.value;
      if (!HashSet.has(subj.labels, "Problem")) continue;

      const id = subj.identity;
      if (!id) continue;

      const props = subj.properties;
      const type = strProp(props, "type") as QuestionSnippet["type"] | undefined;
      if (!type || !["multiple_choice", "short_answer", "numerical"].includes(type)) continue;

      const weight = numProp(props, "weight") ?? 1;
      const promptText = strProp(props, "prompt") ?? "";

      const correctStr = strProp(props, "correct");
      const correctNum = numProp(props, "correct");
      const correct: string | number | undefined = correctStr ?? correctNum;
      if (correct === undefined) continue;

      const options = mapProp(props, "options");
      const tolerance = numProp(props, "tolerance");

      questions.push({
        id,
        type,
        weight,
        ...(options ? { options } : {}),
        correct,
        ...(tolerance !== undefined ? { tolerance } : {}),
        promptText,
      });
    }

    if (questions.length === 0) {
      return yield* Effect.fail(new ExamParseError("No Problem nodes found in exam gram", source));
    }

    questions.sort((a, b) => a.id.localeCompare(b.id));
    return questions;
  });
}

export function parseExamGramFile(
  absolutePath: string,
): Effect.Effect<QuestionSnippet[], ExamParseError | Error> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
    (text) => parseExamGramText(text, absolutePath),
  );
}
