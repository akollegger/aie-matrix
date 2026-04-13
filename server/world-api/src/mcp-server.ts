import type { IncomingMessage, ServerResponse } from "node:http";
import type { CellId } from "@aie-matrix/server-colyseus";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  COMPASS_DIRECTIONS,
  type ExitInfo,
  type TileInspectResult,
  type WhereAmIResult,
  type WhoAmIResult,
} from "@aie-matrix/shared-types";
import { authenticateGhostRequest, ghostIdsFromAuth } from "./auth-context.js";
import type { ColyseusWorldBridge } from "./colyseus-bridge.js";
import { evaluateGo } from "./movement.js";

const compassEnum = z.enum(["n", "s", "ne", "nw", "se", "sw"]);

const lookAtSchema = z.union([z.literal("here"), z.literal("around"), compassEnum]);

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(message: string, code?: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, message, code }) }],
  };
}

/**
 * Colyseus `ghostTiles` is authoritative, but the in-memory registry still holds each
 * ghost’s last known `tileId` from adopt / moves. If the room map lost the entry (e.g.
 * process hiccup), re-seed from the registry so MCP tools keep working.
 */
function authoritativeGhostTile(
  bridge: ColyseusWorldBridge,
  getRegistryGhostTile: ((ghostId: string) => string | undefined) | undefined,
  ghostId: string,
): CellId | undefined {
  const raw = bridge.getGhostCell(ghostId) as CellId | undefined;
  const tile =
    raw !== undefined && raw !== null && String(raw).trim() !== "" ? (String(raw).trim() as CellId) : undefined;
  if (tile !== undefined) {
    return tile;
  }
  const regRaw = getRegistryGhostTile?.(ghostId);
  const reg =
    regRaw !== undefined && regRaw !== null && String(regRaw).trim() !== ""
      ? (String(regRaw).trim() as CellId)
      : undefined;
  if (reg !== undefined) {
    bridge.setGhostCell(ghostId, reg);
    return reg;
  }
  return undefined;
}

function buildGhostMcpServer(
  bridge: ColyseusWorldBridge,
  getRegistryGhostTile?: (ghostId: string) => string | undefined,
): McpServer {
  const server = new McpServer(
    { name: "aie-matrix-world-api", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "whoami",
    {
      description: "Who am I? Resolve this ghost's id and caretaker for the current session.",
    },
    async (extra) => {
      try {
        if (!extra.authInfo) {
          return toolError("Missing ghost credentials on MCP session", "UNAUTHORIZED");
        }
        const { ghostId, caretakerId } = ghostIdsFromAuth(extra.authInfo);
        const out: WhoAmIResult = { ghostId, caretakerId };
        return textResult(out);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e), "AUTH_CONTEXT");
      }
    },
  );

  server.registerTool(
    "whereami",
    {
      description: "Where am I standing? Returns the occupied tile id and map coordinates.",
    },
    async (extra) => {
      try {
        if (!extra.authInfo) {
          return toolError("Missing ghost credentials on MCP session", "UNAUTHORIZED");
        }
        const { ghostId } = ghostIdsFromAuth(extra.authInfo);
        const map = bridge.getLoadedMap();
        const tileId = authoritativeGhostTile(bridge, getRegistryGhostTile, ghostId);
        if (!tileId) {
          return toolError("Ghost has no authoritative tile yet", "NO_POSITION");
        }
        const cell = map.cells.get(tileId as CellId);
        if (!cell) {
          return toolError("Ghost tile is not present in the loaded map", "UNKNOWN_CELL");
        }
        const out: WhereAmIResult = { tileId, col: cell.col, row: cell.row };
        return textResult(out);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e), "WHEREAMI");
      }
    },
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
    async ({ at }, extra) => {
      try {
        if (!extra.authInfo) {
          return toolError("Missing ghost credentials on MCP session", "UNAUTHORIZED");
        }
        const { ghostId } = ghostIdsFromAuth(extra.authInfo);
        const map = bridge.getLoadedMap();
        const hereId = authoritativeGhostTile(bridge, getRegistryGhostTile, ghostId);
        if (!hereId) {
          return toolError("Ghost has no authoritative tile yet", "NO_POSITION");
        }
        const here = map.cells.get(hereId);
        if (!here) {
          return toolError("Ghost tile is not present in the loaded map", "UNKNOWN_CELL");
        }
        const target = at ?? "here";
        if (target === "here") {
          const occupants = bridge.listOccupantsOnCell(hereId);
          const tile: TileInspectResult = {
            tileId: hereId,
            tileClass: here.tileClass,
            occupants,
          };
          return textResult(tile);
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
          return textResult({ neighbors: tiles });
        }
        const nid = here.neighbors[target];
        if (!nid) {
          return textResult({ empty: true, toward: target });
        }
        const ncell = map.cells.get(nid);
        if (!ncell) {
          return textResult({ empty: true, toward: target });
        }
        const tile: TileInspectResult = {
          tileId: nid,
          tileClass: ncell.tileClass,
          occupants: bridge.listOccupantsOnCell(nid),
        };
        return textResult(tile);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e), "LOOK");
      }
    },
  );

  server.registerTool(
    "exits",
    {
      description: "List exits from your current tile — compass direction and neighbor tile id only.",
    },
    async (extra) => {
      try {
        if (!extra.authInfo) {
          return toolError("Missing ghost credentials on MCP session", "UNAUTHORIZED");
        }
        const { ghostId } = ghostIdsFromAuth(extra.authInfo);
        const map = bridge.getLoadedMap();
        const hereId = authoritativeGhostTile(bridge, getRegistryGhostTile, ghostId);
        if (!hereId) {
          return toolError("Ghost has no authoritative tile yet", "NO_POSITION");
        }
        const here = map.cells.get(hereId);
        if (!here) {
          return toolError("Ghost tile is not present in the loaded map", "UNKNOWN_CELL");
        }
        const exits: ExitInfo[] = [];
        for (const dir of COMPASS_DIRECTIONS) {
          const nid = here.neighbors[dir];
          if (nid) {
            exits.push({ toward: dir, tileId: nid });
          }
        }
        return textResult({ exits });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e), "EXITS");
      }
    },
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
    async ({ toward }, extra) => {
      try {
        if (!extra.authInfo) {
          return toolError("Missing ghost credentials on MCP session", "UNAUTHORIZED");
        }
        const { ghostId } = ghostIdsFromAuth(extra.authInfo);
        const map = bridge.getLoadedMap();
        const hereId = authoritativeGhostTile(bridge, getRegistryGhostTile, ghostId);
        if (!hereId) {
          return toolError("Ghost has no authoritative tile yet", "NO_POSITION");
        }
        const result = evaluateGo(map, hereId, toward);
        if (!result.ok) {
          return textResult(result);
        }
        bridge.setGhostCell(ghostId, result.tileId);
        return textResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e), "GO");
      }
    },
  );

  return server;
}

/**
 * Stateless Streamable HTTP MCP handler (one `McpServer` instance per request), per SDK guidance.
 */
export async function handleGhostMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  bridge: ColyseusWorldBridge,
  getRegistryGhostTile?: (ghostId: string) => string | undefined,
): Promise<void> {
  const auth = authenticateGhostRequest(req);
  if (!auth) {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ error: "UNAUTHORIZED", message: "Bearer JWT required for MCP" }));
    return;
  }
  req.auth = auth;
  const mcp = buildGhostMcpServer(bridge, getRegistryGhostTile);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  try {
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    await Promise.allSettled([transport.close(), mcp.close()]);
  }
}
