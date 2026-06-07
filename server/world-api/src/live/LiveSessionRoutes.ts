import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { checkAdminToken } from "../admin-auth.js";
import type { AdminAuthError } from "../admin-auth.js";
import { LiveSessionService } from "./LiveSessionService.js";
import type {
  LiveSessionAlreadyEndedError,
  LiveSessionMapNotPublishedError,
  LiveSessionNotFoundError,
} from "./live-errors.js";
import { MapManagementService } from "../map/MapManagementService.js";
import { MapService } from "../map/MapService.js";
import type { MapFileReadError, MapNotFoundError } from "../map/map-errors.js";
import type { GcsError } from "../gcs/GcsService.js";
import { loadGramMap } from "@aie-matrix/server-colyseus";
import { WorldBridgeService } from "../WorldBridgeService.js";
import { LedgerService } from "../LedgerService.js";
import type { ItemSeed } from "../LedgerService.js";
import type { ParsedItemPlacement } from "@aie-matrix/map-gram";

/**
 * Derive ItemSeed[] from ParsedItemPlacement[] by grouping on (itemRef, h3Index)
 * and summing qty. Used to call ledger.init() at session start.
 */
function deriveItemSeeds(placements: ParsedItemPlacement[]): ItemSeed[] {
  const map = new Map<string, ItemSeed>();
  for (const p of placements) {
    const key = `${p.itemRef}::${p.h3Index ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += p.qty;
    } else {
      map.set(key, { itemRef: p.itemRef, qty: p.qty, ...(p.h3Index ? { h3Index: p.h3Index } : {}) });
    }
  }
  return Array.from(map.values());
}

const LIVE_SINGLE_SEGMENT = /^\/live\/([^/]+)$/;
const LIVE_MAPS_SEGMENT = /^\/live\/([^/]+)\/maps$/;

function parseLiveId(pathname: string): string | undefined {
  const m = LIVE_SINGLE_SEGMENT.exec(pathname);
  if (m?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

function parseLiveMapsId(pathname: string): string | undefined {
  const m = LIVE_MAPS_SEGMENT.exec(pathname);
  if (m?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>,
): void {
  if (!res.headersSent && !res.writableEnded) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders });
    res.end(JSON.stringify(body));
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as ArrayBufferLike));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : {};
}

/**
 * Handles live session routes:
 * - `GET /live/@current/map`   — gram of the primary map of the current live session
 *                                (Tier 1 fallback: serves MapService.activeMapId() when no session)
 * - `POST /live`               — start a session (admin)
 * - `GET /live`                — list sessions (public)
 * - `GET /live/:id`            — get session (public)
 * - `PATCH /live/:id/maps`     — switch maps (admin)
 * - `DELETE /live/:id`         — end session (admin)
 */
export function tryHandleLiveSession(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
): Effect.Effect<
  boolean,
  | AdminAuthError
  | LiveSessionNotFoundError
  | LiveSessionMapNotPublishedError
  | LiveSessionAlreadyEndedError
  | MapNotFoundError
  | MapFileReadError
  | GcsError,
  LiveSessionService | MapManagementService | MapService | WorldBridgeService | LedgerService
> {
  const { pathname } = url;

  // GET /live/@current/map — gram of the primary map of the current live session.
  // Tier 1 fallback: when no live session exists, serve from MapService.activeMapId()
  // (set via AIE_MATRIX_MAP in local dev; skips Neo4j + GCS entirely).
  if (req.method === "GET" && (pathname === "/live/@current/map" || pathname === "/live/@current/map/")) {
    return Effect.gen(function* () {
      const liveSvc = yield* LiveSessionService;
      const sessions = yield* liveSvc.list("active");
      const session = sessions[0];

      if (!session) {
        // Tier 1: no live session — fall back to MapService active map (AIE_MATRIX_MAP)
        const fileSvc = yield* MapService;
        const mapId = fileSvc.activeMapId();
        if (mapId === undefined) {
          sendJson(res, 404, { error: "NoActiveSession", message: "No active live session and no local map configured." }, corsHeaders);
          return true as const;
        }
        const bytes = yield* fileSvc.raw(mapId).pipe(
          Effect.catchTag("MapError.NotFound", () => {
            sendJson(res, 404, { error: "MapNotFoundError", mapId }, corsHeaders);
            return Effect.succeed(null as Buffer | null);
          }),
          Effect.catchTag("MapError.FileRead", (e) => {
            sendJson(res, 500, { error: "MapFileReadError", message: e.message }, corsHeaders);
            return Effect.succeed(null as Buffer | null);
          }),
        );
        if (bytes !== null && !res.headersSent && !res.writableEnded) {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders });
          res.end(bytes);
        }
        return true as const;
      }

      const primaryMap = session.maps.find(m => m.role === "primary") ?? session.maps[0];
      if (!primaryMap) {
        sendJson(res, 404, { error: "NoActiveMap", message: "Active session has no maps." }, corsHeaders);
        return true as const;
      }
      const mapSvc = yield* MapManagementService;
      const bytes = yield* mapSvc.download(primaryMap.mapId).pipe(
        Effect.catchTag("MapError.NotFound", () => {
          sendJson(res, 404, { error: "MapNotFoundError", mapId: primaryMap.mapId }, corsHeaders);
          return Effect.succeed(null as Buffer | null);
        }),
        Effect.catchTag("GcsError", (e) => {
          sendJson(res, 500, { error: "GcsError", message: e.message }, corsHeaders);
          return Effect.succeed(null as Buffer | null);
        }),
      );
      if (bytes !== null && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders });
        res.end(bytes);
      }
      return true as const;
    });
  }

  // POST /live
  if (req.method === "POST" && (pathname === "/live" || pathname === "/live/")) {
    return Effect.gen(function* () {
      yield* checkAdminToken(req);
      const body = yield* Effect.tryPromise({
        try: () => readJsonBody(req),
        catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
      }).pipe(Effect.orDie);
      const { name, maps } = body as { name?: string; maps?: Array<{ mapId: string; role: string }> };
      if (!name || typeof name !== "string") {
        sendJson(res, 400, { error: "BadRequest", message: '"name" is required' }, corsHeaders);
        return true as const;
      }
      const svc = yield* LiveSessionService;
      const record = yield* svc.start(name, maps ?? []).pipe(
        Effect.catchTag("LiveSessionMapNotPublishedError", (e) => {
          sendJson(res, 422, { error: "LiveSessionMapNotPublishedError", mapId: e.mapId }, corsHeaders);
          return Effect.succeed(null);
        }),
      );
      if (record !== null) {
        sendJson(res, 201, record, corsHeaders);
        // Reload the Colyseus room's map so ghost placement uses the new session's cells.
        // Fire-and-forget: a failure here is non-fatal (ghosts will use the old map until restart).
        const primaryMap = record.maps.find((m) => m.role === "primary") ?? record.maps[0];
        if (primaryMap) {
          yield* Effect.gen(function* () {
            const mapSvc = yield* MapManagementService;
            const worldBridge = yield* WorldBridgeService;
            const gramBytes = yield* mapSvc.download(primaryMap.mapId).pipe(
              Effect.catchAll(() => Effect.succeed(null as Buffer | null)),
            );
            if (gramBytes !== null) {
              const newMap = yield* Effect.tryPromise({
                try: () => loadGramMap(gramBytes.toString("utf8")),
                catch: () => null,
              }).pipe(Effect.catchAll(() => Effect.succeed(null)));
              if (newMap !== null) {
                worldBridge.setLoadedMap(newMap);
                // Seed ledger from map item placements
                const ledger = yield* LedgerService;
                const itemSeeds = deriveItemSeeds(newMap.itemPlacements ?? []);
                yield* ledger.init(itemSeeds).pipe(Effect.catchAll(() => Effect.void));
                console.info(JSON.stringify({
                  kind: "live-session.map-reloaded",
                  sessionId: record.id,
                  mapId: primaryMap.mapId,
                  itemSeedCount: itemSeeds.length,
                }));
              }
            }
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      }
      return true as const;
    });
  }

  // GET /live (collection)
  if (req.method === "GET" && (pathname === "/live" || pathname === "/live/")) {
    return Effect.gen(function* () {
      const svc = yield* LiveSessionService;
      const statusParam = url.searchParams.get("status");
      const status =
        statusParam === "active" || statusParam === "ended" ? statusParam : undefined;
      const records = yield* svc.list(status);
      sendJson(res, 200, records, corsHeaders);
      return true as const;
    });
  }

  // PATCH /live/:id/maps
  if (req.method === "PATCH") {
    const id = parseLiveMapsId(pathname);
    if (id !== undefined) {
      return Effect.gen(function* () {
        yield* checkAdminToken(req);
        const body = yield* Effect.tryPromise({
          try: () => readJsonBody(req),
          catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
        }).pipe(Effect.orDie);
        const { maps } = body as { maps?: Array<{ mapId: string; role: string }> };
        if (!maps || !Array.isArray(maps)) {
          sendJson(res, 400, { error: "BadRequest", message: '"maps" array is required' }, corsHeaders);
          return true as const;
        }
        const svc = yield* LiveSessionService;
        const result = yield* svc.switchMaps(id, maps).pipe(
          Effect.catchTag("LiveSessionNotFoundError", () => {
            sendJson(res, 404, { error: "LiveSessionNotFoundError", id }, corsHeaders);
            return Effect.succeed(null);
          }),
          Effect.catchTag("LiveSessionMapNotPublishedError", (e) => {
            sendJson(res, 422, { error: "LiveSessionMapNotPublishedError", mapId: e.mapId }, corsHeaders);
            return Effect.succeed(null);
          }),
        );
        if (result !== null) {
          sendJson(res, 200, result, corsHeaders);
          // Reload the Colyseus room's map so ghost placement uses the switched map's cells.
          // Fire-and-forget: a failure here is non-fatal (ghosts will use the old map until restart).
          const primaryMap = result.session.maps.find((m: { role: string }) => m.role === "primary") ?? result.session.maps[0];
          if (primaryMap) {
            yield* Effect.gen(function* () {
              const mapSvc = yield* MapManagementService;
              const worldBridge = yield* WorldBridgeService;
              const gramBytes = yield* mapSvc.download(primaryMap.mapId).pipe(
                Effect.catchAll(() => Effect.succeed(null as Buffer | null)),
              );
              if (gramBytes !== null) {
                const newMap = yield* Effect.tryPromise({
                  try: () => loadGramMap(gramBytes.toString("utf8")),
                  catch: () => null,
                }).pipe(Effect.catchAll(() => Effect.succeed(null)));
                if (newMap !== null) {
                  worldBridge.setLoadedMap(newMap);
                  // Re-seed ledger from new map placements (duplicate-tx guard prevents double-counting)
                  const ledger = yield* LedgerService;
                  const itemSeeds = deriveItemSeeds(newMap.itemPlacements ?? []);
                  yield* ledger.init(itemSeeds).pipe(Effect.catchAll(() => Effect.void));
                  console.info(JSON.stringify({
                    kind: "live-session.map-reloaded",
                    sessionId: id,
                    mapId: primaryMap.mapId,
                    trigger: "map-switch",
                    itemSeedCount: itemSeeds.length,
                  }));
                }
              }
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        }
        return true as const;
      });
    }
  }

  // GET /live/:id
  if (req.method === "GET") {
    const id = parseLiveId(pathname);
    if (id !== undefined) {
      return Effect.gen(function* () {
        const svc = yield* LiveSessionService;
        const record = yield* svc.get(id).pipe(
          Effect.catchTag("LiveSessionNotFoundError", () => {
            sendJson(res, 404, { error: "LiveSessionNotFoundError", id }, corsHeaders);
            return Effect.succeed(null);
          }),
        );
        if (record !== null) {
          sendJson(res, 200, record, corsHeaders);
        }
        return true as const;
      });
    }
  }

  // DELETE /live/:id
  if (req.method === "DELETE") {
    const id = parseLiveId(pathname);
    if (id !== undefined) {
      return Effect.gen(function* () {
        yield* checkAdminToken(req);
        const svc = yield* LiveSessionService;
        yield* svc.end(id).pipe(
          Effect.catchTag("LiveSessionNotFoundError", () => {
            sendJson(res, 404, { error: "LiveSessionNotFoundError", id }, corsHeaders);
            return Effect.succeed(undefined as void);
          }),
          Effect.catchTag("LiveSessionAlreadyEndedError", () => {
            sendJson(res, 409, { error: "LiveSessionAlreadyEndedError", id, message: "Session already ended" }, corsHeaders);
            return Effect.succeed(undefined as void);
          }),
        );
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(204, corsHeaders);
          res.end();
        }
        return true as const;
      });
    }
  }

  return Effect.succeed(false);
}
