import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { Gram, type GramParseError } from "@relateby/pattern";
import type { Pattern } from "@relateby/pattern";
import type { Subject } from "@relateby/pattern";

/**
 * Read a UTF-8 `.gram` file and parse into patterns (IC-003-A).
 */
export function parseGramRulesFile(
  absolutePath: string,
): Effect.Effect<ReadonlyArray<Pattern<Subject>>, GramParseError | Error> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
    (text) => Gram.parse(text),
  );
}
