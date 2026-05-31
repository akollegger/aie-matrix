import { Context, Layer } from "effect";
import type { Pattern } from "@relateby/pattern";
import type { Subject } from "@relateby/pattern";
import type { ParsedRuleCost } from "@aie-matrix/map-gram";
import { RuleGraph } from "./rule-graph.js";

export type RulesMode = "permissive" | "authored";

/**
 * Active movement rules: permissive bypasses rule graph; authored applies allow-list.
 * `ruleCosts` maps `"${fromTileClass}:${toTileClass}"` → cost to pay when crossing that edge.
 * Empty when no costs are declared (permissive mode or standalone rules file).
 */
export interface ParsedRuleset {
  readonly mode: RulesMode;
  /** Rule graph built from parsed patterns; empty when permissive. */
  readonly ruleGraph: RuleGraph;
  /** Cost lookup by tile class pair. Key: `"${fromTileClass}:${toTileClass}"`. */
  readonly ruleCosts: ReadonlyMap<string, ParsedRuleCost>;
}

export class MovementRulesService extends Context.Tag("aie-matrix/MovementRulesService")<
  MovementRulesService,
  ParsedRuleset
>() {}

export const makeMovementRulesLayer = (rules: ParsedRuleset): Layer.Layer<MovementRulesService> =>
  Layer.succeed(MovementRulesService, rules);

const EMPTY_COSTS: ReadonlyMap<string, ParsedRuleCost> = new Map();

export function permissiveRuleset(): ParsedRuleset {
  return { mode: "permissive", ruleGraph: RuleGraph.empty(), ruleCosts: EMPTY_COSTS };
}

export function authoredRuleset(patterns: ReadonlyArray<Pattern<Subject>>): ParsedRuleset {
  return { mode: "authored", ruleGraph: RuleGraph.fromPatterns(patterns), ruleCosts: EMPTY_COSTS };
}

/**
 * Build a ruleset from a `ParsedMap`, incorporating both the rule graph and any
 * edge costs declared on `:GO` rules. Keys in `ruleCosts` use tile type names
 * (e.g. `"Green:Green"`) which match `cell.tileClass` at runtime.
 */
export function rulesetFromParsedMap(parsedMap: {
  tileTypes: Map<string, { identity: string; typeName: string }>;
  rules: ReadonlyArray<{ fromType: string; toType: string; cost?: ParsedRuleCost }>;
}): ParsedRuleset {
  // Build cost map: identity → typeName for lookup
  const identityToTypeName = new Map<string, string>();
  for (const [, tt] of parsedMap.tileTypes) {
    identityToTypeName.set(tt.identity, tt.typeName);
  }

  const costs = new Map<string, ParsedRuleCost>();
  for (const rule of parsedMap.rules) {
    if (!rule.cost) continue;
    const fromName = identityToTypeName.get(rule.fromType) ?? rule.fromType;
    const toName = identityToTypeName.get(rule.toType) ?? rule.toType;
    costs.set(`${fromName}:${toName}`, rule.cost);
  }

  return { mode: "authored", ruleGraph: RuleGraph.empty(), ruleCosts: costs };
}
