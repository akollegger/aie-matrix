import type { Compass } from "@aie-matrix/shared-types";
import type { Subject } from "@relateby/pattern";
import { HashMap, Option } from "effect";
import { fromNode, relSubject, toNode } from "./rule-graph.js";
import type { RuleGraph } from "./rule-graph.js";

function stringProperty(subject: Subject, key: string): string | undefined {
  return Option.match(HashMap.get(subject.properties, key), {
    onNone: () => undefined,
    onSome: (val) => {
      if (
        val &&
        typeof val === "object" &&
        "_tag" in val &&
        (val as { _tag: string })._tag === "StringVal"
      ) {
        return (val as { value: string }).value;
      }
      return undefined;
    },
  });
}

/**
 * All labels required by a rule node must be present in the tile's label set (AND semantics).
 * `(red:Red)` requires the tile to have "Red". `(from:Hallway:VIP)` requires both "Hallway" and "VIP".
 * Labels are resolved via `ruleGraph.nodeLabels(identity)` — label-only nodes `(:Red)` have no
 * identity and will never match.
 */
function tileLabelsMatch(
  required: ReadonlySet<string>,
  tileLabels: ReadonlySet<string>,
): boolean {
  for (const label of required) {
    if (!tileLabels.has(label)) return false;
  }
  return required.size > 0;
}

/**
 * Allow-list: returns true if any GO relationship in the rule graph permits this step.
 * Node labels are resolved from the graph so back-references carry their full label set.
 */
export function goStepPermittedByRules(
  ruleGraph: RuleGraph,
  originLabels: ReadonlySet<string>,
  destLabels: ReadonlySet<string>,
  toward: Compass,
  ghostLabels: ReadonlySet<string>,
): boolean {
  for (const p of ruleGraph.edgesFor("GO")) {
    if (!tileLabelsMatch(ruleGraph.nodeLabels(fromNode(p).identity), originLabels)) continue;
    if (!tileLabelsMatch(ruleGraph.nodeLabels(toNode(p).identity), destLabels)) continue;
    const rel = relSubject(p);
    const requiredDir = stringProperty(rel, "toward");
    if (requiredDir !== undefined && requiredDir !== toward) continue;
    const requiredGhost = stringProperty(rel, "ghostClass");
    if (requiredGhost !== undefined && !ghostLabels.has(requiredGhost)) continue;
    return true;
  }
  return false;
}
