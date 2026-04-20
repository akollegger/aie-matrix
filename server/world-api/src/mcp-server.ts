import type { IncomingMessage, ServerResponse } from "node:http";
import type { CellId } from "@aie-matrix/server-colyseus";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { z } from "zod";
import {
  COMPASS_DIRECTIONS,
  type ExitInfo,
  type GoFailure,
  type NonAdjacentExitInfo,
  type TileInspectResult,
  type WhereAmIResult,
  type WhoAmIResult,
} from "@aie-matrix/shared-types";
import {
  authenticateGhostRequestEffect,
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
import { getRequestTraceId } from "./request-trace.js";

type McpToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const compassEnum = z.enum(["n", "s", "ne", "nw", "se", "sw"]);

const lookAtSchema = z.union([z.literal("here"), z.literal("around"), compassEnum]);

type ToolServices = WorldBridgeService | RegistryStoreService | MovementRulesService | Neo4jGraphService;

function logJson(record: Record<string, unknown>): void {
  console.info(JSON.stringify(record));
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
    default:
      return { error: "WORLD_API", message: String(error) };
  }
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
 */
function authoritativeGhostTileEffect(
  ghostId: string,
): Effect.Effect<CellId, WorldApiNoPosition, ToolServices> {
  return Effect.gen(function* () {
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const raw = bridge.getGhostCell(ghostId) as CellId | undefined;
    yield* logMcpBridgeOp("getGhostCell", { ghostId, cellId: raw ?? null });
    const fromRoom = normalizeCellId(raw);
    if (fromRoom !== undefined) {
      return fromRoom;
    }
    const regRaw = store.ghosts.get(ghostId)?.h3Index;
    const fromReg = normalizeCellId(regRaw);
    if (fromReg !== undefined) {
      bridge.setGhostCell(ghostId, fromReg);
      yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: fromReg, reason: "reseed-from-registry" });
      return fromReg;
    }
    return yield* Effect.fail(new WorldApiNoPosition({ ghostId }));
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
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const here = map.cells.get(hereId);
    if (!here) {
      return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
    }
    const target = at ?? "here";
    if (target === "here") {
      const occupants = bridge.listOccupantsOnCell(hereId);
      const tile: TileInspectResult = {
        tileId: hereId,
        tileClass: here.tileClass,
        occupants,
      };
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
        tiles.push({
          tileId: nid,
          tileClass: ncell.tileClass,
          occupants: bridge.listOccupantsOnCell(nid),
        });
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
    const tile: TileInspectResult = {
      tileId: nid,
      tileClass: ncell.tileClass,
      occupants: bridge.listOccupantsOnCell(nid),
    };
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
    const neo = yield* Neo4jGraphService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const result = yield* Effect.promise(() =>
      evaluateTraverse(map, hereId, via, async (f, v) => await Effect.runPromise(neo.findTraverseTarget(f, v))),
    );
    if (!result.ok) {
      if (result.code === "UNKNOWN_CELL") {
        return yield* Effect.fail(new WorldApiUnknownCell({ cellId: String(hereId) }));
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
    const rules = yield* MovementRulesService;
    const map = bridge.getLoadedMap();
    const hereId = yield* authoritativeGhostTileEffect(ghostId);
    const result = evaluateGo(map, hereId, toward, rules, { ghostLabels: new Set() });
    if (!result.ok) {
      return yield* Effect.fail(goFailureToWorldApi(hereId, result));
    }
    bridge.setGhostCell(ghostId, result.tileId);
    yield* logMcpBridgeOp("setGhostCell", { ghostId, cellId: result.tileId, reason: "go" });
    return result;
  });
}

function buildGhostMcpServer(servicesLayer: Layer.Layer<ToolServices>): McpServer {
  const runTool = <A>(
    toolName: string,
    input: unknown,
    eff: Effect.Effect<A, AuthError | WorldApiError, ToolServices>,
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
    async (extra) => runTool("whoami", {}, whoamiEffect(extra)),
  );

  server.registerTool(
    "whereami",
    {
      description: "Where am I standing? Returns the occupied tile id and map coordinates.",
    },
    async (extra) => runTool("whereami", {}, whereamiEffect(extra)),
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
    async ({ at }, extra) => runTool("look", { at }, lookEffect(at, extra)),
  );

  server.registerTool(
    "exits",
    {
      description:
        "List exits from your current tile — compass neighbors (H3 ids) plus named non-adjacent exits (elevators, portals) when configured.",
    },
    async (extra) => runTool("exits", {}, exitsEffect(extra)),
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
    async ({ via }, extra) => runTool("traverse", { via }, traverseEffect(via, extra)),
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
    async ({ toward }, extra) => runTool("go", { toward }, goEffect(toward, extra)),
  );

  return server;
}

/**
 * Stateless Streamable HTTP MCP handler (one `McpServer` instance per request), per SDK guidance.
 * Requires `WorldBridgeService`, `RegistryStoreService`, `MovementRulesService`, and `Neo4jGraphService` in the Effect context (combined server `ManagedRuntime`).
 */
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
    const auth = yield* authenticateGhostRequestEffect(req);
    req.auth = auth;
    const bridge = yield* WorldBridgeService;
    const store = yield* RegistryStoreService;
    const rules = yield* MovementRulesService;
    const neo = yield* Neo4jGraphService;
    const servicesLayer = Layer.mergeAll(
      Layer.succeed(WorldBridgeService, bridge),
      Layer.succeed(RegistryStoreService, store),
      Layer.succeed(MovementRulesService, rules),
      Layer.succeed(Neo4jGraphService, neo),
    );
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
