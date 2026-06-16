import { timingSafeEqual } from "node:crypto";
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
  type ConsumeResult,
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
import { consumeFromBag, ensureStipend, foodEnergyWord, foodFuelOf } from "./economy.js";
import { findReachableVendor, listVendors, resolveVendorItem, vendorsOnCell } from "./vendors.js";
import { artworksOnCell, cardsOnCell, findReachableArtwork } from "./artworks.js";

/** Starting gold granted to each ghost the first time it `look`s. 0 = off. */
const GHOST_STIPEND_GOLD = parseInt(process.env.WORLD_GHOST_STIPEND_GOLD ?? "0", 10);

/** Render co-located vending machines as perceivable objects so a ghost
 *  sees what it can buy and for how much — the "offer" half of purchase. */
function vendorObjectsForAt(cell: string, at: TileItemSummary["at"]): TileItemSummary[] {
  return vendorsOnCell(cell).map((v) => ({
    id: v.vendorId,
    // Show price AND a plain-language nourishment cue per item, so a ghost
    // can choose food by how filling it is, not just by what's cheapest
    // (otherwise "spend least gold" picks water over a hearty meal). The
    // energy word is a deterministic lookup — never a raw fuel number.
    name: `${v.label} (buy with gold via request) — ${Object.entries(v.prices)
      .map(([r, p]) => `${r}: ${p}g (${foodEnergyWord(r)})`)
      .join(", ")}`,
    at,
  }));
}

/** Render art on/around a cell as perceivable objects (RFC-0031) — a painting
 *  to `inspect` (its image becomes a prompt) and its description card to
 *  `read` (its href becomes a prompt). Deliberately unframed: a painting, a
 *  card with a link. The ghost decides whether to engage, and how. */
function artObjectsForAt(cell: string, at: TileItemSummary["at"]): TileItemSummary[] {
  const out: TileItemSummary[] = [];
  for (const a of artworksOnCell(cell)) {
    out.push({ id: a.artworkId, name: "A painting hangs here — `inspect` it to look", at });
  }
  for (const a of cardsOnCell(cell)) {
    out.push({ id: `card-${a.cardCell}`, name: "A description card with a link — `read` it", at, href: a.objectUrl });
  }
  return out;
}
import { ProposalService } from "./ProposalService.js";
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
  | ProposalService;

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
    case "WorldApiError.ItemNotConsumable":
      return { ok: false, code: "NOT_CONSUMABLE", reason: `Item "${error.itemRef}" has no consumable energy.` };
    case "WorldApiError.InvalidConsumeAmount":
      return { ok: false, code: "INVALID_AMOUNT", reason: `Invalid consume amount ${error.requested} for "${error.itemRef}".` };
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
  return itemService.getItemsOnTile(h3Index)
    // Vending machines + artworks are placed as gram items (for client
    // rendering) but surfaced to ghosts richly via `vendorObjectsForAt` /
    // `artObjectsForAt`. Skip the raw items to avoid confusing duplicates.
    .filter((itemRef) => itemRef !== "VendingMachine" && itemRef !== "Artwork" && itemRef !== "ArtCard")
    .map((itemRef) => {
      const tokens = itemService.getInstanceTokens(h3Index, itemRef);
      const summary: TileItemSummary = {
        id: itemRef,
        name: sidecar.get(itemRef)?.name ?? itemRef,
        at,
      };
      if (tokens !== undefined) {
        summary.tokens = tokens;
      }
      return summary;
    });
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
    // Grant starting gold on first sight, so the ghost can afford to buy.
    const ledger = yield* LedgerService;
    yield* ensureStipend(ledger, ghostId, GHOST_STIPEND_GOLD);
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
      objects.push(...vendorObjectsForAt(hereId, "here"));
      objects.push(...artObjectsForAt(hereId, "here"));
      for (const dir of COMPASS_DIRECTIONS) {
        const nid = here.neighbors[dir];
        if (!nid) {
          continue;
        }
        objects.push(...tileItemsForAt(itemService, nid, dir));
        objects.push(...vendorObjectsForAt(nid, dir));
        objects.push(...artObjectsForAt(nid, dir));
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

// ─── look_far ──────────────────────────────────────────────────────────────
//
// Like `nearest`, but for OTHER GHOSTS rather than items or tiles. BFS over
// adjacent cells from the caller's current tile until a cell with at least
// one occupant (other than self) is found. Returns the nearest such ghost
// plus the compass direction of the first step to take toward them.
//
// Designed for the "I've looked around and there's nothing interesting
// here — anyone out there?" use case. Cheap server-side (one map walk);
// avoids the agent ring-scanning via repeated `look around` calls.

interface LookFarResult {
  readonly found: boolean;
  readonly here: string;
  readonly target?: {
    readonly ghostId: string;
    readonly h3Index: string;
    readonly tileClass: string;
  };
  /** Hex-grid distance from `here`. 0 if you're already standing on them. */
  readonly distance?: number;
  /** Compass token of the first step to take. Omitted if distance is 0. */
  readonly nextStep?: string;
  /** Reason for found=false. */
  readonly reason?: string;
}

function lookFarEffect(
  extra: McpToolExtra,
): Effect.Effect<LookFarResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const bridge = yield* WorldBridgeService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = map.cells.get(hereId);
    if (!here) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }

    // A "hit" is any cell with at least one occupant other than self.
    const otherOnCell = (cellId: string): string | null => {
      for (const occ of bridge.listOccupantsOnCell(cellId)) {
        if (occ !== ghostId) return occ;
      }
      return null;
    };

    // Same-tile check (shouldn't normally happen — the agent would already
    // see them via `look here` — but handle it defensively).
    const hereOther = otherOnCell(hereId);
    if (hereOther) {
      return {
        found: true,
        here: hereId,
        target: { ghostId: hereOther, h3Index: hereId, tileClass: here.tileClass },
        distance: 0,
      } satisfies LookFarResult;
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
        const step = cur === hereId ? dir : firstStep.get(cur)!;
        firstStep.set(nid, step);

        const otherId = otherOnCell(nid);
        if (otherId) {
          const ncell = map.cells.get(nid)!;
          return {
            found: true,
            here: hereId,
            target: { ghostId: otherId, h3Index: nid, tileClass: ncell.tileClass },
            distance: curDist + 1,
            nextStep: step,
          } satisfies LookFarResult;
        }
        queue.push(nid);
      }
    }

    return {
      found: false,
      here: hereId,
      reason: "No other ghosts reachable via adjacent steps.",
    } satisfies LookFarResult;
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

    // ── Artwork (RFC-0031) ───────────────────────────────────────────────
    // A painting resolved by the viewer's LOCATION (here or adjacent — the
    // same reach as a vending machine). Looking returns the IMAGE itself; the
    // run-loop feeds it into the next cascade as a multimodal prompt. No
    // framing — just the picture. (Its title/era live on the card, not here.)
    const bridge = yield* WorldBridgeService;
    const here = bridge.getLoadedMap().cells.get(hereId);
    const reach = [hereId, ...(here ? Object.values(here.neighbors) : [])];
    const art = findReachableArtwork(reach);
    if (art !== undefined &&
        (itemRef === art.artworkId || itemRef === "Artwork" ||
         itemRef.toLowerCase() === "painting" || itemRef.startsWith("artwork-"))) {
      return {
        ok: true, kind: "artwork", artworkId: art.artworkId, imageUrl: art.imageUrl,
      } as unknown as InspectResult;
    }

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

// ── The ahref function (RFC-0031) ──────────────────────────────────────────
// A description card is a hyperlink to a work's museum object page. `read`
// dereferences it into prompt text. Safety: server-side fetch, cached,
// domain-allowlisted (museums only), sanitized to text + length-capped — no
// arbitrary egress from a ghost, and no live failure after the first read.
const READ_ALLOWED_HOSTS = ["metmuseum.org", "nga.gov"];
const readCache = new Map<string, string>();
const READ_MAX_CHARS = 4000;

function hostAllowed(url: URL): boolean {
  return READ_ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Format a Met Open Access object JSON into the description-card text a ghost
 *  reads — the same facts a museum places on a wall placard. Unframed. */
function formatMetObject(body: string): string {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return "";
  }
  const s = (k: string): string | null => {
    const v = o[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  };
  const lines = [
    s("title"),
    [s("artistDisplayName"), s("artistDisplayBio")].filter(Boolean).join(", ") || null,
    s("objectDate"),
    s("medium"),
    s("dimensions"),
    [s("culture"), s("period"), s("dynasty")].filter(Boolean).join(", ") || null,
    s("department"),
    s("creditLine"),
  ].filter((x): x is string => Boolean(x));
  return lines.join("\n").slice(0, READ_MAX_CHARS);
}

function readEffect(
  href: string,
  extra: McpToolExtra,
): Effect.Effect<unknown, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return { ok: false, code: "BAD_LINK", message: `Not a readable link: ${href}` };
    }
    if (url.protocol !== "https:" || !hostAllowed(url)) {
      return { ok: false, code: "LINK_NOT_ALLOWED", message: "That link can't be read — only museum object pages are readable." };
    }
    const key = url.toString();
    // A Met object page is a bot-hostile JS app (429s a plain fetch). The
    // object id is in the URL, so resolve it through the Open Access API
    // instead — clean, canonical card data, no scraping. Other allow-listed
    // hosts fall back to fetch + strip.
    const metId = url.hostname.endsWith("metmuseum.org")
      ? (url.pathname.match(/(\d+)\/?$/)?.[1] ?? null)
      : null;
    const fetchUrl = metId !== null
      ? `https://collectionapi.metmuseum.org/public/collection/v1/objects/${metId}`
      : key;

    let text = readCache.get(key);
    if (text === undefined) {
      const fetched = yield* Effect.either(
        Effect.tryPromise({
          try: async () => {
            const r = await fetch(fetchUrl, { headers: { "User-Agent": "aie-matrix-ghost/1.0" } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.text();
          },
          catch: (e) => new Error(String(e)),
        }),
      );
      if (fetched._tag === "Left") {
        return { ok: false, code: "READ_FAILED", message: "Could not read the card's page." };
      }
      text = metId !== null
        ? formatMetObject(fetched.right)
        : htmlToText(fetched.right).slice(0, READ_MAX_CHARS);
      if (text.length === 0) {
        return { ok: false, code: "READ_FAILED", message: "Could not read the card's page." };
      }
      readCache.set(key, text);
    }
    return { ok: true, kind: "page", url: key, text };
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

function consumeEffect(
  itemRef: string,
  amount: number | undefined,
  extra: McpToolExtra,
): Effect.Effect<ConsumeResult, AuthError | WorldApiError, ToolServices> {
  return Effect.gen(function* () {
    yield* requireAuthExtra(extra);
    const { ghostId } = yield* ghostIdsFromAuthEffect(extra.authInfo!);
    const itemService = yield* ItemService;

    // Item→ledger model (RFC-0029): if the ghost CARRIES this item as a
    // ledger resource (e.g. bought from a vendor), consume it from the
    // bag — one unit returns to the world pool, Fuel comes from the food
    // table. Falls through to the legacy tile-consume below when the ghost
    // holds none in its bag (ground food / food-rain during the transition).
    const ledger = yield* LedgerService;
    const fromBag = yield* consumeFromBag(ledger, ghostId, itemRef, foodFuelOf).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );
    if (fromBag && fromBag.ok) {
      return {
        ok: true as const,
        itemRef: fromBag.itemRef,
        consumed: fromBag.consumed,
        remaining: fromBag.remaining,
        depleted: fromBag.remaining <= 0,
        nourishment: foodEnergyWord(fromBag.itemRef),
      };
    }

    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    return yield* itemService.consumeItem(hereId, itemRef, amount).pipe(
      Effect.map((r) => ({
        ok: true as const,
        itemRef: r.itemRef,
        consumed: r.consumed,
        remaining: r.remaining,
        depleted: r.depleted,
        nourishment: foodEnergyWord(r.itemRef),
      })),
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
        "WorldApiError.ItemNotConsumable": () =>
          Effect.succeed({
            ok: false as const,
            code: "NOT_CONSUMABLE" as const,
            reason: `Item "${itemRef}" has no consumable energy.`,
          }),
        "WorldApiError.InvalidConsumeAmount": ({ requested }) =>
          Effect.succeed({
            ok: false as const,
            code: "INVALID_AMOUNT" as const,
            reason: `Invalid consume amount ${requested} — must be a positive number.`,
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
      objects: itemService.getGhostInventory(ghostId).map((itemRef) => {
        const tokens = itemService.getInventoryTokens(ghostId, itemRef);
        const out: { itemRef: string; name: string; tokens?: number } = {
          itemRef,
          name: sidecar.get(itemRef)?.name ?? itemRef,
        };
        if (tokens !== undefined) out.tokens = tokens;
        return out;
      }),
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

    // ── Vending machine purchase (RFC-0029) ──────────────────────────────
    // A machine is resolved by the BUYER'S LOCATION, not the `from` string:
    // the model can't know a machine's opaque id and shouldn't have to — it's
    // standing next to one. Reach = the buyer's cell or an adjacent one (the
    // 7-cell cluster, same reach as `say`). A vending machine is a scripted
    // fixed-price fixture, so it charges its LISTED price (the model never has
    // to guess the exact gold — that would be a calculator strapped to it),
    // and the ledger enforces stock + funds on agree.
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = bridge.getLoadedMap().cells.get(hereId);
    const reachCells = [hereId, ...(here ? Object.values(here.neighbors) : [])];
    const vendor = findReachableVendor(reachCells);
    if (vendor !== undefined && input.offering_resource === "gold") {
      const item = resolveVendorItem(vendor, input.want_resource);
      if (item === undefined) {
        return { ok: false, code: "VENDOR_DECLINED", message: `${vendor.label} doesn't sell "${input.want_resource}".` };
      }
      const price = vendor.prices[item] * input.want_qty; // listed price is authoritative — no haggling
      // Map both actors to the buyer's cell so the ledger's proximity check
      // passes (reach already verified), then auto-agree on the machine's
      // behalf — purchase is just propose + auto-agree, no new trade machinery.
      const propose = yield* Effect.either(proposals.propose({
        initiatorId: ghostId,
        counterpartyId: vendor.vendorId,
        give: { resource: "gold", qty: price },
        want: { resource: item, qty: input.want_qty },
      }, () => hereId));
      if (propose._tag === "Left") {
        return { ok: false, code: propose.left._tag.replace("LedgerError.", ""), message: `Cannot buy: ${propose.left._tag}` };
      }
      const agreed = yield* Effect.either(proposals.agree(propose.right.proposalId, vendor.vendorId));
      if (agreed._tag === "Left") {
        const e = agreed.left;
        const message = e._tag === "LedgerError.InsufficientFunds"
          ? `You can't afford ${item} (it costs ${price} gold) — or the machine is out of stock.`
          : e._tag;
        return { ok: false, code: e._tag.replace("LedgerError.", ""), message };
      }
      return { ok: true, purchased: true, vendor: vendor.label, itemRef: item, qty: input.want_qty, paid: price, nourishment: foodEnergyWord(item) };
    }

    // ── Vending attempt that didn't land on a machine ───────────────────
    // Offering gold for food but no machine in reach: the ghost is trying to
    // buy, not trade with another ghost. Don't drop it into the ghost-trade
    // path (whose "both ghosts must be on the same tile" message teaches the
    // ghost nothing) — tell it where the nearest machine is so it can step
    // onto it. BFS over the navigable graph for the closest registered vendor.
    if (input.offering_resource === "gold" &&
        (input.want_resource === "food" || input.want_resource.startsWith("food"))) {
      const map = bridge.getLoadedMap();
      const vendorCells = new Set(listVendors().map((v) => v.cell));
      const dist = new Map<string, number>([[hereId, 0]]);
      const firstStep = new Map<string, string>();
      const queue: string[] = [hereId];
      let nearest: { distance: number; nextStep?: string } | undefined;
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const curCell = map.cells.get(cur);
        if (!curCell) continue;
        const curDist = dist.get(cur)!;
        for (const dir of COMPASS_DIRECTIONS) {
          const nid = curCell.neighbors[dir];
          if (!nid || dist.has(nid)) continue;
          dist.set(nid, curDist + 1);
          firstStep.set(nid, cur === hereId ? dir : firstStep.get(cur)!);
          if (vendorCells.has(nid)) { nearest = { distance: curDist + 1, nextStep: firstStep.get(nid) }; break; }
          queue.push(nid);
        }
        if (nearest) break;
      }
      const where = nearest
        ? `The nearest vending machine is ${nearest.distance} tile${nearest.distance === 1 ? "" : "s"} away${nearest.nextStep ? ` to the ${nearest.nextStep}` : ""} — move onto it (or right beside it), then buy.`
        : "No vending machine is reachable from here.";
      return { ok: false, code: "VENDOR_NOT_NEARBY", message: `You must be at a vending machine to buy food. ${where}` };
    }

    // ── Ghost-to-ghost trade proposal (must be same tile) ────────────────
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
    "look_far",
    {
      description:
        "Returns the bearing (distance + first compass step) to the nearest other ghost anywhere on the map.",
      inputSchema: {},
    },
    async (_args, extra) => runTool("look_far", {}, lookFarEffect(extra), extra),
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
        "Speak to ghosts in your 7-cell H3 cluster. `intent` is an OPTIONAL non-verbal/social-register tag describing the communicative act — how the words land, not what they commit to. World-changing acts (proposing trades, agreeing, declining, leaving) are NOT spoken — they have dedicated tools (`offer`, `agree`, `decline`, `bye`). If none of the existing intents fits the social register you want, call `request_intent` to propose adding a new non-verbal cue. Enters conversational mode. Movement is blocked until you issue 'bye'. Optionally send to a specific ghost (name or ghostId) with 'to'.",
      inputSchema: {
        intent: z
          .enum(["greet", "befriend"])
          .default("greet")
          .describe(
            "Optional non-verbal/social-register tag for this utterance. greet = acknowledge presence. befriend = warm overture, build relationship. Defaults to greet when unspecified. Does NOT trigger any world effect — it is metadata recipients use to interpret tone. For state-changing acts, use the dedicated tools.",
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
        "Meta-tool: request that a new non-verbal/social-register cue be added to the `say` tool's intent enum. Use when you want your utterance to carry a register that none of the existing intents fits — e.g. warn, reassure, mock, console — but the enum only allows greet/befriend. Intent is communicative metadata only; it does NOT trigger world effects (those are owned by dedicated tools like `offer`, `agree`, `decline`, `bye`). The request is recorded into your memory graph for the project owner to review. After requesting, pick the closest existing intent and proceed (do not stall waiting for the request to be granted).",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(40)
          .describe("Proposed intent name (lowercase, snake_case ideal): e.g. 'warn', 'reassure', 'console'. Must describe a communicative register, not a state-changing act."),
        description: z
          .string()
          .min(1)
          .max(400)
          .describe("Why this register is needed and how it differs from existing intents. Reject anything that overlaps with explicit world-action tools."),
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
      description: "Inspect an item on (or beside) your current tile. For a painting, this is how you LOOK at it — the picture itself comes back to you.",
      inputSchema: {
        itemRef: z.string().describe("The itemRef to inspect — e.g. an item on your tile, or a painting's id to look at it."),
      },
    },
    async ({ itemRef }, extra) => runTool("inspect", { itemRef }, inspectEffect(itemRef, extra), extra),
  );

  server.registerTool(
    "read",
    {
      description: "Follow a link and read it. Use it on a description card's link (beside a painting) to read about the work; the page's text comes back to you.",
      inputSchema: {
        href: z.string().describe("The link to read — e.g. the href shown on a description card."),
      },
    },
    async ({ href }, extra) => runTool("read", { href }, readEffect(href, extra), extra),
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
    "consume",
    {
      description:
        "Consume some or all of a consumable item's energy on your current tile (e.g. eat food). Defaults to taking everything the instance has left; pass `amount` to take only a portion. Returns the actual amount transferred to you and what's left on the item.",
      inputSchema: {
        itemRef: z.string().describe("The itemRef of the item to consume from your current tile."),
        amount: z
          .number()
          .positive()
          .optional()
          .describe(
            "How many tokens to consume. Omit to take everything available (the typical case). Values above remaining are clamped down.",
          ),
      },
    },
    async ({ itemRef, amount }, extra) =>
      runTool("consume", { itemRef, amount }, consumeEffect(itemRef, amount, extra), extra),
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
      description: "Acquire a resource in exchange for another. Two uses: (1) BUY from a VENDING MACHINE — when you're at or next to one (you'll see it in `look`), offer `gold` and name the food in `want_resource` (a specific id like food-bread / food-cake, or just `food`); the machine charges its listed price and dispenses on the spot — no agreement, no haggling. (2) Trade with another ghost on your tile — put their id in `from`; they must `agree`.",
      inputSchema: {
        from: z.string().describe("The other ghost's id for a ghost-to-ghost trade. Ignored when buying from a vending machine you're standing at."),
        want_resource: z.string().describe("The resource you want to receive — a food id like food-bread when buying, or just `food`."),
        want_qty: z.number().int().positive().describe("The quantity you want to receive."),
        offering_resource: z.string().describe("The resource you are offering in exchange — `gold` when buying food."),
        offering_qty: z.number().int().positive().describe("The quantity you are offering. A vending machine charges its own listed price regardless, so this is only binding in a ghost-to-ghost trade."),
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
