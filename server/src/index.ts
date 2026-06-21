import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
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
  ensureTileH3UniqueConstraint,
  ensureMapManagementConstraints,
  GcsService,
  getRequestTraceId,
  handleGhostMcpEffect,
  setSpawnGrants,
  loadMovementRulesFromEnv,
  rulesetFromParsedMap,
  LedgerService,
  LedgerServiceInMemoryLayer,
  ProposalService,
  ProposalServiceWithGroupLayer,
  GroupService,
  GroupServiceInMemoryLayer,
  EvalContractService,
  EvalContractServiceInMemoryLayer,
  LeaderboardService,
  LeaderboardServiceInMemoryLayer,
  makeLeaderboardServiceLiveLayer,
  parseLeaderboardGramText,
  makeLiveNeo4jGraphLayer,
  makeLiveSessionLayer,
  makeLocalLiveSessionLayer,
  makeGcsLayerFromEnv,
  makeMapManagementLayer,
  makeLocalMapManagementLayer,
  makeMapServiceLayer,
  makeMovementRulesLayer,
  makeNoOpNeo4jGraphLayer,
  makeItemServiceLayer,
  makeRedisPublishLayerFromEnv,
  makeRedisGhostStoreLayerFromEnv,
  RedisGhostStoreService,
  makeRegistryStoreLayer,
  makeWorldBridgeLayer,
  MapManagementService,
  MapService,
  Neo4jGraphService,
  ItemService,
  ItemServiceImpl,
  LiveSessionService,
  RedisPublishService,
  runWithRequestTrace,
  seedNeo4jGraphArtifacts,
  tryHandleMapGet,
  tryHandleMapManagement,
  tryHandleLiveSession,
  type MovementRulesService,
  type RegistryStoreService,
  type WorldBridgeService,
} from "@aie-matrix/server-world-api";
import { parseMapGram } from "@aie-matrix/map-gram";
import { Effect, Layer, ManagedRuntime } from "effect";
import { isEnvTruthy, loadRootEnv } from "@aie-matrix/root-env";
import { createLogger } from "@aie-matrix/logger";
import {
  ConversationService,
  JsonlStore,
  createConversationRouter,
  makeConversationLayer,
} from "@aie-matrix/server-conversation";
import { mintGhostToken } from "@aie-matrix/server-auth";
import { patchMatchmakeCorsForCredentials } from "./colyseus-cors-patch.js";
import { errorToResponse, type HttpMappingError } from "./errors.js";
import { makeServerConfigLayer, type ServerConfigService } from "./services/ServerConfigService.js";
import {
  parseCalendarGramFile,
  makeWorldCalendarLayer,
  WorldCalendarService,
} from "@aie-matrix/server-world-api";

loadRootEnv();
const log = createLogger("aie-matrix");
if (isEnvTruthy(process.env.AIE_MATRIX_DEBUG)) {
  log.info({ kind: "debug-mode", message: "AIE_MATRIX_DEBUG is on; MatrixRoom logs each setGhostCell when ghosts move" });
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const httpPort = Number(process.env.AIE_MATRIX_HTTP_PORT ?? "8787");

/**
 * AIE_MATRIX_MODE controls which service backend implementations are wired:
 *   development — local file-backed; no Neo4j or GCS required (default)
 *   staging     — Docker Compose; Neo4j + local-filesystem GCS stub
 *   production  — Kubernetes/GCP; Neo4j Aura + GCS bucket
 *
 * See ADR-0007 for the full deployment model.
 */
const matrixMode = (process.env.AIE_MATRIX_MODE ?? "development") as
  | "development"
  | "staging"
  | "production";

log.info({ kind: "mode", mode: matrixMode });
const startupT = performance.now();

const mapPathRaw = process.env.AIE_MATRIX_MAP;
const _mapPathFallback = join(repoRoot, "maps/moscone/moscone-aiewf-mini.map.gram");
const mapPath: string | undefined = mapPathRaw
  ? (isAbsolute(mapPathRaw) ? mapPathRaw : join(repoRoot, mapPathRaw))
  : (existsSync(_mapPathFallback) ? _mapPathFallback : undefined);
const mapsRoot = normalize(join(repoRoot, "maps"));
const conversationDataDir =
  process.env.CONVERSATION_DATA_DIR ?? join(process.cwd(), "data/conversations");

/** PoC-wide CORS for browser clients (Phaser on Vite, etc.). */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS, DELETE",
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
  if (mapPath) {
    await readFile(mapPath); // pre-flight: fail fast if the configured map file is unreadable
  }

  patchMatchmakeCorsForCredentials();

  const httpServer = createServer();
  const store = createRegistryStore();
  const internalFanoutToken = process.env.AIE_MATRIX_INTERNAL_FANOUT_TOKEN?.trim() ?? "";
  /** Set after `matchMaker.createRoom` — stable id for the matrix room. */
  let roomIdForSpectators: string | undefined;
  /** Flipped true only after Neo4j / movement rules / Effect runtime wiring (registry + MCP). */
  let spectatorMetaReady = false;
  /** IC-001: flipped true after initial Neo4j connectivity is confirmed (or when Neo4j is not configured). */
  let neo4jHealthy = false;
  // AIE_MATRIX_WORLD_API_MCP_URL lets other pods (agent-host, random-agent) reach the MCP
  // endpoint via in-cluster DNS. Defaults to loopback for local dev.
  // In K8s set to "http://server:8787/mcp" so ghost credentials are reachable cross-pod.
  const worldApiBaseUrl =
    (process.env.AIE_MATRIX_WORLD_API_MCP_URL ?? "").trim() ||
    `http://127.0.0.1:${httpPort}/mcp`;

  // `scripts/demo.mjs` polls this as soon as the TCP port is open. Colyseus registers its HTTP
  // layer during `listen()`; our main `httpServer.on` handler is attached much later after slow
  // init. Answer `/spectator/room` and `/health` here first so clients get 503 (starting) then 200 (ready).
  httpServer.prependListener("request", (req, res) => {
    if (res.headersSent || res.writableEnded) {
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${httpPort}`);
    if (req.method !== "GET") {
      return;
    }
    if (url.pathname === "/ping") {
      // Liveness probe — process is alive if it can respond here; no dependency on seeding
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ status: "alive" }));
      return;
    }
    if (url.pathname === "/health") {
      // IC-001: { status, checks } — HTTP 200 = healthy, 503 = starting/degraded
      if (!spectatorMetaReady) {
        res.writeHead(503, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ status: "starting", checks: { neo4j: false } }));
      } else {
        const status = neo4jHealthy ? "ok" : "degraded";
        res.writeHead(neo4jHealthy ? 200 : 503, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ status, checks: { neo4j: neo4jHealthy } }));
      }
      return;
    }
    if (url.pathname !== "/spectator/room") {
      return;
    }
    if (!spectatorMetaReady || !roomIdForSpectators) {
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
    res.end(JSON.stringify({ roomId: roomIdForSpectators, roomName: "matrix" }));
  });

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
  roomIdForSpectators = listing.roomId;
  const colyseusBridge = createColyseusBridge(room);
  const ghostAuthority = new Map<string, string>();
  const bridge = {
    getLoadedMap: () => colyseusBridge.getLoadedMap(),
    setLoadedMap(map: import("@aie-matrix/server-colyseus").LoadedMap): void {
      ghostAuthority.clear();
      colyseusBridge.setLoadedMap(map);
    },
    getGhostCell(ghostId: string): string | undefined {
      const gid = String(ghostId).trim();
      const traceId = getRequestTraceId();
      if (traceId) {
        log.info({ kind: "world-bridge", op: "getGhostCell", traceId, ghostId: gid });
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
      log.info({ kind: "world-bridge", op: "setGhostCell", phase: "before-colyseus", traceId, ghostId: gid, cellId: cid });
      colyseusBridge.setGhostCell(gid, cid);
      log.info({ kind: "world-bridge", op: "setGhostCell", phase: "after-colyseus", traceId, ghostId: gid, cellId: cid });
      ghostAuthority.set(gid, cid);
      const ghost = store.ghosts.get(gid);
      if (ghost) {
        ghost.h3Index = cid;
      }
    },
    removeGhostCell(ghostId: string): void {
      const gid = String(ghostId).trim();
      const traceId = getRequestTraceId() ?? null;
      log.info({ kind: "world-bridge", op: "removeGhostCell", phase: "before-colyseus", traceId, ghostId: gid });
      colyseusBridge.removeGhostCell(gid);
      log.info({ kind: "world-bridge", op: "removeGhostCell", phase: "after-colyseus", traceId, ghostId: gid });
      ghostAuthority.delete(gid);
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
    setGhostLabels: (ghostId: string, labels: string) =>
      colyseusBridge.setGhostLabels(ghostId, labels),
    setGhostGlyph: (ghostId: string, glyph: string) =>
      colyseusBridge.setGhostGlyph(ghostId, glyph),
    fanoutWorldV1: (payload: unknown) => colyseusBridge.fanoutWorldV1(payload),
  };

  let neoDriver = createNeo4jDriverFromEnv() ?? null;
  if (neoDriver) {
    try {
      let t = performance.now();
      await ensureTileH3UniqueConstraint(neoDriver);
      log.info({ kind: "neo4j-init", step: "tile-h3-constraint", elapsedMs: Math.round(performance.now() - t) });

      t = performance.now();
      await ensureMapManagementConstraints(neoDriver);
      log.info({ kind: "neo4j-init", step: "map-management-constraints", elapsedMs: Math.round(performance.now() - t) });

      t = performance.now();
      await seedNeo4jGraphArtifacts(neoDriver, colyseusBridge.getLoadedMap());
      log.info({ kind: "neo4j-init", step: "graph-artifacts", elapsedMs: Math.round(performance.now() - t) });

      log.info({ kind: "neo4j-seeds", message: "constraint + graph seeds applied" });
      neo4jHealthy = true; // IC-001: Neo4j connectivity confirmed
    } catch (e) {
      console.error("[aie-matrix] Neo4j setup failed:", e);
      await neoDriver.close();
      neoDriver = null;
      process.exit(1);
    }
  } else {
    neo4jHealthy = true; // Not configured — treat as healthy (dev/local mode without Neo4j)
  }
  const neo4jGraphLayer: Layer.Layer<Neo4jGraphService> = neoDriver
    ? makeLiveNeo4jGraphLayer(neoDriver)
    : makeNoOpNeo4jGraphLayer;

  const gcsLayer = makeGcsLayerFromEnv(process.env);
  const redisLayer = await makeRedisPublishLayerFromEnv(process.env);
  const redisGhostStoreLayer = await makeRedisGhostStoreLayerFromEnv(process.env);

  let movementRules;
  let parsedMapForLedger: Awaited<ReturnType<typeof parseMapGram>> | undefined;
  let mapGramText: string | undefined;
  try {
    movementRules = await Effect.runPromise(loadMovementRulesFromEnv(process.env, repoRoot));
    // Merge rule costs from the map file when one is loaded (costs are declared in the map's
    // [rules:Rules] block and are not carried by standalone .gram rules files).
    if (mapPath) {
      try {
        const mapText = await readFile(mapPath, "utf8");
        mapGramText = mapText;
        const parsedMap = await parseMapGram(mapText);
        parsedMapForLedger = parsedMap;
        const withCosts = rulesetFromParsedMap(parsedMap);
        if (withCosts.ruleCosts.size > 0) {
          movementRules = { ...movementRules, ruleCosts: withCosts.ruleCosts };
          log.info({ kind: "rule-costs", count: withCosts.ruleCosts.size });
        }
      } catch (e) {
        console.warn("[aie-matrix] Could not extract rule costs from map file:", e);
      }
    }
  } catch (e) {
    console.error("[aie-matrix] Failed to load movement rules (Gram / env):", e);
    process.exit(1);
  }

  const calendarPath = process.env.AIE_MATRIX_CALENDAR?.trim();
  let calendarLayer: ReturnType<typeof makeWorldCalendarLayer>;
  if (calendarPath) {
    const absoluteCalendarPath = isAbsolute(calendarPath)
      ? calendarPath
      : join(repoRoot, calendarPath);
    let calendarEvents;
    try {
      calendarEvents = await Effect.runPromise(parseCalendarGramFile(absoluteCalendarPath));
      log.info({ kind: "calendar-loaded", count: calendarEvents.length, path: absoluteCalendarPath });
    } catch (e) {
      console.error(`[aie-matrix] Failed to load calendar from ${absoluteCalendarPath}:`, e);
      process.exit(1);
    }
    calendarLayer = makeWorldCalendarLayer(calendarEvents);
  } else {
    calendarLayer = makeWorldCalendarLayer([]);
    log.info({ kind: "timeless-mode", message: "No AIE_MATRIX_CALENDAR set — running in timeless mode." });
  }

  const conversationStore = new JsonlStore(conversationDataDir);
  const conversationLayer = makeConversationLayer(bridge, conversationStore);
  const handleConversationThreads = createConversationRouter({
    store: conversationStore,
    registry: store,
    corsHeaders,
    spectatorToken: process.env.SPECTATOR_DEBUG_TOKEN,
    fanout: (ghostId, payload) =>
      bridge.fanoutWorldV1({ t: "message.new", targetGhostId: ghostId, payload }),
  });

  const loadedMap = colyseusBridge.getLoadedMap();
  const itemServiceImpl = new ItemServiceImpl(loadedMap);
  itemServiceImpl.setBridge(bridge);
  broadcastInitialItemState(itemServiceImpl, bridge);

  // Map management + live session layers — implementation selected by AIE_MATRIX_MODE.
  //
  //   development: local file-backed (no Neo4j/GCS); discovers all .map.gram files
  //                under maps/ via MapService. AIE_MATRIX_MAP selects the active Colyseus map.
  //   staging / production: Neo4j-backed; requires neoDriver
  //
  // See ADR-0007 for the full deployment model.
  let mapMgmtLayer: Layer.Layer<MapManagementService>;
  let liveSessionLayer: Layer.Layer<LiveSessionService>;
  // Shared MapService layer — used by LocalMapManagementService (dev) and map routes (all modes).
  const mapSvcLayer = makeMapServiceLayer(repoRoot, mapPath);

  if (matrixMode === "development") {
    mapMgmtLayer = makeLocalMapManagementLayer().pipe(Layer.provide(mapSvcLayer), Layer.orDie);
    liveSessionLayer = makeLocalLiveSessionLayer().pipe(
      Layer.provide(Layer.mergeAll(mapMgmtLayer, mapSvcLayer)),
      Layer.orDie,
    );
    log.info({ kind: "dev-maps", mapsRoot: `${repoRoot}/maps/` });
  } else {
    // staging / production — require Neo4j
    if (!neoDriver) {
      console.error(
        `[aie-matrix] AIE_MATRIX_MODE=${matrixMode} requires NEO4J_URI to be set. Exiting.`,
      );
      process.exit(1);
    }
    mapMgmtLayer = makeMapManagementLayer(neoDriver).pipe(Layer.provide(gcsLayer));
    liveSessionLayer = makeLiveSessionLayer(neoDriver).pipe(Layer.provide(redisLayer));
  }

  type MatrixRuntimeServices =
    | WorldBridgeService
    | RegistryStoreService
    | MovementRulesService
    | ServerConfigService
    | ConversationService
    | Neo4jGraphService
    | ItemService
    | MapService
    | GcsService
    | RedisPublishService
    | RedisGhostStoreService
    | MapManagementService
    | LiveSessionService
    | WorldCalendarService
    | LedgerService
    | ProposalService
    | GroupService
    | EvalContractService
  | LeaderboardService;

  // Layers with inter-dependencies must have those deps explicitly provided before
  // entering mergeAll — mergeAll does not resolve cross-dependencies between peers.
  const inMemoryBaseLayers = Layer.merge(LedgerServiceInMemoryLayer, GroupServiceInMemoryLayer);
  const proposalLayer = Layer.provide(ProposalServiceWithGroupLayer, inMemoryBaseLayers);
  const evalContractLayer = Layer.provide(EvalContractServiceInMemoryLayer, inMemoryBaseLayers);
  const leaderboardLayer = neoDriver
    ? Layer.provide(makeLeaderboardServiceLiveLayer(neoDriver), makeWorldBridgeLayer(bridge))
    : LeaderboardServiceInMemoryLayer;

  const calendarLayerWithLeaderboard = Layer.provide(calendarLayer, leaderboardLayer);

  const runtimeLayer = Layer.mergeAll(
    makeWorldBridgeLayer(bridge),
    makeRegistryStoreLayer(store),
    makeMovementRulesLayer(movementRules),
    makeServerConfigLayer(process.env),
    conversationLayer,
    neo4jGraphLayer,
    makeItemServiceLayer(itemServiceImpl),
    mapSvcLayer,
    gcsLayer,
    redisLayer,
    redisGhostStoreLayer,
    mapMgmtLayer,
    liveSessionLayer,
    calendarLayerWithLeaderboard,
    LedgerServiceInMemoryLayer,
    GroupServiceInMemoryLayer,
    proposalLayer,
    evalContractLayer,
    leaderboardLayer,
  ) as Layer.Layer<MatrixRuntimeServices>;

  const runtime = ManagedRuntime.make(runtimeLayer);

  // Wire ledger into ItemService for take/drop accounting
  {
    const ledgerOps = await runtime.runPromise(LedgerService);
    itemServiceImpl.setLedger(ledgerOps);
  }

  // Seed ledger with items from the map placements
  if (parsedMapForLedger && parsedMapForLedger.itemPlacements.length > 0) {
    // Group by (itemRef, h3Index) summing qty → ItemSeed[]
    const seedMap = new Map<string, { itemRef: string; qty: number; h3Index?: string }>();
    for (const p of parsedMapForLedger.itemPlacements) {
      const key = `${p.itemRef}::${p.h3Index ?? ""}`;
      const existing = seedMap.get(key);
      if (existing) {
        existing.qty += p.qty;
      } else {
        seedMap.set(key, { itemRef: p.itemRef, qty: p.qty, ...(p.h3Index ? { h3Index: p.h3Index } : {}) });
      }
    }
    const itemSeeds = Array.from(seedMap.values());
    const initEffect = LedgerService.pipe(
      Effect.flatMap(svc => svc.init(itemSeeds)),
      Effect.provide(runtimeLayer as any),
    ) as unknown as Effect.Effect<void, unknown, never>;
    await Effect.runPromise(initEffect)
      .catch((e: unknown) => console.warn("[aie-matrix] Ledger init warning:", e));
  }

  // Load spawn grants from the parsed map so first-connect seeding works
  if (parsedMapForLedger && parsedMapForLedger.spawnGrants.length > 0) {
    setSpawnGrants(parsedMapForLedger.spawnGrants);
    log.info({ kind: "spawn-grants-loaded", count: parsedMapForLedger.spawnGrants.length });
  }

  // Load leaderboard specs from the map gram
  if (mapGramText) {
    try {
      const leaderboardSpecs = await parseLeaderboardGramText(mapGramText);
      if (leaderboardSpecs.length > 0) {
        await runtime.runPromise(
          LeaderboardService.pipe(Effect.flatMap(svc => svc.init(leaderboardSpecs))),
        ).catch((e: unknown) => console.warn("[aie-matrix] Leaderboard init warning:", e));
        log.info({ kind: "leaderboards", count: leaderboardSpecs.length });
      }
    } catch (e) {
      console.warn("[aie-matrix] Could not load leaderboard specs from map:", e);
    }
  }

  // GitOps startup map sync (staging/production only).
  // Auto-publishes every .map.gram baked into the Docker image to GCS+Neo4j if not already present.
  // - New map (no Neo4j record) → publish
  // - Published map, same content hash → skip (no-op)
  // - Published map, content changed → re-publish (update graph + GCS)
  // - Archived map → skip (admin decision respected across deploys)
  // Individual publish failures are logged but do not abort startup.
  if (matrixMode !== "development") {
    const mapSyncT = performance.now();
    log.info({ kind: "map-sync-start", message: "scanning maps/ for unpublished maps" });
    const syncSummary = await runtime.runPromise(
      Effect.gen(function* () {
        const mapSvc = yield* MapService;
        const mapMgmt = yield* MapManagementService;
        const entries = yield* mapSvc.listEntries();
        let synced = 0;
        let skipped = 0;
        let failed = 0;

        for (const entry of entries) {
          const entryT = performance.now();
          const existing = yield* mapMgmt.get(entry.mapId).pipe(
            Effect.catchTag("MapError.NotFound", () => Effect.succeed(null)),
          );

          if (existing?.status === "archived") {
            log.info({ kind: "map-sync-entry", mapId: entry.mapId, action: "skip-archived", elapsedMs: Math.round(performance.now() - entryT) });
            skipped++;
            continue;
          }

          // Read file bytes
          const bytes = yield* mapSvc.raw(entry.mapId).pipe(
            Effect.catchAll((e) => {
              console.error(JSON.stringify({ kind: "startup-map-sync", mapId: entry.mapId, action: "read-error", error: String(e) }));
              return Effect.succeed(null as Buffer | null);
            }),
          );
          if (bytes === null) { failed++; continue; }

          // Skip if published with same content hash (idempotent guard)
          const hash = createHash("sha256").update(bytes).digest("hex");
          if (existing?.status === "published" && existing.contentHash === hash) {
            log.info({ kind: "map-sync-entry", mapId: entry.mapId, action: "skip-current", elapsedMs: Math.round(performance.now() - entryT) });
            skipped++;
            continue;
          }

          // Publish (new map) or re-publish (content changed)
          const action = existing ? "republish" : "publish";
          yield* mapMgmt.publish(entry.mapId, bytes).pipe(
            Effect.tap(() => Effect.sync(() => {
              log.info({ kind: "map-sync-entry", mapId: entry.mapId, action, elapsedMs: Math.round(performance.now() - entryT) });
              synced++;
            })),
            Effect.catchAll((e) => Effect.sync(() => {
              console.error(JSON.stringify({ kind: "startup-map-sync", mapId: entry.mapId, action: "publish-error", elapsedMs: Math.round(performance.now() - entryT), error: String(e) }));
              failed++;
            })),
          );
        }

        return { total: entries.length, synced, skipped, failed };
      }),
    ).catch((e: unknown) => {
      console.error("[aie-matrix] startup-map-sync failed:", e);
      return { total: 0, synced: 0, skipped: 0, failed: 0 };
    });
    log.info({ kind: "map-sync-summary", ...syncSummary, elapsedMs: Math.round(performance.now() - mapSyncT) });
  }

  // T025 — Session binding for staging/production (skip in development mode where
  // makeLocalLiveSessionLayer synthesises a session for AIE_MATRIX_MAP at startup).
  const liveSessionId = process.env.LIVE_SESSION_ID?.trim();
  if (matrixMode !== "development" && neoDriver) {
    let sessionToBind: string | undefined;
    if (liveSessionId) {
      sessionToBind = liveSessionId;
    } else {
      const sessions = await runtime.runPromise(
        Effect.flatMap(LiveSessionService, (svc) => svc.list("active")),
      );
      if (sessions.length === 1) {
        sessionToBind = sessions[0]!.id;
      } else if (sessions.length > 1) {
        console.error("[aie-matrix] Multiple active sessions found. Set LIVE_SESSION_ID.");
        process.exit(1);
      }
      // sessions.length === 0 is ok — no session yet, server starts without binding
    }
    if (sessionToBind) {
      log.info({ kind: "session-binding", op: "bind", sessionId: sessionToBind });
    }
  }

  // ── Calendar scheduler fiber ────────────────────────────────────────────────
  // Polls for due CalendarEvents and dispatches enterCommands / exitCommands.
  // Uses CALENDAR_TICK_MS (default 30s); set lower (e.g. 5000) for local testing.
  const calendarTickMs = Math.max(1000, parseInt(process.env.CALENDAR_TICK_MS ?? "30000", 10) || 30000);
  const runCalendarTick = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const calendar = yield* WorldCalendarService;
        yield* calendar.tick();
      }),
    ).catch((e) => console.error("[aie-matrix] calendar scheduler tick error:", e));

  void (async () => {
    // Tick immediately on startup so past-due events fire without waiting a full interval
    await runCalendarTick();
    while (true) {
      await new Promise<void>((resolve) => setTimeout(resolve, calendarTickMs));
      await runCalendarTick();
    }
  })();
  if (calendarPath) {
    log.info({ kind: "calendar-started", tickMs: calendarTickMs });
  }

  process.on("SIGTERM", () => {
    void Effect.runPromise(
      Effect.promise(() => runtime.dispose()),
    ).finally(() => {
      void (neoDriver?.close() ?? Promise.resolve()).finally(() => process.exit(0));
    });
  });

  const registryListener = createRegistryRequestListener({
    adoption: { worldApiBaseUrl },
    spawn: { worldApiBaseUrl },
    runtime,
    mapHttpError: (e: unknown) => errorToResponse(e as HttpMappingError),
  });

  log.info({ kind: "startup-complete", elapsedMs: Math.round(performance.now() - startupT) });
  spectatorMetaReady = true;

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
          p === "/maps" ||
          p === "/maps/" ||
          p.startsWith("/maps/") ||
          p === "/live" ||
          p === "/live/" ||
          p.startsWith("/live/") ||
          p.startsWith("/registry") ||
          p.startsWith("/threads") ||
          p.startsWith("/ghosts") ||
          p.startsWith("/humans") ||
          p === "/mcp" ||
          p === "/auth/guest" ||
          p === "/internal/world-fanout" ||
          p.startsWith("/agent-host/")
        ) {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }
      }

      // Agent-host reverse proxy.
      // Write ops (anything other than the two public read paths below) require ADMIN_TOKEN.
      // GET /agent-host/v1/sessions and GET /agent-host/v1/catalog are intentionally public so
      // the Intermedium spectator client can resolve ghost display names without admin credentials.
      if (url.pathname.startsWith("/agent-host/")) {
        const PUBLIC_AGENT_HOST_READS = ["/agent-host/v1/sessions", "/agent-host/v1/catalog"];
        const isPublicRead =
          req.method === "GET" &&
          PUBLIC_AGENT_HOST_READS.some((p) => url.pathname === p);
        if (!isPublicRead) {
          const adminToken = process.env.ADMIN_TOKEN?.trim();
          if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) {
            res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
            return;
          }
        }
        const agentHostBase = process.env.AGENT_HOST_URL?.trim();
        const agentHostToken = process.env.AGENT_HOST_TOKEN?.trim();
        if (!agentHostBase || !agentHostToken) {
          res.writeHead(503, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "AGENT_HOST_NOT_CONFIGURED", message: "Set AGENT_HOST_URL and AGENT_HOST_TOKEN on the server" }));
          return;
        }
        const downstreamPath = url.pathname.slice("/agent-host".length) + (url.search ?? "");
        const bodyBuf = (req.method !== "GET" && req.method !== "DELETE") ? await readRequestBody(req) : Buffer.alloc(0);
        let upstream: Response;
        try {
          upstream = await fetch(`${agentHostBase}${downstreamPath}`, {
            method: req.method,
            headers: {
              "Content-Type": (req.headers["content-type"] as string | undefined) ?? "application/json",
              Authorization: `Bearer ${agentHostToken}`,
              Accept: (req.headers.accept as string | undefined) ?? "application/json",
            },
            ...(bodyBuf.length > 0 ? { body: bodyBuf } : {}),
          });
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "AGENT_HOST_UNREACHABLE", message: e instanceof Error ? e.message : String(e) }));
          return;
        }
        const upstreamBody = Buffer.from(await upstream.arrayBuffer());
        const ct = upstream.headers.get("content-type") ?? "application/json";
        res.writeHead(upstream.status, { "Content-Type": ct, ...corsHeaders });
        res.end(upstreamBody);
        return;
      }

      // Map management routes — BEFORE the read-only map GET handler.
      // Handles POST /maps, DELETE /maps/:id, and management GETs (list, metadata, gram download).
      // tryHandleMapManagement returns false for unrecognised paths so multi-segment static paths
      // (e.g. /maps/moscone/moscone-aiewf-mini.map.gram) fall through to serveMapsIfMatched as before.
      if (url.pathname === "/maps" || url.pathname === "/maps/" || url.pathname.startsWith("/maps/")) {
        if (req.method === "POST" || req.method === "DELETE" || req.method === "GET") {
          const traceId = randomUUID();
          const handled = await runWithRequestTrace(traceId, () =>
            runtime.runPromise(
              tryHandleMapManagement(req, res, url, corsHeaders).pipe(
                Effect.catchAll((e) =>
                  Effect.sync(() => {
                    if (!res.headersSent && !res.writableEnded) {
                      const { status, body } = errorToResponse(e as HttpMappingError);
                      res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
                      res.end(body);
                    }
                    return true as const;
                  }),
                ),
              ),
            ),
          );
          if (handled) return;
        }
      }

      // Live session routes
      if (url.pathname === "/live" || url.pathname === "/live/" || url.pathname.startsWith("/live/")) {
        const traceId = randomUUID();
        const handled = await runWithRequestTrace(traceId, () =>
          runtime.runPromise(
            tryHandleLiveSession(req, res, url, corsHeaders).pipe(
              Effect.catchAll((e) =>
                Effect.sync(() => {
                  if (!res.headersSent && !res.writableEnded) {
                    const { status, body } = errorToResponse(e as HttpMappingError);
                    res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
                    res.end(body);
                  }
                  return true as const;
                }),
              ),
            ),
          ),
        );
        if (handled) return;
      }

      if (req.method === "GET") {
        const traceId = randomUUID();
        const mapHandled = await runWithRequestTrace(traceId, () =>
          runtime.runPromise(tryHandleMapGet(req, res, url, corsHeaders)),
        );
        if (mapHandled) {
          return;
        }
      }
      if (req.method === "GET" && serveMapsIfMatched(url.pathname, res)) {
        return;
      }
      if (url.pathname === "/auth/guest" && req.method === "POST") {
        const buf = await readRequestBody(req);
        let ghostId: string;
        try {
          const body = JSON.parse(buf.toString("utf8") || "{}") as { ghostId?: string };
          ghostId = typeof body.ghostId === "string" && body.ghostId.trim().length > 0
            ? body.ghostId.trim()
            : randomUUID();
        } catch {
          ghostId = randomUUID();
        }
        const token = mintGhostToken({ sub: ghostId, ghostId, role: "human" });
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ token, ghostId }));
        return;
      }
      if (url.pathname === "/humans/join" && req.method === "POST") {
        const buf = await readRequestBody(req);
        let humanId: string;
        try {
          const body = JSON.parse(buf.toString("utf8") || "{}") as { humanId?: string };
          humanId = typeof body.humanId === "string" && body.humanId.trim().length > 0
            ? body.humanId.trim()
            : randomUUID();
        } catch {
          humanId = randomUUID();
        }
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ humanId }));
        return;
      }
      if (url.pathname.startsWith("/threads")) {
        const handled = await handleConversationThreads(req, res, url);
        if (handled) {
          return;
        }
      }
      const ghostInventoryMatch = req.method === "GET"
        && url.pathname.match(/^\/ghosts\/([^/]+)\/inventory$/);
      if (ghostInventoryMatch) {
        let ghostId: string;
        try {
          ghostId = decodeURIComponent(ghostInventoryMatch[1]!);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "invalid ghost id encoding" }));
          return;
        }
        const sidecar = itemServiceImpl.getSidecar();
        const items = itemServiceImpl.getGhostInventory(ghostId).map((itemRef) => ({
          itemRef,
          name: sidecar.get(itemRef)?.name ?? itemRef,
        }));
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ ghostId, items }));
        return;
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

  log.info({ kind: "listening", url: `http://127.0.0.1:${httpPort}`, registry: "POST /registry/caretakers | /registry/houses | /registry/adopt", mcpUrl: worldApiBaseUrl, colyseusWs: `ws://127.0.0.1:${httpPort}`, spectatorRoom: `GET http://127.0.0.1:${httpPort}/spectator/room` });
  if (internalFanoutToken.length > 0) {
    log.info({ kind: "listening", feature: "world-fanout", url: `POST http://127.0.0.1:${httpPort}/internal/world-fanout` });
  }
  log.info({ kind: "listening", feature: "conversation-threads", url: `GET http://127.0.0.1:${httpPort}/threads/:ghostId` });
  log.info({ kind: "listening", feature: "map-assets", url: `GET http://127.0.0.1:${httpPort}/maps/...` });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
