/** Closed condition vocabulary for BehaviorRule. */
export type BehaviorCondition =
  | "inventory_empty"
  | "crowded"
  | "item_nearby"
  | "alone"
  | "always";

/** Closed action vocabulary for BehaviorRule. */
export type BehaviorAction = "seek-item" | "avoid-crowd" | "wander" | "idle";

/** Default action taken when no rule matches. */
export type DefaultAction = "idle" | "random-move" | "stay";

export interface BehaviorRule {
  readonly id: string;
  readonly condition: BehaviorCondition;
  readonly action: BehaviorAction;
  /** Array index is the authoritative priority; explicit value used only for sorting if present. */
  readonly priority?: number;
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
  readonly defaultAction: DefaultAction;
  readonly behaviorRules: readonly BehaviorRule[];
  readonly dialogTree: DialogTree;
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
