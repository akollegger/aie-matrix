import path from "node:path";
import { Effect } from "effect";
import type { GramParseError } from "@relateby/pattern";
import { parseGramRulesFile } from "./gram-rules.js";
import { authoredRuleset, permissiveRuleset, type ParsedRuleset } from "./movement-rules-service.js";

/** Path to a `.gram` rules file. When set, authored mode is active; when absent, permissive. */
export const AIE_MATRIX_RULES_ENV = "AIE_MATRIX_RULES";

/**
 * Load rules from environment. When `AIE_MATRIX_RULES` is set it must point to a `.gram` file
 * (authored mode). When absent, defaults to **permissive** (backward-compatible).
 *
 * @param baseDir - Base directory for resolving relative paths (should be repo root).
 *   Defaults to `process.cwd()`, but callers should pass an explicit anchor since pnpm
 *   changes CWD to the package directory when running scripts.
 */
export function loadMovementRulesFromEnv(
  env: NodeJS.ProcessEnv,
  baseDir: string = process.cwd(),
): Effect.Effect<ParsedRuleset, GramParseError | Error> {
  const p = env[AIE_MATRIX_RULES_ENV]?.trim();
  if (!p) {
    return Effect.succeed(permissiveRuleset());
  }
  const absolute = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
  return Effect.map(parseGramRulesFile(absolute), authoredRuleset);
}
