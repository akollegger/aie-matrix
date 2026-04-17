import path from "node:path";
import { Effect } from "effect";
import type { GramParseError } from "@relateby/pattern";
import { parseGramRulesFile } from "./gram-rules.js";
import { authoredRuleset, permissiveRuleset, type ParsedRuleset } from "./movement-rules-service.js";

/** When `authored`, {@link AIE_MATRIX_RULES_PATH_ENV} must point to a `.gram` rules file. */
export const AIE_MATRIX_RULES_MODE_ENV = "AIE_MATRIX_RULES_MODE";
export const AIE_MATRIX_RULES_PATH_ENV = "AIE_MATRIX_RULES_PATH";

/**
 * Load rules from environment. Defaults to **permissive** when mode is unset or unknown
 * (backward-compatible PoC).
 */
export function loadMovementRulesFromEnv(
  env: NodeJS.ProcessEnv,
): Effect.Effect<ParsedRuleset, GramParseError | Error> {
  const modeRaw = env[AIE_MATRIX_RULES_MODE_ENV]?.trim().toLowerCase();
  const mode = modeRaw === "authored" || modeRaw === "permissive" ? modeRaw : "permissive";
  if (mode === "permissive") {
    return Effect.succeed(permissiveRuleset());
  }
  const p = env[AIE_MATRIX_RULES_PATH_ENV]?.trim();
  if (!p) {
    return Effect.fail(
      new Error(
        `${AIE_MATRIX_RULES_MODE_ENV}=authored requires ${AIE_MATRIX_RULES_PATH_ENV} to point to a .gram file`,
      ),
    );
  }
  const absolute = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return Effect.map(parseGramRulesFile(absolute), authoredRuleset);
}
