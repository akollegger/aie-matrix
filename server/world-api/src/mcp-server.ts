import { timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CellId } from "@aie-matrix/server-colyseus";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { Cause, Effect, Exit, Layer, Option, pipe } from "effect";
import { z } from "zod";
import {
  COMPASS_DIRECTIONS,
  type DropResult,
  type ExitInfo,
  type InspectResult,
  type InventoryResult,
  type GoFailure,
  type NonAdjacentExitInfo,
  type TakeResult,
  type TileItemSummary,
  type TileInspectResult,
  type WhereAmIResult,
  type SayResult,
  type WhoAmIResult,
} from "@aie-matrix/shared-types";
import { ConversationGhostNoPosition, ConversationService } from "@aie-matrix/server-conversation";
import {
  authenticateGhostRequestEffect,
  ghostIdsFromAuth,
  ghostIdsFromAuthEffect,
} from "./auth-context.js";
import type { AuthError } from "./auth-errors.js";
import { AuthMissingCredentials } from "./auth-errors.js";
import { McpHandlerError } from "./mcp-handler-error.js";
import { Neo4jGraphService } from "./Neo4jGraphService.js";
import { RegistryStoreService } from "./RegistryStoreService.js";
import { MovementRulesService } from "./rules/movement-rules-service.js";
import { WorldBridgeService } from "./WorldBridgeService.js";
import {
  WorldApiMapIntegrity,
  WorldApiMovementBlocked,
  WorldApiNoPosition,
  WorldApiUnknownCell,
  type WorldApiError,
} from "./world-api-errors.js";
import { evaluateGo, evaluateTraverse } from "./movement.js";
import { ItemService, type ItemServiceOps } from "./ItemService.js";
import { RedisGhostStoreService } from "./redis/RedisGhostStoreService.js";
import { getRequestTraceId } from "./request-trace.js";
import { WorldCalendarService } from "./calendar/WorldCalendarService.js";
import { LedgerService } from "./LedgerService.js";
import { ProposalService } from "./ProposalService.js";
import { GroupService } from "./GroupService.js";
import { worldNow, WORLD_TIMEZONE } from "@aie-matrix/shared-types";

type McpToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const compassEnum = z.enum(["n", "s", "ne", "nw", "se", "sw"]);

const lookAtSchema = z.union([z.literal("here"), z.literal("around"), compassEnum]);

type ToolServices =
  | WorldBridgeService
  | RegistryStoreService
  | MovementRulesService
  | Neo4jGraphService
  | ConversationService
  | ItemService
  | RedisGhostStoreService
  | WorldCalendarService
  | LedgerService
  | ProposalService
  | GroupService;

function logJson(record: Record<string, unknown>): void {
  console.info(JSON.stringify(record));
}

function formatGhostLastAction(toolName: string, input: unknown): string {
  if (input == null) {
    return toolName;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    const s = JSON.stringify(input);
    return s.length > 120 ? `${toolName} ${s.slice(0, 117)}…` : `${toolName} ${s}`;
  }
  const keys = Object.keys(input as object);
  if (keys.length === 0) {
    return toolName;
  }
  const o = input as Record<string, unknown>;
  if (toolName === "say" && typeof o.content === "string") {
    const c = o.content.length > 48 ? `${o.content.slice(0, 45)}…` : o.content;
    return `say ${JSON.stringify(c)}`;
  }
  if (typeof o.toward === "string") {
    return `go ${o.toward}`;
  }
  if (typeof o.via === "string") {
    const v = o.via.length > 64 ? `${o.via.slice(0, 61)}…` : o.via;
    return `traverse ${JSON.stringify(v)}`;
  }
  if (typeof o.at === "string") {
    return `look ${o.at}`;
  }
  if (typeof o.itemRef === "string") {
    const ir = o.itemRef.length > 64 ? `${o.itemRef.slice(0, 61)}…` : o.itemRef;
    if (toolName === "inspect") {
      return `inspect ${ir}`;
    }
    if (toolName === "take") {
      return `take ${ir}`;
    }
    if (toolName === "drop") {
      return `drop ${ir}`;
    }
  }
  const s = JSON.stringify(input);
  return s.length > 120 ? `${toolName} ${s.slice(0, 117)}…` : `${toolName} ${s}`;
}

function recordGhostLastActionAfterSuccess(
  servicesLayer: Layer.Layer<ToolServices>,
  extra: McpToolExtra,
  toolName: string,
  input: unknown,
): void {
  if (!extra.authInfo) {
    return;
  }
  try {
    const { ghostId } = ghostIdsFromAuth(extra.authInfo);
    Effect.runSync(
      pipe(
        Effect.gen(function* () {
          const bridge = yield* WorldBridgeService;
          bridge.setGhostLastAction(ghostId, formatGhostLastAction(toolName, input));
        }),
        Effect.provide(servicesLayer),
      ),
    );
  } catch {
    // Malformed auth — skip spectator last-action update.
  }
}

function logMcpBridgeOp(
  op: "getGhostCell" | "setGhostCell",
  fields: Record<string, unknown>,
): Effect.Effect<void> {
  return Effect.sync(() => {
    const traceId = getRequestTraceId() ?? null;
    logJson({ kind: "world-bridge", op, traceId, ...fields });
  });
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(message: string, code?: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, message, code }) }],
  };
}

function authErrorToToolPayload(error: AuthError): Record<string, unknown> {
  const variant = error._tag.slice("AuthError.".length);
  return {
    error: "AUTH_ERROR",
    message: error.message ?? error._tag,
    variant,
  };
}

function worldApiErrorToToolPayload(error: WorldApiError): Record<string, unknown> {
  switch (error._tag) {
    case "WorldApiError.NoPosition":
      return { error: "NO_POSITION", ghostId: error.ghostId };
    case "WorldApiError.UnknownCell":
      return { error: "UNKNOWN_CELL", cellId: error.cellId };
    case "WorldApiError.MovementBlocked":
      return {
        error: "MOVEMENT_BLOCKED",
        message: error.message,
        ...(error.code !== undefined ? { code: error.code } : {}),
      };
    case "WorldApiError.MapIntegrity":
      return { error: "MAP_INTEGRITY", message: error.message };
    case "WorldApiError.ItemNotHere":
      return { ok: false, code: "NOT_HERE", reason: `Item "${error.itemRef}" is not on your current tile.` };
    case "WorldApiError.ItemNotFound":
      return { ok: false, code: "NOT_FOUND", reason: `Item "${error.itemRef}" does not exist.` };
    case "WorldApiError.ItemNotCarriable":
      return { ok: false, code: "NOT_CARRIABLE", reason: `Item "${error.itemRef}" cannot be picked up.` };
    case "WorldApiError.ItemNotCarrying":
      return { ok: false, code: "NOT_CARRYING", reason: `You are not carrying "${error.itemRef}".` };
    case "WorldApiError.TileFull":
      return { ok: false, code: "TILE_FULL", reason: `Tile ${error.h3Index} is at full capacity.` };
    default:
      return { error: "WORLD_API", message: String(error) };
  }
}

function tileItemsForAt(
  itemService: ItemServiceOps,
  h3Index: string,
  at: TileItemSummary["at"],
): TileItemSummary[] {
  const sidecar = itemService.getSidecar();
  return itemService.getItemsOnTile(h3Index).map((itemRef) => ({
    id: itemRef,
    name: sidecar.get(itemRef)?.name ?? itemRef,
    at,
  }));
}

function addObjectsField(
  tile: Omit<TileInspectResult, "objects">,
  objects: TileItemSummary[],
): TileInspectResult {
  return { ...tile, objects };
}

function hasRulesetEdge(rules: { ruleGraph: { edgesFor(ruleType: string): ReadonlyArray<unknown> } }, ruleType: string): boolean {
  return rules.ruleGraph.edgesFor(ruleType).length > 0;
}

/**
 * Maps a finished Effect tool run to MCP `CallToolResult` (IC-001 MCP tool mapping).
 */
export function effectExitToCallToolResult<A>(
  exit: Exit.Exit<A, AuthError | WorldApiError>,
): CallToolResult {
  return Exit.match(exit, {
    onFailure: (cause) => {
      const errOpt = Cause.failureOption(cause);
      if (Option.isSome(errOpt)) {
        const err = errOpt.value;
        const payload = err._tag.startsWith("AuthError.")
          ? authErrorToToolPayload(err as AuthError)
          : worldApiErrorToToolPayload(err as WorldApiError);
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(payload) }],
        };
      }
      return toolError(Cause.pretty(cause), "INTERNAL");
    },
    onSuccess: (value) => textResult(value),
  });
}

function normalizeCellId(raw: string | undefined | null): CellId | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const t = String(raw).trim();
  return t !== "" ? (t as CellId) : undefined;
}

/**
 * Colyseus `ghostTiles` is authoritative, but the in-memory registry still holds each
 * ghost’s last known cell id (`h3Index` in the registry) from adopt / moves. If the room map lost the entry (e.g.
 * process hiccup), re-seed from the registry so MCP tools keep working.
 *
 * Tier resolution:
 *   1. Colyseus ghostTiles — only if the cell is on the current loaded map
 *   2. Registry store h3Index — only if the cell is on the current loaded map
 *   3. Random navigable cell from the current loaded map (initial placement /
 *      relocation after a session/map switch)
 */
function authoritativeGhostTileEffect(
  ghostId: string,
): Effect.Effect<CellId, WorldApiNoPosition, ToolServices> {
  return Effect.gen(function* () {
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const map = bridge.getLoadedMap();

    const raw = bridge.getGhostCell(ghostId) as CellId | undefined;
    yield* logMcpBridgeOp("getGhostCell", { ghostId, cellId: raw ?? null });
    const fromRoom = normalizeCellId(raw);
    if (fromRoom !== undefined && map.cells.has(fromRoom)) {
      return fromRoom;
    }

    const regRaw = store.ghosts.get(ghostId)?.h3Index;
    const fromReg = normalizeCellId(regRaw);
    if (fromReg !== undefined && map.cells.has(fromReg)) {
      bridge.setGhostCell(ghostId, fromReg);
      yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: fromReg, reason: "reseed-from-registry" });
      return fromReg;
    }

    // Tier 3: ghost has no valid position on the current map (new ghost or post-session-switch
    // relocation). Place on a random navigable cell so the ghost can start moving immediately.
    const navigableCells = Array.from(map.cells.values()).filter(
      (c) => c.capacity === undefined || c.capacity > 0,
    );
    if (navigableCells.length === 0) {
      return yield* Effect.fail(new WorldApiNoPosition({ ghostId }));
    }
    const cell = navigableCells[Math.floor(Math.random() * navigableCells.length)]!;
    const initialId = cell.h3Index as CellId;
    bridge.setGhostCell(ghostId, initialId);
    yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: initialId, reason: "initial-placement" });
    return initialId;
  });
}

function requireAuthExtra(extra: McpToolExtra): Effect.Effect<void, AuthMissingCredentials> {
  if (!extra.authInfo) {
    return Effect.fail(
      new AuthMissingCredentials({ message: "Missing ghost credentials on MCP session" }),
    );
  }
  return Effect.void;
}

function whoamiEffect(extra: McpToolExtra): Effect.Effect<WhoAmIResult, AuthError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId, caretakerId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    return { ghostId, caretakerId };
  });
}

function whereamiEffect(extra: McpToolExtra): Effect.Effect<WhereAmIResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const map = bridge.getLoadedMap();
    const tileId = yield* authoritativeGhostTileEffect(ghostId);
    const cell = map.cells.get(tileId as CellId);
    if (!cell) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(tileId) }));
    }
    return { h3Index: tileId, tileId, col: cell.col, row: cell.row };
  });
}

function lookEffect(
  at: z.infer<typeof lookAtSchema> | undefined,
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const itemService = yield* ItemService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = map.cells.get(hereId);
    if (!here) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }
    const target = at ?? "here";
    if (target === "here") {
      const occupants = bridge.listOccupantsOnCell(hereId);
      const objects = tileItemsForAt(itemService, hereId, "here");
      for (const dir of COMPASS_DIRECTIONS) {
        const nid = here.neighbors[dir];
        if (!nid) {
          continue;
        }
        objects.push(...tileItemsForAt(itemService, nid, dir));
      }
      const tile = addObjectsField({
        tileId: hereId,
        tileClass: here.tileClass,
        occupants,
      }, objects);
      return tile;
    }
    if (target === "around") {
      const tiles: TileInspectResult[] = [];
      for (const dir of COMPASS_DIRECTIONS) {
        const nid = here.neighbors[dir];
        if (!nid) {
          continue;
        }
        const ncell = map.cells.get(nid);
        if (!ncell) {
          continue;
        }
        tiles.push(addObjectsField({
          tileId: nid,
          tileClass: ncell.tileClass,
          occupants: bridge.listOccupantsOnCell(nid),
        }, tileItemsForAt(itemService, nid, "here")));
      }
      return { neighbors: tiles };
    }
    const nid = here.neighbors[target];
    if (!nid) {
      return { empty: true, toward: target };
    }
    const ncell = map.cells.get(nid);
    if (!ncell) {
      return { empty: true, toward: target };
    }
    const tile = addObjectsField({
      tileId: nid,
      tileClass: ncell.tileClass,
      occupants: bridge.listOccupantsOnCell(nid),
    }, tileItemsForAt(itemService, nid, "here"));
    return tile;
  });
}

function exitsEffect(
  extra: McpToolExtra,
): Effect.Effect<
  { here: string; exits: ExitInfo[]; nonAdjacent: NonAdjacentExitInfo[] },
  AuthError | WorldApiError,
  ToolServices
> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const neo = yield* Neo4jGraphService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = map.cells.get(hereId);
    if (!here) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }
    const exits: ExitInfo[] = [];
    for (const dir of COMPASS_DIRECTIONS) {
      const nid = here.neighbors[dir];
      if (nid) {
        exits.push({ toward: dir, tileId: nid });
      }
    }
    const rows = yield* neo.listNonAdjacent(hereId);
    const nonAdjacent: NonAdjacentExitInfo[] = rows.map((r) => {
      const dest = map.cells.get(r.toH3Index);
      const tileClass = dest?.tileClass ?? (r.kind === "PORTAL" ? "Portal" : "Unknown");
      return { kind: r.kind, name: r.name, tileId: r.toH3Index, tileClass };
    });
    return { here: hereId, exits, nonAdjacent };
  });
}

/**
 * Result shape for the `nearest` wayfinding tool.
 * `found: false` means no cell in the connected map matches the spec.
 */
interface NearestResult {
  readonly found: boolean;
  readonly here: string;
  readonly target?: {
    readonly h3Index: string;
    readonly tileClass: string;
    readonly itemRefs: ReadonlyArray<string>;
  };
  /** Hex-grid distance from `here` (number of `go` steps). 0 if already there. */
  readonly distance?: number;
  /** Compass token of the first step to take. Omitted if distance is 0. */
  readonly nextStep?: string;
  /** Reason for found=false. */
  readonly reason?: string;
}

/**
 * BFS from the ghost's current cell over `neighbors` (compass-adjacent only;
 * portals NOT followed) for the nearest cell matching the target spec.
 * Returns the first cell whose items contain an itemRef whose definition's
 * `itemClass` matches (or whose tileClass matches, if `tileClass` is given).
 *
 * The BFS records the FIRST compass step from `here` that led to each
 * discovered cell, so the caller gets a usable directional hint.
 */
function nearestEffect(
  spec: { itemClass?: string; tileClass?: string },
  extra: McpToolExtra,
): Effect.Effect<NearestResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const itemService = yield* ItemService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = map.cells.get(hereId);
    if (!here) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }

    const wantedItemClass = spec.itemClass?.trim();
    const wantedTileClass = spec.tileClass?.trim();
    if (!wantedItemClass && !wantedTileClass) {
      return {
        found: false,
        here: hereId,
        reason: "Pass at least one of itemClass or tileClass.",
      } satisfies NearestResult;
    }

    const sidecar = itemService.getSidecar();
    const matchingItemRefs: Set<string> = new Set();
    if (wantedItemClass) {
      const target = wantedItemClass.toLowerCase();
      for (const [ref, def] of sidecar) {
        // itemClass may be colon-separated multi-label (e.g. "Badge:Sponsor");
        // match any segment.
        const segments = def.itemClass.toLowerCase().split(":");
        if (segments.includes(target)) matchingItemRefs.add(ref);
      }
    }

    const cellMatches = (cellId: string): { hit: boolean; refs: string[] } => {
      const refs = itemService.getItemsOnTile(cellId);
      const itemHits = refs.filter((r) => matchingItemRefs.has(r));
      if (wantedTileClass) {
        const cell = map.cells.get(cellId);
        if (cell?.tileClass.toLowerCase() === wantedTileClass.toLowerCase()) {
          return { hit: true, refs: itemHits };
        }
      }
      if (wantedItemClass && itemHits.length > 0) {
        return { hit: true, refs: itemHits };
      }
      return { hit: false, refs: [] };
    };

    // Same-tile check first.
    const hereHit = cellMatches(hereId);
    if (hereHit.hit) {
      return {
        found: true,
        here: hereId,
        target: { h3Index: hereId, tileClass: here.tileClass, itemRefs: hereHit.refs },
        distance: 0,
      } satisfies NearestResult;
    }

    // BFS. firstStep[cellId] records the compass token of the first hop
    // out of `hereId` on the path that discovered cellId.
    const firstStep = new Map<string, string>();
    const distance = new Map<string, number>();
    distance.set(hereId, 0);
    const queue: string[] = [hereId];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curCell = map.cells.get(cur);
      if (!curCell) continue;
      const curDist = distance.get(cur)!;
      for (const dir of COMPASS_DIRECTIONS) {
        const nid = curCell.neighbors[dir];
        if (!nid || distance.has(nid)) continue;
        distance.set(nid, curDist + 1);
        // First step from origin = the compass we used when popping the
        // origin; for deeper nodes, inherit the parent's first step.
        const step = cur === hereId ? dir : firstStep.get(cur)!;
        firstStep.set(nid, step);

        const hit = cellMatches(nid);
        if (hit.hit) {
          const ncell = map.cells.get(nid)!;
          return {
            found: true,
            here: hereId,
            target: { h3Index: nid, tileClass: ncell.tileClass, itemRefs: hit.refs },
            distance: curDist + 1,
            nextStep: step,
          } satisfies NearestResult;
        }
        queue.push(nid);
      }
    }

    return {
      found: false,
      here: hereId,
      reason: "No matching cell reachable via adjacent steps.",
    } satisfies NearestResult;
  });
}

function goFailureToWorldApi(fromCell: CellId, failure: GoFailure): WorldApiError {
  const code = failure.code;
  if (code === "UNKNOWN_CELL") {
    return new WorldApiUnknownCell({ cellId: String(fromCell) });
  }
  if (code === "MAP_INTEGRITY") {
    return new WorldApiMapIntegrity({ message: failure.reason });
  }
  return new WorldApiMovementBlocked({
    message: failure.reason,
    code: failure.code,
  });
}

function traverseEffect(
  via: string,
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    if (bridge.getGhostMode(ghostId) === "conversational") {
      return yield* Effect.fail(
        new WorldApiMovementBlocked({
          message:
            "Ghost is in conversational mode. Issue 'bye' to end the conversation before moving.",
          code: "IN_CONVERSATION",
        }),
      );
    }
    const neo = yield* Neo4jGraphService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const lookup = neo.configured
      ? async (f: string, v: string) => await Effect.runPromise(neo.findTraverseTarget(f, v))
      : undefined;
    const result = yield* Effect.promise(() => evaluateTraverse(map, hereId, via, lookup));
    if (!result.ok) {
      if (result.code === "UNKNOWN_CELL") {
        return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
      }
      if (result.code === "MAP_INTEGRITY") {
        return yield* Effect.fail(new WorldApiMapIntegrity({ message: result.reason }));
      }
      return yield* Effect.fail(
        new WorldApiMovementBlocked({ message: result.reason, code: result.code }),
      );
    }
    bridge.setGhostCell(ghostId, result.to);
    yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: result.to, reason: "traverse" });
    return result;
  });
}

function goEffect(
  toward: z.infer<typeof compassEnum>,
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    if (bridge.getGhostMode(ghostId) === "conversational") {
      return yield* Effect.fail(
        new WorldApiMovementBlocked({
          message:
            "Ghost is in conversational mode. Issue 'bye' to end the conversation before moving.",
          code: "IN_CONVERSATION",
        }),
      );
    }
    const rules = yield* MovementRulesService;
    const itemService = yield* ItemService;
    const ledger = yield* LedgerService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const hereCell = map.cells.get(hereId);
    const destId = hereCell?.neighbors[toward];
    const destCell = destId ? map.cells.get(destId) : undefined;
    const destGhostCount = destId ? bridge.listOccupantsOnCell(destId).length : undefined;
    const result = evaluateGo(map, hereId, toward, rules, { ghostLabels: new Set() }, {
      destGhostCount,
      itemService,
    });
    if (!result.ok) {
      return yield* Effect.fail(goFailureToWorldApi(hereId, result));
    }

    // Cost enforcement: check for a declared rule cost on this tile-class edge.
    const costKey = hereCell && destCell
      ? `${hereCell.tileClass}:${destCell.tileClass}`
      : undefined;
    const ruleCost = costKey ? rules.ruleCosts.get(costKey) : undefined;
    if (ruleCost) {
      const costs = [{ resource: ruleCost.resource, qty: ruleCost.qty, payee: ruleCost.payee }];
      // Quote (disclose cost to ghost — auto-accept for MVP; checkpoint logic added post-MVP)
      const quote = yield* ledger.quote(ghostId, costs).pipe(
        Effect.mapError((_) =>
          new WorldApiMovementBlocked({
            message: `Cannot afford movement cost: ${ruleCost.qty} ${ruleCost.resource}`,
            code: "INSUFFICIENT_FUNDS",
          })
        )
      );
      // Commit cost transaction
      yield* ledger.commit({
        id: quote.transactionId,
        transfers: costs.map((c) => ({ resource: c.resource, qty: c.qty, from: ghostId, to: c.payee })),
        cause: "go",
        actors: [ghostId],
        ts: Date.now(),
      }).pipe(
        Effect.mapError((err) =>
          new WorldApiMovementBlocked({
            message: err._tag === "LedgerError.InsufficientFunds"
              ? `Cannot afford movement cost: ${ruleCost.qty} ${ruleCost.resource}`
              : `Movement cost payment failed: ${err._tag}`,
            code: err._tag === "LedgerError.InsufficientFunds" ? "INSUFFICIENT_FUNDS" : "MOVEMENT_BLOCKED",
          })
        )
      );
    }

    bridge.setGhostCell(ghostId, result.tileId);
    yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: result.tileId, reason: "go" });
    // Persist position to Redis so cross-pod GET /registry/ghosts/:ghostId stays current.
    const redisStore = yield* RedisGhostStoreService;
    yield* redisStore.patch(ghostId, { h3Index: result.tileId }).pipe(Effect.ignore);

    if (ruleCost) {
      return { ...result, cost: { resource: ruleCost.resource, qty: ruleCost.qty, receipt: "paid" } };
    }
    return result;
  });
}

/**
 * Resolve a `say.to` token to a real ghost ID. Accepts:
 *   - a UUID-shaped string: returned as-is (assume it's already a ghostId)
 *   - any other string: searched against the registry's displayNames
 *     (case-insensitive, exact match). Returns the matched ghostId or
 *     the original token if no match — the original might still be a
 *     non-UUID ghostId from a non-standard adopter.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveToGhostId(
  store: { ghosts: Map<string, { displayName?: string }> },
  to: string,
): string {
  if (UUID_RE.test(to)) return to;
  const target = to.trim().toLowerCase();
  for (const [ghostId, record] of store.ghosts) {
    if (record.displayName && record.displayName.trim().toLowerCase() === target) {
      return ghostId;
    }
  }
  return to;
}

function sayEffect(
  content: string,
  extra: McpToolExtra,
  intent: string,
  to?: string,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const conversation = yield* ConversationService;
    const bridge = yield* WorldBridgeService;
    // Resolve the speaker's persistent displayName from the registry
    // so the stored conversation record carries it. Without this,
    // recipients see the raw ghostId UUID in their inbox / chat
    // (ConversationService falls back to ghostId when displayName is
    // undefined).
    const store = yield* RegistryStoreService;
    const displayName = store.ghosts.get(ghostId)?.displayName;
    // The agent sees peers by displayName in its worldContext (we hide
    // UUIDs from the LLM), so when it sends a directed message it
    // passes the recipient's displayName as `to`. ConversationService
    // routes verbatim — it expects a ghostId — so unresolved
    // displayNames would never reach an inbox. Resolve here.
    const resolvedTo = to == null ? to : resolveToGhostId(store, to);
    const result = yield* (conversation.say(ghostId, content, resolvedTo, displayName, intent).pipe(
      Effect.mapError((e) => {
        if (e instanceof ConversationGhostNoPosition) {
          return new WorldApiNoPosition({ ghostId: e.ghostId }) as WorldApiError;
        }
        return new WorldApiMovementBlocked({ message: e.message, code: "STORE_UNAVAILABLE" }) as WorldApiError;
      }),
    ) as Effect.Effect<SayResult, WorldApiError, never>);
    const priority = to != null ? "DIRECT" : "NEAR";
    for (const lid of result.mx_listeners) {
      bridge.fanoutWorldV1({
        t: "message.new",
        targetGhostId: lid,
        payload: {
          from: ghostId,
          role: "ghost",
          priority,
          text: content,
          intent,
        },
      });
    }
    return result;
  });
}

/**
 * `request_intent` meta-tool: the agent flags that the existing speech
 * `intent` enum lacks an option it wants. The request is returned as
 * the tool result (so it lands in the agent's reasoning trace via the
 * cascade-persistence layer) and logged at the world-api level for
 * direct visibility. No vocabulary growth happens until the project
 * owner reviews the requests and edits the `say` tool's enum — the
 * agent must continue with the closest existing intent for now.
 */
function requestIntentEffect(
  name: string,
  description: string,
  exampleContent: string,
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const store = yield* RegistryStoreService;
    const displayName = store.ghosts.get(ghostId)?.displayName ?? null;
    const requestedAt = new Date().toISOString();
    logJson({
      kind: "world-api.intent-requested",
      ghostId,
      displayName,
      requestedIntent: name.trim(),
      description: description.trim(),
      exampleContent: exampleContent.trim(),
      requestedAt,
    });
    return {
      ok: true,
      acknowledged: true,
      requestedIntent: name.trim(),
      note:
        "Request recorded into your reasoning trace and logged for the project owner. The vocabulary has NOT been changed yet — use the closest existing intent and proceed.",
      requestedAt,
    };
  });
}

function byeEffect(
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const conversation = yield* ConversationService;
    return yield* conversation.bye(ghostId) as Effect.Effect<unknown, never, never>;
  });
}

function inboxEffect(
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const conversation = yield* ConversationService;
    return yield* conversation.inbox(ghostId) as Effect.Effect<unknown, never, never>;
  });
}

function inspectEffect(
  itemRef: string,
  extra: McpToolExtra,
): Effect.Effect<InspectResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const itemService = yield* ItemService;
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    return yield* itemService.inspectItem(hereId, itemRef).pipe(
      Effect.map((item) => ({ ok: true as const, ...item })),
      Effect.catchTags({
        "WorldApiError.ItemNotHere": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_HERE" as const,
            reason: `Item "${itemRef}" is not on your current tile.`,
          }),
        "WorldApiError.ItemNotFound": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_FOUND" as const,
            reason: `Item "${itemRef}" does not exist.`,
          }),
      }),
    );
  });
}

function takeEffect(
  itemRef: string,
  extra: McpToolExtra,
): Effect.Effect<TakeResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const rules = yield* MovementRulesService;
    if (hasRulesetEdge(rules, "PICK_UP")) {
      return {
        ok: false,
        code: "RULESET_DENY",
        reason: "Pick-up rules are loaded, but PICK_UP evaluation is not implemented yet.",
      };
    }
    const itemService = yield* ItemService;
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    return yield* itemService.takeItem(ghostId, hereId, itemRef).pipe(
      Effect.map((item) => ({ ok: true as const, ...item })),
      Effect.catchTags({
        "WorldApiError.ItemNotFound": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_FOUND" as const,
            reason: `Item "${itemRef}" does not exist.`,
          }),
        "WorldApiError.ItemNotHere": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_HERE" as const,
            reason: `Item "${itemRef}" is not on your current tile.`,
          }),
        "WorldApiError.ItemNotCarriable": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_CARRIABLE" as const,
            reason: `Item "${itemRef}" cannot be picked up.`,
          }),
      }),
    );
  });
}

function dropEffect(
  itemRef: string,
  extra: McpToolExtra,
): Effect.Effect<DropResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const rules = yield* MovementRulesService;
    if (hasRulesetEdge(rules, "PUT_DOWN")) {
      return {
        ok: false,
        code: "RULESET_DENY",
        reason: "Drop rules are loaded, but PUT_DOWN evaluation is not implemented yet.",
      };
    }
    const itemService = yield* ItemService;
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const tile = bridge.getLoadedMap().cells.get(hereId);
    if (!tile) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }
    return yield* itemService.dropItem(
      ghostId,
      hereId,
      itemRef,
      tile.capacity,
      bridge.listOccupantsOnCell(hereId).length,
    ).pipe(
      Effect.as({ ok: true as const }),
      Effect.catchTags({
        "WorldApiError.ItemNotCarrying": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_CARRYING" as const,
            reason: `You are not carrying "${itemRef}".`,
          }),
        "WorldApiError.TileFull": () =>
          Effect.succeed({
            ok: false as const,
            code: "TILE_FULL" as const,
            reason: `Tile ${hereId} is at full capacity.`,
          }),
      }),
    );
  });
}

function inventoryEffect(
  extra: McpToolExtra,
): Effect.Effect<InventoryResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const itemService = yield* ItemService;
    const ledgerService = yield* LedgerService;
    const sidecar = itemService.getSidecar();
    const bagResult = yield* Effect.orElse(
      ledgerService.bag(ghostId),
      () => Effect.succeed({ actorId: ghostId, holdings: [] as InventoryResult["holdings"] })
    );
    return {
      ok: true,
      objects: itemService.getGhostInventory(ghostId).map((itemRef) => ({
        itemRef,
        name: sidecar.get(itemRef)?.name ?? itemRef,
      })),
      holdings: bagResult.holdings,
    };
  });
}

function timecheckEffect(
  _extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.sync(() => ({ now: worldNow(), timezone: WORLD_TIMEZONE }));
}

// ---------------------------------------------------------------------------
// Trade tools: offer, request, agree, decline
// ---------------------------------------------------------------------------

function offerEffect(
  input: { to: string; give_resource: string; give_qty: number; for_resource: string; for_qty: number },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const proposals = yield* ProposalService;
    const bridge = yield* WorldBridgeService;
    const either = yield* Effect.either(proposals.propose({
      initiatorId: ghostId,
      counterpartyId: input.to,
      give: { resource: input.give_resource, qty: input.give_qty },
      want: { resource: input.for_resource, qty: input.for_qty },
    }, (id) => bridge.getGhostCell(id)));
    if (either._tag === "Left") {
      const e = either.left;
      return { ok: false, code: e._tag === "LedgerError.CounterpartyNotNearby" ? "COUNTERPARTY_NOT_NEARBY" : "MONOTONIC_TRADE_REJECTED",
        message: e._tag === "LedgerError.CounterpartyNotNearby" ? "Both ghosts must be on the same tile to trade" : `${(e as any).resource ?? "resource"} cannot be traded` };
    }
    const result = either.right;
    return { ok: true, proposalId: result.proposalId, expiresAt: new Date(result.expiresAt).toISOString() };
  });
}

function requestEffect(
  input: { from: string; want_resource: string; want_qty: number; offering_resource: string; offering_qty: number },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const proposals = yield* ProposalService;
    const bridge = yield* WorldBridgeService;
    const either = yield* Effect.either(proposals.propose({
      initiatorId: ghostId,
      counterpartyId: input.from,
      give: { resource: input.offering_resource, qty: input.offering_qty },
      want: { resource: input.want_resource, qty: input.want_qty },
    }, (id) => bridge.getGhostCell(id)));
    if (either._tag === "Left") {
      const e = either.left;
      return { ok: false, code: e._tag === "LedgerError.CounterpartyNotNearby" ? "COUNTERPARTY_NOT_NEARBY" : "MONOTONIC_TRADE_REJECTED",
        message: e._tag === "LedgerError.CounterpartyNotNearby" ? "Both ghosts must be on the same tile to trade" : `${(e as any).resource ?? "resource"} cannot be traded` };
    }
    const result = either.right;
    return { ok: true, proposalId: result.proposalId, expiresAt: new Date(result.expiresAt).toISOString() };
  });
}

function agreeEffect(
  input: { proposalId: string },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const proposals = yield* ProposalService;
    const either = yield* Effect.either(proposals.agree(input.proposalId, ghostId));
    if (either._tag === "Left") {
      const e = either.left;
      const message = e._tag === "LedgerError.SelfAgreeDenied" ? "Only the counterparty can agree to a proposal"
        : e._tag === "LedgerError.ProposalExpired" ? "This proposal has expired"
        : e._tag === "LedgerError.ProposalNotFound" ? "Proposal not found"
        : e._tag === "LedgerError.InsufficientFunds" ? "Insufficient funds for trade"
        : e._tag;
      return { ok: false, code: e._tag.replace("LedgerError.", ""), message };
    }
    const result = either.right;
    return { ok: true, proposalId: result.proposalId, status: result.status };
  });
}

function declineEffect(
  input: { proposalId: string },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId: _ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const proposals = yield* ProposalService;
    const result = yield* proposals.decline(input.proposalId, _ghostId).pipe(
      Effect.mapError(e => new WorldApiMovementBlocked({ message: e._tag, code: "RULESET_DENY" }))
    );
    return { ok: true, proposalId: result.proposalId, status: result.status };
  });
}

function ledgerVerifyEffect(
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    if (!extra.authInfo?.scopes?.includes("admin")) {
      yield* Effect.fail(new AuthMissingCredentials({ message: "ledger_verify requires admin authentication" }));
    }
    const ledger = yield* LedgerService;
    const result = yield* Effect.either(ledger.verify());
    if (result._tag === "Right") {
      return { ok: true, entries: result.right.entries };
    }
    const err = result.left;
    return { ok: false, code: "CHAIN_TAMPERED", atId: err.atId, expectedHash: err.expectedHash, actualHash: err.actualHash };
  });
}

// ---------------------------------------------------------------------------
// Group tools: group.offer, group.vote, group.leave, group.say, group.list
// ---------------------------------------------------------------------------

function groupOfferEffect(
  input: { to: string; resource: string; amount: number; expires_in?: number },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const proposals = yield* ProposalService;
    const groups = yield* GroupService;

    const expiresIn = Math.min(Math.max(input.expires_in ?? 300, 30), 3600);

    // Determine if `to` is a known ghost (formation) or a group (join).
    // Ghost IDs are registered in the registry; group IDs are not.
    const isKnownGhost = store.ghosts.has(input.to);

    if (isKnownGhost) {
      // Group formation: shared offer ghost→ghost (proximity enforced)
      const either = yield* Effect.either(
        proposals.propose(
          {
            initiatorId: ghostId,
            counterpartyId: input.to,
            give: { resource: input.resource, qty: input.amount },
            want: { resource: input.resource, qty: input.amount },
            shared: true,
          },
          (id) => bridge.getGhostCell(id),
        ),
      );
      if (either._tag === "Left") {
        const e = either.left as any;
        const tag: string = e._tag ?? "UNKNOWN";
        const message =
          tag === "LedgerError.CounterpartyNotNearby"
            ? "Both ghosts must be on the same tile to form a group"
            : tag === "GroupError.ResourceMismatch"
            ? "Both sides must offer the same resource type to form a group"
            : tag === "LedgerError.MonotonicTradeRejected"
            ? `${e.resource ?? "resource"} cannot be used for group formation`
            : tag;
        return { ok: false, code: tag.replace(/\w+\./, ""), message };
      }
      const result = either.right;
      return {
        ok: true,
        proposalId: result.proposalId,
        expiresAt: new Date(result.expiresAt).toISOString(),
        type: "formation",
        note: `Offer sent to ${store.ghosts.get(input.to)?.displayName ?? input.to}. They must call agree to form the group.`,
      };
    } else {
      // Group join: ghost→group
      const expiresAt = Date.now() + expiresIn * 1000;
      const either = yield* Effect.either(
        groups.proposeJoin({
          groupId: input.to,
          prospectId: ghostId,
          resource: input.resource,
          amount: input.amount,
          expiresAt,
        }),
      );
      if (either._tag === "Left") {
        const e = either.left as any;
        const tag: string = e._tag ?? "UNKNOWN";
        const message =
          tag === "GroupError.NotFound" ? `Group ${input.to} not found`
          : tag === "GroupError.Dissolved" ? `Group ${input.to} has been dissolved`
          : tag === "GroupError.AntesMismatch" ? `Ante mismatch: expected ${e.expected} ${e.resource}`
          : tag === "GroupError.DuplicateOffer" ? "You already have a pending offer to join this group"
          : tag;
        return { ok: false, code: tag.replace("GroupError.", ""), message };
      }
      const result = either.right;
      return {
        ok: true,
        offerId: result.offerId,
        expiresAt: new Date(result.expiresAt).toISOString(),
        type: "join",
        note: "Join offer posted. Group members have been notified.",
      };
    }
  });
}

function groupVoteEffect(
  input: { group_id: string; offer_id: string; decision: "accept" | "reject" },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const groups = yield* GroupService;
    const either = yield* Effect.either(
      groups.vote({ offerId: input.offer_id, voterId: ghostId, decision: input.decision }),
    );
    if (either._tag === "Left") {
      const e = either.left as any;
      const tag: string = e._tag ?? "UNKNOWN";
      const message =
        tag === "GroupError.OfferNotFound" ? "Offer not found or already resolved"
        : tag === "GroupError.OfferExpired" ? "Offer has expired"
        : tag === "GroupError.NotMember" ? `Not a member of group ${input.group_id}`
        : tag;
      return { ok: false, code: tag.replace("GroupError.", ""), message };
    }
    const result = either.right;
    return { ok: true, resolved: result.resolved, outcome: result.outcome };
  });
}

function groupLeaveEffect(
  input: { group_id: string },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const groups = yield* GroupService;
    const ledger = yield* LedgerService;
    const groupId = input.group_id;

    // Fetch membership to know the contribution before leaving
    const memberships = yield* groups.listMemberships(ghostId);
    const membership = memberships.find(m => m.groupId === groupId);
    if (!membership) {
      return { ok: false, code: "NOT_MEMBER", message: `Not a member of group ${groupId}` };
    }

    const { resource, amount } = membership.myContribution;
    const groupBagId = `group:${groupId}`;

    // Commit ledger leave transaction
    const txId = ulid();
    const txEither = yield* Effect.either(
      ledger.commit({
        id: txId,
        transfers: [{ resource, qty: amount, from: groupBagId, to: ghostId }],
        cause: "group.leave",
        actors: [ghostId],
        ts: Date.now(),
      }),
    );
    if (txEither._tag === "Left") {
      const e = txEither.left as any;
      const tag: string = e._tag ?? "LEDGER_ERROR";
      return { ok: false, code: tag.replace("LedgerError.", ""), message: `Leave failed: ${tag}` };
    }

    const either = yield* Effect.either(groups.leave({ groupId, ghostId, leaveTxId: txId }));
    if (either._tag === "Left") {
      const e = either.left;
      return { ok: false, code: e._tag.replace("GroupError.", ""), message: e._tag };
    }
    const result = either.right;
    const groupName = membership.name;
    const base = `Left group "${groupName}". Returned: ${amount} ${resource} to your bag.`;
    return {
      ok: true,
      message: result.dissolved ? `${base} Group dissolved.` : base,
      dissolved: result.dissolved,
      returned: result.returned,
    };
  });
}

function groupSayEffect(
  input: { group_id: string; content: string },
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const groups = yield* GroupService;
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const senderName = store.ghosts.get(ghostId)?.displayName ?? ghostId;
    const senderTile = bridge.getGhostCell(ghostId) ?? "";

    const either = yield* Effect.either(
      groups.groupSay({ groupId: input.group_id, senderId: ghostId, senderName, content: input.content, senderTile }),
    );
    if (either._tag === "Left") {
      const e = either.left;
      const message =
        e._tag === "GroupError.NotFound" || e._tag === "GroupError.Dissolved"
          ? `Group ${input.group_id} not found or dissolved`
          : e._tag === "GroupError.NotMemberOrParticipant"
          ? `Not a member or participant of group ${input.group_id}`
          : e._tag;
      return { ok: false, code: e._tag.replace("GroupError.", ""), message };
    }
    const result = either.right;
    return { ok: true, messageId: result.messageId, deliveredTo: result.mx_listeners.length };
  });
}

function groupListEffect(
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const groups = yield* GroupService;
    const memberships = yield* groups.listMemberships(ghostId);
    if (memberships.length === 0) {
      return { ok: true, groups: [], message: "You are not a member of any group." };
    }
    const lines = memberships.map(
      m => `- "${m.name}" (group_id: ${m.groupId}) — ${m.memberCount} members, contributed: ${m.myContribution.amount} ${m.myContribution.resource}`,
    );
    return {
      ok: true,
      groups: memberships,
      message: `You are a member of ${memberships.length} group(s):\n${lines.join("\n")}`,
    };
  });
}

function buildGhostMcpServer(servicesLayer: Layer.Layer<ToolServices>): McpServer {
  const runTool = <A>(
    toolName: string,
    input: unknown,
    eff: Effect.Effect<A, AuthError | WorldApiError, ToolServices>,
    extra: McpToolExtra,
  ): Promise<CallToolResult> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const traceId = getRequestTraceId() ?? null;
        logJson({ kind: "mcp.tool", phase: "start", tool: toolName, traceId, input });
        const exit = yield* Effect.exit(Effect.provide(eff, servicesLayer));
        const tid = getRequestTraceId() ?? null;
        Exit.match(exit, {
          onFailure: (cause) => {
            const errOpt = Cause.failureOption(cause);
            if (Option.isSome(errOpt)) {
              const err = errOpt.value as { _tag: string; ghostId?: string; cellId?: string };
              logJson({
                kind: "mcp.tool",
                phase: "end",
                tool: toolName,
                traceId: tid || null,
                outcome: "failure",
                errorTag: err._tag,
                ghostId: err.ghostId ?? null,
                cellId: err.cellId ?? null,
              });
            } else {
              logJson({
                kind: "mcp.tool",
                phase: "end",
                tool: toolName,
                traceId: tid || null,
                outcome: "defect",
                cause: Cause.pretty(cause),
              });
            }
          },
          onSuccess: (value) => {
            const ghostFromResult =
              value && typeof value === "object" && "ghostId" in value && typeof (value as { ghostId: unknown }).ghostId === "string"
                ? (value as { ghostId: string }).ghostId
                : null;
            logJson({
              kind: "mcp.tool",
              phase: "end",
              tool: toolName,
              traceId: tid || null,
              outcome: "success",
              ghostId: ghostFromResult,
            });
          },
        });
        if (Exit.isSuccess(exit)) {
          recordGhostLastActionAfterSuccess(servicesLayer, extra, toolName, input);
        }
        return effectExitToCallToolResult(exit);
      }),
    );

  const server = new McpServer(
    { name: "aie-matrix-world-api", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "whoami",
    {
      description: "Who am I? Resolve this ghost's id and caretaker for the current session.",
    },
    async (extra) => runTool("whoami", {}, whoamiEffect(extra), extra),
  );

  server.registerTool(
    "whereami",
    {
      description: "Where am I standing? Returns the occupied tile id and map coordinates.",
    },
    async (extra) => runTool("whereami", {}, whereamiEffect(extra), extra),
  );

  server.registerTool(
    "look",
    {
      description:
        "Look at your tile, all face-adjacent neighbors, or one compass-facing neighbor. Local frame only — never pass raw map tile ids.",
      inputSchema: {
        at: lookAtSchema.optional().describe("Where to look: here (default), around, or a compass face."),
      },
    },
    async ({ at }, extra) => runTool("look", { at }, lookEffect(at, extra), extra),
  );

  server.registerTool(
    "exits",
    {
      description:
        "List exits from your current tile — compass neighbors (H3 ids) plus named non-adjacent exits (elevators, portals) when configured.",
    },
    async (extra) => runTool("exits", {}, exitsEffect(extra), extra),
  );

  server.registerTool(
    "traverse",
    {
      description:
        "Step through a named non-adjacent exit (elevator, portal) from your current cell. Use exits to discover names.",
      inputSchema: {
        via: z.string().describe("Exit name as returned by exits (e.g. tck-elevator, pentagon-2)."),
      },
    },
    async ({ via }, extra) => runTool("traverse", { via }, traverseEffect(via, extra), extra),
  );

  server.registerTool(
    "nearest",
    {
      description:
        "Find the nearest cell in the world matching a target. Pass an itemClass (e.g. 'PokerTable', 'Badge') and/or a tileClass (e.g. 'Saloon'). Returns the target cell's H3 index, the distance in hexes, and the compass direction of the FIRST step to take to get there. Use this when you have a destination in mind but don't know which way to go — saves wandering blind.",
      inputSchema: {
        itemClass: z
          .string()
          .optional()
          .describe(
            "Match cells whose items include this item class (case-insensitive, matches any segment of colon-separated classes).",
          ),
        tileClass: z
          .string()
          .optional()
          .describe("Match cells whose tile class equals this (case-insensitive)."),
      },
    },
    async ({ itemClass, tileClass }, extra) =>
      runTool(
        "nearest",
        { itemClass, tileClass },
        nearestEffect({ itemClass, tileClass }, extra),
        extra,
      ),
  );

  server.registerTool(
    "go",
    {
      description:
        "Step one hex face from here using a local compass token (n, s, ne, nw, se, sw). Never pass a destination tile id.",
      inputSchema: {
        toward: compassEnum.describe("Which face to step through from your current cell."),
      },
    },
    async ({ toward }, extra) => runTool("go", { toward }, goEffect(toward, extra), extra),
  );

  server.registerTool(
    "say",
    {
      description:
        "Speak to ghosts in your 7-cell H3 cluster. Every utterance MUST declare its INTENT — the social act you're performing by speaking. The intent shapes how recipients interpret you and what world effects (if any) follow. If none of the existing intents fits what you want to do, call `request_intent` to propose adding a new one. Enters conversational mode. Movement is blocked until you issue 'bye'. Optionally send to a specific ghost (name or ghostId) with 'to'.",
      inputSchema: {
        intent: z
          .enum(["greet", "befriend", "propose", "agree", "decline", "depart"])
          .describe(
            "The social act this utterance performs. greet = acknowledge presence. befriend = warm overture, build relationship. propose = suggest a plan or course of action. agree = confirm a previous proposal. decline = refuse a proposal. depart = signal you're leaving (a conversation, a place, the group).",
          ),
        content: z
          .string()
          .min(1)
          .max(2000)
          .describe("The actual words you speak."),
        to: z
          .string()
          .optional()
          .describe("Display name or ghostId of the intended recipient. When set, delivers only to that ghost with DIRECT priority."),
      },
    },
    async ({ intent, content, to }, extra) =>
      runTool(
        "say",
        { intent, content, to },
        sayEffect(content, extra, intent, to),
        extra,
      ),
  );

  server.registerTool(
    "request_intent",
    {
      description:
        "Meta-tool: request that a new speech `intent` be added to the `say` tool's enum. Use when you want to perform a speech act that none of the existing intents fits — e.g. you want to warn, reassure, interrogate, bluff, etc., but the enum only allows greet/befriend/propose/agree/decline/depart. The request is recorded into your memory graph for the project owner to review. After requesting, pick the closest existing intent and proceed (do not stall waiting for the request to be granted).",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(40)
          .describe("Proposed intent name (lowercase, snake_case ideal): e.g. 'warn', 'reassure', 'interrogate'."),
        description: z
          .string()
          .min(1)
          .max(400)
          .describe("Why this intent is needed and how it differs from existing intents."),
        exampleContent: z
          .string()
          .min(1)
          .max(400)
          .describe("An example of what you would have said with this intent in the current situation."),
      },
    },
    async ({ name, description, exampleContent }, extra) =>
      runTool(
        "request_intent",
        { name, description, exampleContent },
        requestIntentEffect(name, description, exampleContent, extra),
        extra,
      ),
  );

  server.registerTool(
    "bye",
    {
      description:
        "End the conversation and return to normal mode, re-enabling movement. No-op if already in normal mode.",
    },
    async (extra) => runTool("bye", {}, byeEffect(extra), extra),
  );

  server.registerTool(
    "inbox",
    {
      description:
        "Return and drain all pending message.new notifications for this ghost. Call periodically to discover messages sent by nearby ghosts.",
    },
    async (extra) => runTool("inbox", {}, inboxEffect(extra), extra),
  );

  server.registerTool(
    "inspect",
    {
      description: "Inspect an item on your current tile and return its name plus optional description.",
      inputSchema: {
        itemRef: z.string().describe("The itemRef to inspect on your current tile."),
      },
    },
    async ({ itemRef }, extra) => runTool("inspect", { itemRef }, inspectEffect(itemRef, extra), extra),
  );

  server.registerTool(
    "take",
    {
      description: "Pick up a carriable item from your current tile into your inventory.",
      inputSchema: {
        itemRef: z.string().describe("The itemRef to take from your current tile."),
      },
    },
    async ({ itemRef }, extra) => runTool("take", { itemRef }, takeEffect(itemRef, extra), extra),
  );

  server.registerTool(
    "drop",
    {
      description: "Drop a carried item onto your current tile if the tile has capacity.",
      inputSchema: {
        itemRef: z.string().describe("The itemRef to drop from your inventory."),
      },
    },
    async ({ itemRef }, extra) => runTool("drop", { itemRef }, dropEffect(itemRef, extra), extra),
  );

  server.registerTool(
    "inventory",
    {
      description: "List the items you are currently carrying. Always succeeds, even when empty.",
    },
    async (extra) => runTool("inventory", {}, inventoryEffect(extra), extra),
  );

  server.registerTool(
    "timecheck",
    {
      description:
        "Return the current conference time (US/Pacific) and timezone. Use this to reason about when scheduled events are happening relative to now.",
    },
    async (extra) => runTool("timecheck", {}, timecheckEffect(extra), extra),
  );

  server.registerTool(
    "ledger_verify",
    {
      description:
        "Admin-only. Re-walk the ledger hash chain from genesis and verify every entry. Returns the number of entries on a clean chain, or details of the first tampered entry. Grant list: admin token only.",
    },
    async (extra) => runTool("ledger_verify", {}, ledgerVerifyEffect(extra), extra),
  );

  server.registerTool(
    "offer",
    {
      description: "Propose a resource trade to another ghost. You offer to give one resource in exchange for another. The counterparty must call `agree` to complete the trade, or either party may `decline`. Monotonic resources (XP, badges) cannot be traded. Both ghosts must be on the same tile.",
      inputSchema: {
        to: z.string().describe("The ghost ID of the counterparty."),
        give_resource: z.string().describe("The resource you are offering to give."),
        give_qty: z.number().int().positive().describe("The quantity you are offering to give."),
        for_resource: z.string().describe("The resource you want in return."),
        for_qty: z.number().int().positive().describe("The quantity you want in return."),
      },
    },
    async ({ to, give_resource, give_qty, for_resource, for_qty }, extra) =>
      runTool("offer", { to, give_resource, give_qty, for_resource, for_qty },
        offerEffect({ to, give_resource, give_qty, for_resource, for_qty }, extra), extra),
  );

  server.registerTool(
    "request",
    {
      description: "Request a resource from another ghost, offering something in return. Same as `offer` but framed from the receiver's perspective. Both ghosts must be on the same tile.",
      inputSchema: {
        from: z.string().describe("The ghost ID to request the resource from."),
        want_resource: z.string().describe("The resource you want to receive."),
        want_qty: z.number().int().positive().describe("The quantity you want to receive."),
        offering_resource: z.string().describe("The resource you are offering in exchange."),
        offering_qty: z.number().int().positive().describe("The quantity you are offering in exchange."),
      },
    },
    async ({ from, want_resource, want_qty, offering_resource, offering_qty }, extra) =>
      runTool("request", { from, want_resource, want_qty, offering_resource, offering_qty },
        requestEffect({ from, want_resource, want_qty, offering_resource, offering_qty }, extra), extra),
  );

  server.registerTool(
    "agree",
    {
      description: "Accept a pending trade proposal. You must be the counterparty — the initiator cannot agree to their own offer. Commits both transfers atomically.",
      inputSchema: {
        proposalId: z.string().describe("The proposal ID returned by `offer` or `request`."),
      },
    },
    async ({ proposalId }, extra) =>
      runTool("agree", { proposalId }, agreeEffect({ proposalId }, extra), extra),
  );

  server.registerTool(
    "decline",
    {
      description: "Cancel or reject a pending trade proposal. Either the initiator or counterparty may call this. No ledger changes occur.",
      inputSchema: {
        proposalId: z.string().describe("The proposal ID to cancel."),
      },
    },
    async ({ proposalId }, extra) =>
      runTool("decline", { proposalId }, declineEffect({ proposalId }, extra), extra),
  );

  server.registerTool(
    "group.offer",
    {
      description:
        "Initiate a shared resource offer for group formation (to a ghost — both must be on the same tile) or to join an existing group (to a group_id). Both sides contribute the same resource and amount. The offer expires after `expires_in` seconds (default 300). For formation: the counterparty must call `agree` to complete. For joining: existing members vote via `group.vote`.",
      inputSchema: {
        to: z.string().describe("Ghost ID (for formation) or group ID (for joining an existing group)."),
        resource: z.string().describe("Resource type to contribute (e.g. 'gold', 'trust')."),
        amount: z.number().int().min(0).describe("Amount to contribute. Use 0 for a communication-only bond."),
        expires_in: z.number().int().min(30).max(3600).optional().describe("Seconds until offer expires (default 300)."),
      },
    },
    async ({ to, resource, amount, expires_in }, extra) =>
      runTool("group.offer", { to, resource, amount, expires_in }, groupOfferEffect({ to, resource, amount, expires_in }, extra), extra),
  );

  server.registerTool(
    "group.vote",
    {
      description:
        "Cast your vote on a pending group admission offer. You must be a current member of the group. A majority of members who vote before expiry determines the outcome. Abstentions do not count as rejections.",
      inputSchema: {
        group_id: z.string().describe("The group ID the offer is for."),
        offer_id: z.string().describe("The offer ID returned when the prospect called group.offer."),
        decision: z.enum(["accept", "reject"]).describe("Your vote."),
      },
    },
    async ({ group_id, offer_id, decision }, extra) =>
      runTool("group.vote", { group_id, offer_id, decision }, groupVoteEffect({ group_id, offer_id, decision }, extra), extra),
  );

  server.registerTool(
    "group.leave",
    {
      description:
        "Leave a group and recover the full amount you contributed. No vote is required. If you are the last member, the group is dissolved.",
      inputSchema: {
        group_id: z.string().describe("The ID of the group to leave."),
      },
    },
    async ({ group_id }, extra) =>
      runTool("group.leave", { group_id }, groupLeaveEffect({ group_id }, extra), extra),
  );

  server.registerTool(
    "group.say",
    {
      description:
        "Post a message to a group chat thread. All members and participants receive it regardless of their location. Does not require conversational mode and does not interrupt movement.",
      inputSchema: {
        group_id: z.string().describe("The ID of the group to post to."),
        content: z.string().describe("The message content."),
      },
    },
    async ({ group_id, content }, extra) =>
      runTool("group.say", { group_id, content }, groupSayEffect({ group_id, content }, extra), extra),
  );

  server.registerTool(
    "group.add_participant",
    {
      description:
        "Add a non-member actor to the group chat as a participant. Participants can send and receive group messages but cannot vote on admissions and contribute no resources. Any group member may call this.",
      inputSchema: {
        group_id: z.string().describe("The group ID to add the participant to."),
        actor_id: z.string().describe("The actor ID to add as a participant."),
        role: z.string().describe("A role label for the participant (e.g. 'observer', 'inquisitor')."),
      },
    },
    async ({ group_id, actor_id, role }, extra) =>
      runTool(
        "group.add_participant",
        { group_id, actor_id, role },
        Effect.gen(function* () {
          yield* requireAuthExtra(extra);
          const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
          const groups = yield* GroupService;
          const either = yield* Effect.either(
            groups.addParticipant({ groupId: group_id, actorId: actor_id, role, requesterId: ghostId }),
          );
          if (either._tag === "Left") {
            const e = either.left as any;
            const tag: string = e._tag ?? "UNKNOWN";
            return { ok: false, code: tag.replace("GroupError.", ""), message: tag };
          }
          return { ok: true, message: `Actor ${actor_id} added as participant with role "${role}".` };
        }),
        extra,
      ),
  );

  server.registerTool(
    "group.remove_participant",
    {
      description:
        "Remove a participant from the group chat. The participant loses access to the group thread immediately. Any group member may call this.",
      inputSchema: {
        group_id: z.string().describe("The group ID to remove the participant from."),
        actor_id: z.string().describe("The actor ID of the participant to remove."),
      },
    },
    async ({ group_id, actor_id }, extra) =>
      runTool(
        "group.remove_participant",
        { group_id, actor_id },
        Effect.gen(function* () {
          yield* requireAuthExtra(extra);
          const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
          const groups = yield* GroupService;
          const either = yield* Effect.either(
            groups.removeParticipant({ groupId: group_id, actorId: actor_id, requesterId: ghostId }),
          );
          if (either._tag === "Left") {
            const e = either.left as any;
            const tag: string = e._tag ?? "UNKNOWN";
            return { ok: false, code: tag.replace("GroupError.", ""), message: tag };
          }
          return { ok: true, message: `Actor ${actor_id} removed from group.` };
        }),
        extra,
      ),
  );

  server.registerTool(
    "group.list",
    {
      description: "List all groups you are currently a member of, with your contribution and member count for each.",
    },
    async (extra) =>
      runTool("group.list", {}, groupListEffect(extra), extra),
  );

  return server;
}

/**
 * Stateless Streamable HTTP MCP handler (one `McpServer` instance per request), per SDK guidance.
 * Requires `WorldBridgeService`, `RegistryStoreService`, `MovementRulesService`, and `Neo4jGraphService` in the Effect context (combined server `ManagedRuntime`).
 */
/** Attempt to authenticate as an admin using ADMIN_TOKEN. Returns admin-scoped authInfo. */
function tryAdminAuth(req: IncomingMessage): AuthInfo | undefined {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) return undefined;
  const token = raw.slice("Bearer ".length).trim();
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || !token) return undefined;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(adminToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  return { token, clientId: "admin", scopes: ["admin"], extra: { ghostId: "admin", caretakerId: undefined, agentHostId: undefined } };
}

export function handleGhostMcpEffect(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
): Effect.Effect<void, AuthError | McpHandlerError, ToolServices> {
  return Effect.gen(function* () {
    const traceId = getRequestTraceId() ?? null;
    logJson({
      kind: "mcp.request",
      phase: "entry",
      traceId,
      method: req.method ?? null,
      path: "/mcp",
    });
    // Accept ghost JWT auth OR admin token auth (for privileged admin-only tools).
    const adminAuth = tryAdminAuth(req);
    const auth = adminAuth ?? (yield* authenticateGhostRequestEffect(req));
    req.auth = auth;
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const rules = yield* MovementRulesService;
    const neo = yield* Neo4jGraphService;
    const conversation = yield* ConversationService;
    const itemService = yield* ItemService;
    const redisGhostStore = yield* RedisGhostStoreService;
    const ledger = yield* LedgerService;
    const calendarSvc = yield* WorldCalendarService;
    const proposalSvc = yield* ProposalService;
    const servicesLayer = Layer.mergeAll(
      Layer.succeed(WorldBridgeService, bridge),
      Layer.succeed(RegistryStoreService, store),
      Layer.succeed(MovementRulesService, rules),
      Layer.succeed(Neo4jGraphService, neo),
      Layer.succeed(ConversationService, conversation),
      Layer.succeed(ItemService, itemService),
      Layer.succeed(RedisGhostStoreService, redisGhostStore),
      Layer.succeed(LedgerService, ledger),
      Layer.succeed(WorldCalendarService, calendarSvc),
      Layer.succeed(ProposalService, proposalSvc),
    ) as Layer.Layer<ToolServices>;
    yield* Effect.tryPromise({
      try: async () => {
        const mcp = buildGhostMcpServer(servicesLayer);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcp.connect(transport);
        try {
          await transport.handleRequest(req, res, parsedBody);
        } finally {
          await Promise.allSettled([transport.close(), mcp.close()]);
        }
      },
      catch: (e) =>
        new McpHandlerError({ message: e instanceof Error ? e.message : String(e) }),
    });
  });
}
