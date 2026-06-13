/** Closed condition vocabulary for BehaviorRule. */
export type BehaviorCondition =
  | "inventory_empty"
  | "item_here"
  | "item_adjacent"
  | "crowded"
  | "item_nearby"
  | "alone"
  | "always";

/** H3 compass directions used by the go action. */
export type CompassDirection = "n" | "s" | "ne" | "nw" | "se" | "sw";

/**
 * A parameterized world action — `do` is the type discriminant.
 * Parameters mirror the corresponding MCP tool arguments.
 */
export type WorldAction =
  | { readonly do: "go";       readonly toward: CompassDirection | "random" | "nearest_item" }
  | { readonly do: "take";     readonly item: "nearest" }
  | { readonly do: "traverse"; readonly via: string }
  | { readonly do: "idle" };

export interface BehaviorRule {
  readonly id: string;
  readonly condition: BehaviorCondition;
  readonly action: WorldAction;
}

export interface DialogNode {
  readonly id: string;
  /** Responses spoken when transitioning INTO this state; one chosen at random. */
  readonly responses: readonly string[];
}

/**
 * A directed edge in the dialog FSM.
 * Empty `triggers` = wildcard: matches any input not matched by a specific edge
 * from the same source node. Every node must have exactly one wildcard outgoing
 * edge — the idle/root node's wildcard edge points to itself (explicit self-loop).
 */
export interface DialogEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly triggers: readonly string[];
}

export interface DialogTree {
  readonly id: string;
  readonly nodes: ReadonlyMap<string, DialogNode>;
  readonly edges: readonly DialogEdge[];
  /** Id of the idle/root node — identified by its wildcard self-loop. */
  readonly rootId: string;
}

export interface CharacterDefinition {
  readonly id: string;
  readonly name: string;
  readonly background: string;
  readonly enabled: boolean;
  readonly defaultAction: WorldAction;
  readonly behaviorRules: readonly BehaviorRule[];
  readonly dialogTree: DialogTree;
  readonly behaviorKind: "rule-engine" | "broker";
}

export interface NpcAgentCatalog {
  readonly byId: ReadonlyMap<string, CharacterDefinition>;
  enabled(): CharacterDefinition[];
}

/** Per-partner dialog position (runtime, not persisted). */
export interface DialogState {
  currentNodeId: string;
  lastUpdated: string;
}
