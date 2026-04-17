import { Context, Layer } from "effect";
import type { Pattern } from "@relateby/pattern";
import type { Subject } from "@relateby/pattern";
import { RuleGraph } from "./rule-graph.js";

export type RulesMode = "permissive" | "authored";

/**
 * Active movement rules: permissive bypasses rule graph; authored applies allow-list.
 */
export interface ParsedRuleset {
  readonly mode: RulesMode;
  /** Rule graph built from parsed patterns; empty when permissive. */
  readonly ruleGraph: RuleGraph;
}

export class MovementRulesService extends Context.Tag("aie-matrix/MovementRulesService")<
  MovementRulesService,
  ParsedRuleset
>() {}

export const makeMovementRulesLayer = (rules: ParsedRuleset): Layer.Layer<MovementRulesService> =>
  Layer.succeed(MovementRulesService, rules);

export function permissiveRuleset(): ParsedRuleset {
  return { mode: "permissive", ruleGraph: RuleGraph.empty() };
}

export function authoredRuleset(patterns: ReadonlyArray<Pattern<Subject>>): ParsedRuleset {
  return { mode: "authored", ruleGraph: RuleGraph.fromPatterns(patterns) };
}
