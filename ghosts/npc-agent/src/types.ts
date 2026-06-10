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
  /** Case-insensitive keyword/substring triggers. Empty only on fallback nodes. */
  readonly triggerConditions: readonly string[];
  /** At least one response string; one chosen at random per reply. */
  readonly responses: readonly string[];
  /** Target node id after responding ([:ON]-> edge). */
  readonly transition?: string;
  /** Exactly one node per tree is the catch-all fallback. */
  readonly fallback?: boolean;
}

export interface DialogTree {
  readonly nodes: ReadonlyMap<string, DialogNode>;
  readonly rootId: string;
  readonly fallbackId: string;
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
