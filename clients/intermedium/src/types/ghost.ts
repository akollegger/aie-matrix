/**
 * @see `specs/011-intermedium-client/data-model.md`
 * @see `specs/011-intermedium-client/contracts/ic-003-ghost-interiority-api.md`
 */

export interface GhostIdentity {
  readonly ghostId: string;
  readonly agentId: string;
  readonly name: string;
  readonly ghostClass: string;
}

export interface HumanPairing {
  readonly ghostId: string;
}

export interface InventoryItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
}

export type GoalStatus = "active" | "completed" | "failed";

export interface Goal {
  readonly goalId: string;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
}

export interface Memory {
  readonly entryId: string;
  readonly content: string;
  readonly timestamp: string;
}

export interface GhostInteriority {
  readonly ghostId: string;
  readonly inventory: readonly InventoryItem[];
  readonly activeGoal: Goal | null;
  readonly memories: readonly Memory[];
  readonly isAvailable: boolean;
}
