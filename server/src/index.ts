import { randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatrixRoom } from "@aie-matrix/server-colyseus";
import { createRegistryRequestListener, createRegistryStore } from "@aie-matrix/server-registry";
import {
  createColyseusBridge,
  getRequestTraceId,
  handleGhostMcpEffect,
  makeRegistryStoreLayer,
  makeWorldBridgeLayer,
  runWithRequestTrace,
} from "@aie-matrix/server-world-api";
import { Effect, Exit, Layer, ManagedRuntime, pipe, Scope } from "effect";
import { isEnvTruthy, loadRootEnv } from "@aie-matrix/root-env";
import { patchMatchmakeCorsForCredentials } from "./colyseus-cors-patch.js";
import { errorToResponse, type HttpMappingError } from "./errors.js";
import { makeServerConfigLayer } from "./services/ServerConfigService.js";
import {
  publishTranscript,
  subscribeGhostToHub,
  TranscriptHubLayer,
} from "./services/TranscriptHubService.js";

loadRootEnv();
if (isEnvTruthy(process.env.AIE_MATRIX_DEBUG)) {
  console.info(
    "[aie-matrix] AIE_MATRIX_DEBUG is on; MatrixRoom logs each setGhostCell when ghosts move",
  );
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const httpPort = Number(process.env.AIE_MATRIX_HTTP_PORT ?? "8787");
const mapPath = process.env.AIE_MATRIX_MAP ?? join(repoRoot, "maps/sandbox/freeplay.tmj");
const mapsRoot = normalize(join(repoRoot, "maps"));

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
  let matrixRoomId: string | undefined;
  const worldApiBaseUrl = `http://127.0.0.1:${httpPort}/mcp`;

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define("matrix", MatrixRoom);
  await gameServer.listen(httpPort);
  const listing = await matchMaker.createRoom("matrix", { mapPath });
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
        ghost.tileId = cid;
      }
    },
    listOccupantsOnCell: (cellId: string) => colyseusBridge.listOccupantsOnCell(cellId),
  };

  const ghostSubscriberScope = await Effect.runPromise(Scope.make());

  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeWorldBridgeLayer(bridge),
      makeRegistryStoreLayer(store),
      makeServerConfigLayer(process.env),
      TranscriptHubLayer,
    ),
  );

  process.on("SIGTERM", () => {
    void Effect.runPromise(
      Effect.gen(function* () {
        yield* Scope.close(ghostSubscriberScope, Exit.void);
        yield* Effect.promise(() => runtime.dispose());
      }),
    ).finally(() => process.exit(0));
  });

  const registryListener = createRegistryRequestListener({
    adoption: {
      worldApiBaseUrl,
      forkTranscriptSubscriber: (ghostId: string) => {
        runtime.runFork(
          pipe(
            Effect.forkScoped(
              subscribeGhostToHub(ghostId).pipe(
                Effect.tapDefect((cause) =>
                  Effect.sync(() =>
                    console.error(
                      JSON.stringify({ kind: "transcript-hub", op: "defect", ghostId, cause: String(cause) }),
                    ),
                  ),
                ),
              ),
            ),
            Effect.provideService(Scope.Scope, ghostSubscriberScope),
          ),
        );
      },
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
          p === "/mcp" ||
          p === "/transcripts"
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
      if (url.pathname.startsWith("/registry")) {
        await registryListener(req, res);
        return;
      }
      if (url.pathname === "/transcripts") {
        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "POST only" }));
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
        const body = parsed as { source?: unknown; text?: unknown };
        const source = typeof body.source === "string" ? body.source.trim() : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!source || !text || text.length > 2048) {
          res.writeHead(400, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              error: "VALIDATION",
              message: "source and text are required; text max 2048 characters (IC-002)",
            }),
          );
          return;
        }
        const published = await runtime.runPromise(
          publishTranscript({ source, text, timestamp: Date.now() }),
        );
        res.writeHead(published ? 200 : 207, {
          "Content-Type": "application/json",
          ...corsHeaders,
        });
        res.end(
          JSON.stringify(
            published
              ? { ok: true }
              : { ok: false, note: "hub dropped the message (capacity); partial delivery" },
          ),
        );
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
  console.log(`  Map assets (dev): GET http://127.0.0.1:${httpPort}/maps/...`);
  console.log(`  Transcripts (stub): POST http://127.0.0.1:${httpPort}/transcripts`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
