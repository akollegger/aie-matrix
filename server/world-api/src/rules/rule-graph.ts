import type { Pattern } from "@relateby/pattern";
import type { Subject } from "@relateby/pattern";
import { HashSet } from "effect";

/**
 * A `Pattern<Subject>` narrowed to a relationship — exactly two child elements,
 * where `elements[0]` is the source node and `elements[1]` is the destination node.
 * Use `isRelationshipPattern` to narrow from `Pattern<Subject>`.
 */
export interface RelationshipPattern extends Pattern<Subject> {
  readonly elements: readonly [Pattern<Subject>, Pattern<Subject>];
}

export function isRelationshipPattern(p: Pattern<Subject>): p is RelationshipPattern {
  return p.elements.length === 2;
}

/** Source node Subject of a relationship pattern. */
export const fromNode = (p: RelationshipPattern): Subject => p.elements[0].value;

/** Destination node Subject of a relationship pattern. */
export const toNode = (p: RelationshipPattern): Subject => p.elements[1].value;

/** Relationship Subject of a relationship pattern (carries rule type and constraint properties). */
export const relSubject = (p: RelationshipPattern): Subject => p.value;

/**
 * Extracts tile-class labels from a Subject node.
 * Labels-primary with identity fallback for tolerance.
 * Back-references (alias without labels) produce an empty set.
 */
export function subjectLabels(s: Subject): ReadonlySet<string> {
  const labels = [...HashSet.values(s.labels)].filter((l) => l.length > 0);
  if (labels.length > 0) return new Set(labels);
  if (s.identity.length > 0) return new Set([s.identity]);
  return new Set();
}

/**
 * Queryable index of rule relationships, keyed by rule type.
 *
 * Node labels are resolved by scanning all patterns and taking the first labelled
 * occurrence of each identity — so `(red:Red)` established on line 1 propagates to
 * back-references like `(red)` on later lines, composing the full state-transition
 * graph across the rule file.
 *
 * Canonical authoring: label-mirroring identifiers on first appearance, bare
 * back-references thereafter:
 *   `(red:Red)-[:GO]->(blue:Blue)`
 *   `(blue)-[:GO]->(green:Green)`
 */
export class RuleGraph {
  private readonly _nodes: ReadonlyMap<string, ReadonlySet<string>>;
  private readonly byType: ReadonlyMap<string, ReadonlyArray<RelationshipPattern>>;

  constructor(patterns: ReadonlyArray<Pattern<Subject>>) {
    const nodeMap = new Map<string, ReadonlySet<string>>();
    const index = new Map<string, RelationshipPattern[]>();

    for (const p of patterns) {
      if (!isRelationshipPattern(p)) continue;

      // First labelled occurrence of each identity wins; back-references don't overwrite.
      for (const elem of [p.elements[0], p.elements[1]] as const) {
        const id = elem.value.identity;
        if (id && !nodeMap.has(id)) {
          const labels = subjectLabels(elem.value);
          if (labels.size > 0) nodeMap.set(id, labels);
        }
      }

      // Index by rule type (first label of the relationship subject).
      const ruleTypes = [...HashSet.values(p.value.labels)].filter((l) => l.length > 0);
      if (ruleTypes.length === 0) continue;
      const ruleType = ruleTypes[0];
      const bucket = index.get(ruleType);
      if (bucket) {
        bucket.push(p);
      } else {
        index.set(ruleType, [p]);
      }
    }

    this._nodes = nodeMap;
    this.byType = index;
  }

  static fromPatterns(patterns: ReadonlyArray<Pattern<Subject>>): RuleGraph {
    return new RuleGraph(patterns);
  }

  static empty(): RuleGraph {
    return new RuleGraph([]);
  }

  /**
   * Labels for a node by its gram identity, e.g. `"red"` → `Set { "Red" }`.
   * Resolved from the first labelled occurrence across all patterns in the file.
   */
  nodeLabels(id: string): ReadonlySet<string> {
    return this._nodes.get(id) ?? new Set<string>();
  }

  /** All relationship patterns for the given rule type, e.g. `"GO"`, `"LOOK"`. */
  edgesFor(ruleType: string): ReadonlyArray<RelationshipPattern> {
    return this.byType.get(ruleType) ?? [];
  }

  /** All rule types present in this graph. */
  get ruleTypes(): ReadonlyArray<string> {
    return [...this.byType.keys()];
  }
}
