import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { CharacterDefinition, BehaviorAction, DefaultAction } from "../types.js";

// ── World snapshot ────────────────────────────────────────────────────────────

export interface ItemSummary {
  readonly id: string;
  readonly name: string;
  readonly at: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw";
}

export interface ExitSummary {
  readonly toward: string;
}

/** Point-in-time world state assembled from MCP calls before rule evaluation. */
export interface WorldSnapshot {
  readonly h3Index: string;
  /** Ghost ids on the current tile, excluding self. */
  readonly occupants: readonly string[];
  readonly exits: readonly ExitSummary[];
  readonly inventory: readonly { itemRef: string; name: string }[];
  /** Items visible from `look` on current cell and adjacent cells. */
  readonly nearbyItems: readonly ItemSummary[];
}

// ── Condition evaluators ──────────────────────────────────────────────────────

function evalInventoryEmpty(snapshot: WorldSnapshot): boolean {
  return snapshot.inventory.length === 0;
}

function evalCrowded(snapshot: WorldSnapshot): boolean {
  return snapshot.occupants.length >= 2;
}

function evalItemNearby(snapshot: WorldSnapshot): boolean {
  return snapshot.nearbyItems.length > 0;
}

function evalAlone(snapshot: WorldSnapshot): boolean {
  return snapshot.occupants.length === 0;
}

function evaluateCondition(condition: string, snapshot: WorldSnapshot): boolean {
  switch (condition) {
    case "inventory_empty": return evalInventoryEmpty(snapshot);
    case "crowded":         return evalCrowded(snapshot);
    case "item_nearby":     return evalItemNearby(snapshot);
    case "alone":           return evalAlone(snapshot);
    case "always":          return true;
    default:                return false;
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function doSeekItem(snapshot: WorldSnapshot, mcp: GhostMcpClient): Promise<void> {
  // Take an item that is on the current tile first.
  const hereItem = snapshot.nearbyItems.find((i) => i.at === "here");
  if (hereItem) {
    await mcp.callTool("take", { itemRef: hereItem.id });
    return;
  }
  // Move toward the nearest adjacent item.
  const adjacentItem = snapshot.nearbyItems.find((i) => i.at !== "here");
  if (adjacentItem) {
    const exit = snapshot.exits.find((e) => e.toward === adjacentItem.at);
    if (exit) {
      await mcp.callTool("go", { toward: exit.toward });
      return;
    }
  }
  // No item found: fall through to wander.
  await doWander(snapshot, mcp);
}

async function doAvoidCrowd(snapshot: WorldSnapshot, mcp: GhostMcpClient): Promise<void> {
  if (snapshot.exits.length === 0) return;
  const pick = snapshot.exits[Math.floor(Math.random() * snapshot.exits.length)]!;
  await mcp.callTool("go", { toward: pick.toward });
}

async function doWander(snapshot: WorldSnapshot, mcp: GhostMcpClient): Promise<void> {
  if (snapshot.exits.length === 0) return;
  const pick = snapshot.exits[Math.floor(Math.random() * snapshot.exits.length)]!;
  await mcp.callTool("go", { toward: pick.toward });
}

async function doRandomMove(snapshot: WorldSnapshot, mcp: GhostMcpClient): Promise<void> {
  await doWander(snapshot, mcp);
}

async function executeAction(
  action: BehaviorAction | DefaultAction,
  snapshot: WorldSnapshot,
  mcp: GhostMcpClient,
): Promise<void> {
  switch (action) {
    case "seek-item":   return doSeekItem(snapshot, mcp);
    case "avoid-crowd": return doAvoidCrowd(snapshot, mcp);
    case "wander":      return doWander(snapshot, mcp);
    case "idle":        return;
    case "random-move": return doRandomMove(snapshot, mcp);
    case "stay":        return;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate behavior rules for a character in priority order.
 * Returns on the first matching rule whose action succeeds.
 * If an MCP action throws, the rule is skipped and evaluation continues.
 * Falls back to `character.defaultAction` when no rule fires or all fire with MCP errors.
 */
export async function evaluateRules(
  character: CharacterDefinition,
  snapshot: WorldSnapshot,
  mcp: GhostMcpClient,
): Promise<void> {
  for (const rule of character.behaviorRules) {
    if (!evaluateCondition(rule.condition, snapshot)) continue;
    try {
      await executeAction(rule.action, snapshot, mcp);
      return;
    } catch {
      // MCP call failed — skip this rule, try next (FR-005 degradation).
    }
  }
  // No rule fired (or all errored): use defaultAction.
  try {
    await executeAction(character.defaultAction, snapshot, mcp);
  } catch {
    // Fallback also failed — silent, outer loop still alive.
  }
}

// ── Snapshot builder ──────────────────────────────────────────────────────────

/** Build a WorldSnapshot from raw MCP call results. All fields are optional
 *  in the raw responses so we default safely. */
export function buildSnapshot(
  whereami: Record<string, unknown>,
  exits: Record<string, unknown>,
  inventory: Record<string, unknown>,
  look: Record<string, unknown>,
  selfGhostId: string,
): WorldSnapshot {
  const h3Index =
    typeof whereami["h3Index"] === "string" ? whereami["h3Index"]
    : typeof whereami["tileId"] === "string" ? whereami["tileId"]
    : "";

  const rawOccupants = Array.isArray(whereami["occupants"]) ? whereami["occupants"] : [];
  const occupants = (rawOccupants as unknown[])
    .filter((o): o is string => typeof o === "string" && o !== selfGhostId);

  const rawExits = Array.isArray(exits["exits"]) ? exits["exits"] : [];
  const exitList = (rawExits as unknown[]).flatMap((e) => {
    if (e && typeof e === "object" && "toward" in e && typeof (e as Record<string, unknown>)["toward"] === "string") {
      return [{ toward: (e as Record<string, unknown>)["toward"] as string }];
    }
    return [];
  });

  const rawInventory = Array.isArray(inventory["objects"]) ? inventory["objects"] : [];
  const invItems = (rawInventory as unknown[]).flatMap((o) => {
    if (o && typeof o === "object") {
      const obj = o as Record<string, unknown>;
      if (typeof obj["itemRef"] === "string" && typeof obj["name"] === "string") {
        return [{ itemRef: obj["itemRef"], name: obj["name"] }];
      }
    }
    return [];
  });

  // Extract nearby items from look result. The look tool returns per-tile info.
  const rawTiles = Array.isArray(look["tiles"]) ? look["tiles"] : [];
  const nearbyItems: ItemSummary[] = [];
  for (const tile of rawTiles as unknown[]) {
    if (!tile || typeof tile !== "object") continue;
    const t = tile as Record<string, unknown>;
    const at = typeof t["at"] === "string" ? t["at"] : "here";
    const objects = Array.isArray(t["objects"]) ? t["objects"] : [];
    for (const obj of objects as unknown[]) {
      if (!obj || typeof obj !== "object") continue;
      const o = obj as Record<string, unknown>;
      if (typeof o["id"] === "string" && typeof o["name"] === "string") {
        const validAt = ["here", "n", "s", "ne", "nw", "se", "sw"].includes(at) ? at : "here";
        nearbyItems.push({ id: o["id"], name: o["name"], at: validAt as ItemSummary["at"] });
      }
    }
  }

  return { h3Index, occupants, exits: exitList, inventory: invItems, nearbyItems };
}
