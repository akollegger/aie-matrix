import { Effect, Match } from "effect";
import type { CharacterDefinition, WorldAction, CompassDirection } from "../types.js";
import { GhostMcpService } from "../mcp-effect.js";
import type { McpCallError } from "../errors.js";

// ── World snapshot ────────────────────────────────────────────────────────────

export interface ItemSummary {
  readonly id: string;
  readonly name: string;
  readonly at: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw";
}

export interface ExitSummary {
  readonly toward: string;
}

export interface WorldSnapshot {
  readonly h3Index: string;
  readonly occupants: readonly string[];
  readonly exits: readonly ExitSummary[];
  readonly inventory: readonly { itemRef: string; name: string }[];
  readonly nearbyItems: readonly ItemSummary[];
}

// ── Condition evaluators ──────────────────────────────────────────────────────

function evaluateCondition(condition: string, snapshot: WorldSnapshot): boolean {
  switch (condition) {
    case "inventory_empty": return snapshot.inventory.length === 0;
    case "crowded":         return snapshot.occupants.length >= 2;
    case "item_nearby":     return snapshot.nearbyItems.length > 0;
    case "item_here":       return snapshot.nearbyItems.some((i) => i.at === "here");
    case "item_adjacent":   return snapshot.nearbyItems.some((i) => i.at !== "here");
    case "alone":           return snapshot.occupants.length === 0;
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

function executeAction(
  action: WorldAction,
  snapshot: WorldSnapshot,
): Effect.Effect<unknown, McpCallError, GhostMcpService> {
  return Effect.gen(function* () {
    const mcp = yield* GhostMcpService;
    return yield* Match.value(action).pipe(
      Match.when({ do: "go" as const },       (a) => mcp.go({ toward: resolveToward(a.toward, snapshot) as never })),
      Match.when({ do: "take" as const },     (a) => mcp.take({ itemRef: resolveItem(a.item, snapshot) })),
      Match.when({ do: "traverse" as const }, (a) => mcp.traverse({ via: a.via })),
      Match.when({ do: "idle" as const },     ()  => Effect.void),
      Match.exhaustive,
    );
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const evaluateRules = Effect.fn("evaluateRules")(function* (
  character: CharacterDefinition,
  snapshot: WorldSnapshot,
) {
  for (const rule of character.behaviorRules) {
    if (!evaluateCondition(rule.condition, snapshot)) continue;
    const succeeded = yield* executeAction(rule.action, snapshot).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false as boolean),
    );
    if (succeeded) return;
  }
  yield* executeAction(character.defaultAction, snapshot).pipe(
    Effect.orElse(() => Effect.void),
  );
});

export const ruleEngineTick = Effect.fn("ruleEngineTick")(function* (
  ghostId: string,
  character: CharacterDefinition,
) {
  const mcp = yield* GhostMcpService;
  const whereami  = yield* mcp.whereami;
  const exits     = yield* mcp.exits;
  const inventory = yield* mcp.inventory;
  const look      = yield* mcp.look();

  const snapshot = buildSnapshot(whereami, exits, inventory, look, ghostId);
  yield* evaluateRules(character, snapshot);
});

// ── Snapshot builder ──────────────────────────────────────────────────────────

export function buildSnapshot(
  whereami: { h3Index?: string; tileId?: string; occupants?: unknown[] },
  exits: { exits?: unknown[] },
  inventory: { objects?: unknown[] },
  look: { tiles?: unknown[] },
  selfGhostId: string,
): WorldSnapshot {
  const h3Index = whereami.h3Index ?? whereami.tileId ?? "";

  const occupants = (whereami.occupants ?? []).filter(
    (o): o is string => typeof o === "string" && o !== selfGhostId,
  );

  const exitList = (exits.exits ?? []).flatMap((ex) => {
    if (ex && typeof ex === "object" && "toward" in ex && typeof (ex as { toward: unknown }).toward === "string") {
      return [{ toward: (ex as { toward: string }).toward }];
    }
    return [];
  });

  const invItems = (inventory.objects ?? []).flatMap((o) => {
    if (o && typeof o === "object") {
      const obj = o as Record<string, unknown>;
      if (typeof obj["itemRef"] === "string" && typeof obj["name"] === "string") {
        return [{ itemRef: obj["itemRef"], name: obj["name"] }];
      }
    }
    return [];
  });

  const VALID_AT = new Set(["here", "n", "s", "ne", "nw", "se", "sw"]);
  const nearbyItems: ItemSummary[] = [];
  for (const tile of look.tiles ?? []) {
    if (!tile || typeof tile !== "object") continue;
    const t = tile as { at?: unknown; objects?: unknown[] };
    const at = typeof t.at === "string" && VALID_AT.has(t.at) ? t.at : "here";
    for (const obj of t.objects ?? []) {
      if (!obj || typeof obj !== "object") continue;
      const o = obj as Record<string, unknown>;
      if (typeof o["id"] === "string" && typeof o["name"] === "string") {
        nearbyItems.push({ id: o["id"], name: o["name"], at: at as ItemSummary["at"] });
      }
    }
  }

  return { h3Index, occupants, exits: exitList, inventory: invItems, nearbyItems };
}
