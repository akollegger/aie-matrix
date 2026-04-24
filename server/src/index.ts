import { randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatrixRoom } from "@aie-matrix/server-colyseus";
import { createRegistryRequestListener, createRegistryStore } from "@aie-matrix/server-registry";
import {
  broadcastInitialItemState,
  createColyseusBridge,
  createNeo4jDriverFromEnv,
  ensureCellH3UniqueConstraint,
  getRequestTraceId,
  handleGhostMcpEffect,
  loadMovementRulesFromEnv,
  makeLiveNeo4jGraphLayer,
  makeMovementRulesLayer,
  makeNoOpNeo4jGraphLayer,
  makeItemServiceLayer,
  makeRegistryStoreLayer,
  makeWorldBridgeLayer,
  Neo4jGraphService,
  ItemService,
  ItemServiceImpl,
  runWithRequestTrace,
  seedNeo4jGraphArtifacts,
  type MovementRulesService,
  type RegistryStoreService,
  type WorldBridgeService,
} from "@aie-matrix/server-world-api";
import { Effect, Layer, ManagedRuntime } from "effect";
import { isEnvTruthy, loadRootEnv } from "@aie-matrix/root-env";
import {
  ConversationService,
  JsonlStore,
  createConversationRouter,
  makeConversationLayer,
} from "@aie-matrix/server-conversation";
import { patchMatchmakeCorsForCredentials } from "./colyseus-cors-patch.js";
import { errorToResponse, type HttpMappingError } from "./errors.js";
import { makeServerConfigLayer, type ServerConfigService } from "./services/ServerConfigService.js";

loadRootEnv();
if (isEnvTruthy(process.env.AIE_MATRIX_DEBUG)) {
  console.info(
    "[aie-matrix] AIE_MATRIX_DEBUG is on; MatrixRoom logs each setGhostCell when ghosts move",
  );
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const httpPort = Number(process.env.AIE_MATRIX_HTTP_PORT ?? "8787");
const mapPathRaw = process.env.AIE_MATRIX_MAP;
const mapPath = mapPathRaw
  ? (isAbsolute(mapPathRaw) ? mapPathRaw : join(repoRoot, mapPathRaw))
  : join(repoRoot, "maps/sandbox/freeplay.tmj");
const mapsRoot = normalize(join(repoRoot, "maps"));
const conversationDataDir =
  process.env.CONVERSATION_DATA_DIR ?? join(process.cwd(), "data/conversations");

/** PoC-wide CORS for browser clients (Phaser on Vite, etc.). */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, mcp-protocol-version, X-Requested-With, Origin",
  "Access-Control-Max-Age": "86400",
};

function mapContentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".png":
      return "image/png";
    case ".tmj":
      return "application/json";
    case ".tsx":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

/** Serves `GET /maps/**` from the repo `maps/` tree (dev convenience for Phaser). */
function serveMapsIfMatched(urlPath: string, res: import("node:http").ServerResponse): boolean {
  if (!urlPath.startsWith("/maps/")) {
    return false;
  }
  const decoded = decodeURIComponent(urlPath);
  const relativeFromRoot = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const absolute = normalize(join(repoRoot, relativeFromRoot));
  const prefix = mapsRoot.endsWith(sep) ? mapsRoot : `${mapsRoot}${sep}`;
  if (absolute !== mapsRoot && !absolute.startsWith(prefix)) {
    res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders });
    res.end("Forbidden");
    return true;
  }
  try {
    const st = statSync(absolute);
    if (!st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders }).end("Not found");
      return true;
    }
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders }).end("Not found");
    return true;
  }
  res.writeHead(200, {
    "Content-Type": mapContentType(absolute),
    ...corsHeaders,
  });
  createReadStream(absolute).pipe(res);
  return true;
}

async function readRequestBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  await readFile(mapPath);

  patchMatchmakeCorsForCredentials();

  const httpServer = createServer();
  const store = createRegistryStore();
  const internalFanoutToken = process.env.AIE_MATRIX_INTERNAL_FANOUT_TOKEN?.trim() ?? "";
  let matrixRoomId: string | undefined;
  const worldApiBaseUrl = `http://127.0.0.1:${httpPort}/mcp`;

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define("matrix", MatrixRoom);
  await gameServer.listen(httpPort);
  const rawItemsPath = process.env.AIE_MATRIX_ITEMS?.trim();
  const itemsPath = rawItemsPath
    ? (isAbsolute(rawItemsPath) ? rawItemsPath : join(repoRoot, rawItemsPath))
    : undefined;
  const listing = await matchMaker.createRoom("matrix", { mapPath, itemsPath });
  const room = matchMaker.getRoomById(listing.roomId);
  if (!(room instanceof MatrixRoom)) {
    throw new Error("Expected MatrixRoom instance from matchmaker");
  }
  const colyseusBridge = createColyseusBridge(room);
  const ghostAuthority = new Map<string, string>();
  const bridge = {
    getLoadedMap: () => colyseusBridge.getLoadedMap(),
    getGhostCell(ghostId: string): string | undefined {
      const gid = String(ghostId).trim();
      const traceId = getRequestTraceId();
      if (traceId) {
        console.info(
          JSON.stringify({
            kind: "world-bridge",
            op: "getGhostCell",
            traceId,
            ghostId: gid,
          }),
        );
      }
      const fromRoom = colyseusBridge.getGhostCell(gid);
      if (fromRoom !== undefined && fromRoom !== "") {
        ghostAuthority.set(gid, fromRoom);
        return fromRoom;
      }
      const cached = ghostAuthority.get(gid);
      if (cached !== undefined && cached !== "") {
        colyseusBridge.setGhostCell(gid, cached);
        return cached;
      }
      return undefined;
    },
    setGhostCell(ghostId: string, cellId: string): void {
      const gid = String(ghostId).trim();
      const cid = String(cellId).trim();
      const traceId = getRequestTraceId() ?? null;
      console.info(
        JSON.stringify({
          kind: "world-bridge",
          op: "setGhostCell",
          phase: "before-colyseus",
          traceId,
          ghostId: gid,
          cellId: cid,
        }),
      );
      colyseusBridge.setGhostCell(gid, cid);
      console.info(
        JSON.stringify({
          kind: "world-bridge",
          op: "setGhostCell",
          phase: "after-colyseus",
          traceId,
          ghostId: gid,
          cellId: cid,
        }),
      );
      ghostAuthority.set(gid, cid);
      const ghost = store.ghosts.get(gid);
      if (ghost) {
        ghost.h3Index = cid;
      }
    },
    listOccupantsOnCell: (cellId: string) => colyseusBridge.listOccupantsOnCell(cellId),
    setGhostMode: (ghostId: string, mode: "normal" | "conversational") =>
      colyseusBridge.setGhostMode(ghostId, mode),
    getGhostMode: (ghostId: string) => colyseusBridge.getGhostMode(ghostId),
    setTileItems: (h3Index: string, itemRefs: string[]) =>
      colyseusBridge.setTileItems(h3Index, itemRefs),
    setGhostInventory: (ghostId: string, itemRefs: string[]) =>
      colyseusBridge.setGhostInventory(ghostId, itemRefs),
    setGhostLastAction: (ghostId: string, label: string) =>
      colyseusBridge.setGhostLastAction(ghostId, label),
    fanoutWorldV1: (payload: unknown) => colyseusBridge.fanoutWorldV1(payload),
  };

  let neoDriver = createNeo4jDriverFromEnv() ?? null;
  if (neoDriver) {
    try {
      await ensureCellH3UniqueConstraint(neoDriver);
      await seedNeo4jGraphArtifacts(neoDriver, colyseusBridge.getLoadedMap());
      console.info("[aie-matrix] Neo4j: constraint + graph seeds applied");
    } catch (e) {
      console.error("[aie-matrix] Neo4j setup failed:", e);
      await neoDriver.close();
      neoDriver = null;
      process.exit(1);
    }
  }
  const neo4jGraphLayer: Layer.Layer<Neo4jGraphService> = neoDriver
    ? makeLiveNeo4jGraphLayer(neoDriver)
    : makeNoOpNeo4jGraphLayer;

  let movementRules;
  try {
    movementRules = await Effect.runPromise(loadMovementRulesFromEnv(process.env, repoRoot));
  } catch (e) {
    console.error("[aie-matrix] Failed to load movement rules (Gram / env):", e);
    process.exit(1);
  }

  const conversationStore = new JsonlStore(conversationDataDir);
  const conversationLayer = makeConversationLayer(bridge, conversationStore);
  const handleConversationThreads = createConversationRouter({
    store: conversationStore,
    registry: store,
    corsHeaders,
    spectatorToken: process.env.SPECTATOR_DEBUG_TOKEN,
  });

  const loadedMap = colyseusBridge.getLoadedMap();
  const itemServiceImpl = new ItemServiceImpl(loadedMap);
  itemServiceImpl.setBridge(bridge);
  broadcastInitialItemState(itemServiceImpl, bridge);

  type MatrixRuntimeServices =
    | WorldBridgeService
    | RegistryStoreService
    | MovementRulesService
    | ServerConfigService
    | ConversationService
    | Neo4jGraphService
    | ItemService;

  const runtimeLayer = Layer.mergeAll(
    makeWorldBridgeLayer(bridge),
    makeRegistryStoreLayer(store),
    makeMovementRulesLayer(movementRules),
    makeServerConfigLayer(process.env),
    conversationLayer,
    neo4jGraphLayer,
    makeItemServiceLayer(itemServiceImpl),
  ) as Layer.Layer<MatrixRuntimeServices>;

  const runtime = ManagedRuntime.make(runtimeLayer);

  process.on("SIGTERM", () => {
    void Effect.runPromise(
      Effect.promise(() => runtime.dispose()),
    ).finally(() => {
      void (neoDriver?.close() ?? Promise.resolve()).finally(() => process.exit(0));
    });
  });

  const registryListener = createRegistryRequestListener({
    adoption: {
      worldApiBaseUrl,
    },
    runtime,
    mapHttpError: (e: unknown) => errorToResponse(e as HttpMappingError),
  });

  matrixRoomId = listing.roomId;

  httpServer.on("request", (req, res) => {
    void (async () => {
      try {
      // Colyseus installs a wrapping `request` listener, then this handler is added as a second
      // `request` listener. Skip if a prior listener already responded, or if the URL is owned by
      // Colyseus matchmake (it sends headers only after `req` ends — see `/matchmake` guard below).
      if (res.headersSent || res.writableEnded) {
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${httpPort}`);

      // Colyseus answers `/matchmake/*` asynchronously (headers only on `req` "end"). This listener
      // runs in the same turn before that, so never send 404/OPTIONS/etc. for those URLs here.
      if (url.pathname.startsWith("/matchmake")) {
        return;
      }

      if (req.method === "OPTIONS") {
        const p = url.pathname;
        if (
          p === "/spectator/room" ||
          p.startsWith("/maps/") ||
          p.startsWith("/registry") ||
          p.startsWith("/threads") ||
          p === "/mcp" ||
          p === "/internal/world-fanout"
        ) {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/spectator/room") {
        if (!matrixRoomId) {
          res.writeHead(503, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ error: "STARTING", message: "Room not ready" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          ...corsHeaders,
        });
        res.end(JSON.stringify({ roomId: matrixRoomId, roomName: "matrix" }));
        return;
      }
      if (req.method === "GET" && serveMapsIfMatched(url.pathname, res)) {
        return;
      }
      if (url.pathname.startsWith("/threads")) {
        const handled = await handleConversationThreads(req, res, url);
        if (handled) {
          return;
        }
      }
      if (url.pathname.startsWith("/registry")) {
        await registryListener(req, res);
        return;
      }
      if (url.pathname === "/mcp") {
        if (req.method === "GET" || req.method === "DELETE") {
          res.writeHead(405, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32_000, message: "Method not allowed for this PoC MCP endpoint." },
              id: null,
            }),
          );
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { ...corsHeaders });
          res.end("Method Not Allowed");
          return;
        }
        const buf = await readRequestBody(req);
        let parsed: unknown;
        try {
          parsed = buf.length ? JSON.parse(buf.toString("utf8")) : undefined;
        } catch {
          res.writeHead(400, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ error: "BAD_JSON", message: "Body must be JSON" }));
          return;
        }
        const traceId = randomUUID();
        await runWithRequestTrace(traceId, () =>
          runtime.runPromise(
            handleGhostMcpEffect(req, res, parsed).pipe(
              Effect.catchAll((e) =>
                Effect.sync(() => {
                  if (!res.headersSent && !res.writableEnded) {
                    const { status, body } = errorToResponse(e as HttpMappingError);
                    res.writeHead(status, {
                      "Content-Type": "application/json",
                      ...corsHeaders,
                    });
                    res.end(body);
                  }
                }),
              ),
            ),
          ),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/internal/world-fanout") {
        if (internalFanoutToken.length === 0) {
          res.writeHead(503, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              error: "FANOUT_DISABLED",
              message: "Set AIE_MATRIX_INTERNAL_FANOUT_TOKEN to enable world fanout",
            }),
          );
          return;
        }
        if (req.headers.authorization !== `Bearer ${internalFanoutToken}`) {
          res.writeHead(401, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
          return;
        }
        const buf = await readRequestBody(req);
        let fanout: unknown;
        try {
          fanout = buf.length ? JSON.parse(buf.toString("utf8")) : {};
        } catch {
          res.writeHead(400, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ error: "BAD_JSON" }));
          return;
        }
        room.broadcast("world-v1", fanout);
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(404, { "Content-Type": "text/plain", ...corsHeaders });
        res.end("Not found");
      }
      } catch (e) {
        console.error("Unhandled request error", e);
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "INTERNAL", message: e instanceof Error ? e.message : String(e) }));
        }
      }
    })();
  });

  console.log(`aie-matrix PoC listening on http://127.0.0.1:${httpPort}`);
  console.log(`  Registry: POST /registry/caretakers | /registry/houses | /registry/adopt`);
  console.log(`  MCP world-api (Streamable HTTP): POST ${worldApiBaseUrl}`);
  console.log(`  Colyseus WebSocket: ws://127.0.0.1:${httpPort} (matchmake routes on same port)`);
  console.log(`  Spectator room id: GET http://127.0.0.1:${httpPort}/spectator/room`);
  if (internalFanoutToken.length > 0) {
    console.log(
      `  World fanout (dev): POST http://127.0.0.1:${httpPort}/internal/world-fanout (Bearer AIE_MATRIX_INTERNAL_FANOUT_TOKEN)`,
    );
  }
  console.log(`  Conversation threads: GET http://127.0.0.1:${httpPort}/threads/:ghostId`);
  console.log(`  Map assets (dev): GET http://127.0.0.1:${httpPort}/maps/...`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
