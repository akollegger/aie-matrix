import { Match } from "effect";
import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { CharacterDefinition, WorldAction, CompassDirection } from "../types.js";

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

function evalItemHere(snapshot: WorldSnapshot): boolean {
  return snapshot.nearbyItems.some((i) => i.at === "here");
}

function evalItemAdjacent(snapshot: WorldSnapshot): boolean {
  return snapshot.nearbyItems.some((i) => i.at !== "here");
}

function evalAlone(snapshot: WorldSnapshot): boolean {
  return snapshot.occupants.length === 0;
}

function evaluateCondition(condition: string, snapshot: WorldSnapshot): boolean {
  switch (condition) {
    case "inventory_empty": return evalInventoryEmpty(snapshot);
    case "crowded":         return evalCrowded(snapshot);
    case "item_nearby":     return evalItemNearby(snapshot);
    case "item_here":       return evalItemHere(snapshot);
    case "item_adjacent":   return evalItemAdjacent(snapshot);
    case "alone":           return evalAlone(snapshot);
    case "always":          return true;
    default:                return false;
  }
}

// ── Action resolution helpers ─────────────────────────────────────────────────

function resolveToward(
  toward: CompassDirection | "random" | "nearest_item",
  snapshot: WorldSnapshot,
): string {
  if (toward === "random") {
    if (snapshot.exits.length === 0) return "n";
    return snapshot.exits[Math.floor(Math.random() * snapshot.exits.length)]!.toward;
  }
  if (toward === "nearest_item") {
    const adj = snapshot.nearbyItems.find((i) => i.at !== "here");
    if (adj) return adj.at;
    if (snapshot.exits.length === 0) return "n";
    return snapshot.exits[Math.floor(Math.random() * snapshot.exits.length)]!.toward;
  }
  return toward;
}

function resolveItem(_item: "nearest", snapshot: WorldSnapshot): string {
  return snapshot.nearbyItems.find((i) => i.at === "here")?.id ?? "";
}

// ── Action dispatch ───────────────────────────────────────────────────────────

async function executeAction(
  action: WorldAction,
  snapshot: WorldSnapshot,
  mcp: GhostMcpClient,
): Promise<void> {
  const dispatched = Match.value(action).pipe(
    Match.when({ do: "go" as const },       (a) => mcp.callTool("go",       { toward: resolveToward(a.toward, snapshot) })),
    Match.when({ do: "take" as const },     (a) => mcp.callTool("take",     { itemRef: resolveItem(a.item, snapshot) })),
    Match.when({ do: "traverse" as const }, (a) => mcp.callTool("traverse", { via: a.via })),
    Match.when({ do: "idle" as const },     ()  => Promise.resolve()),
    Match.exhaustive,
  );
  await dispatched;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate behavior rules for a character in declaration order.
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
