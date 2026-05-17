import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { checkAdminToken } from "../admin-auth.js";
import type { AdminAuthError } from "../admin-auth.js";
import { MapManagementService } from "./MapManagementService.js";
import { parseMultipart } from "./multipart.js";
import type { MapAlreadyActiveError, MapNotFoundError, MapPublishError, MultipartParseError } from "./map-errors.js";
import type { GcsError } from "../gcs/GcsService.js";

const MAPS_SINGLE_SEGMENT = /^\/maps\/([^/]+)$/;

function parseMapsManagementId(pathname: string): string | undefined {
  const m = MAPS_SINGLE_SEGMENT.exec(pathname);
  if (m?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, corsHeaders: Record<string, string>): void {
  if (!res.headersSent && !res.writableEnded) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders });
    res.end(JSON.stringify(body));
  }
}

/**
 * Handles map management routes:
 * - `POST /maps`        — publish a new map (admin)
 * - `GET /maps`         — list maps (public)
 * - `GET /maps/:mapId`  — get a single map record (public)
 * - `DELETE /maps/:mapId` — archive a map (admin)
 *
 * Returns `Effect.succeed(false)` for non-matching paths so the outer router can continue.
 */
export function tryHandleMapManagement(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
): Effect.Effect<
  boolean,
  AdminAuthError | MapPublishError | GcsError | MultipartParseError | MapNotFoundError | MapAlreadyActiveError,
  MapManagementService
> {
  const { pathname } = url;

  // POST /maps
  if (req.method === "POST" && (pathname === "/maps" || pathname === "/maps/")) {
    return Effect.gen(function* () {
      yield* checkAdminToken(req);
      const { mapId, fileBytes } = yield* parseMultipart(req);
      const svc = yield* MapManagementService;
      const record = yield* svc.publish(mapId, fileBytes);
      // 200 for idempotent return (same content hash), 201 for new
      sendJson(res, 201, record, corsHeaders);
      return true as const;
    });
  }

  // GET /maps (collection)
  if (req.method === "GET" && (pathname === "/maps" || pathname === "/maps/")) {
    return Effect.gen(function* () {
      const svc = yield* MapManagementService;
      const statusParam = url.searchParams.get("status");
      const status =
        statusParam === "published" || statusParam === "archived" ? statusParam : undefined;
      const records = yield* svc.list(status);
      sendJson(res, 200, records, corsHeaders);
      return true as const;
    });
  }

  // GET /maps/:mapId
  if (req.method === "GET") {
    const mapId = parseMapsManagementId(pathname);
    if (mapId !== undefined) {
      return Effect.gen(function* () {
        const svc = yield* MapManagementService;
        const record = yield* svc.get(mapId).pipe(
          Effect.catchTag("MapError.NotFound", () => {
            sendJson(res, 404, { error: "MapNotFoundError", mapId }, corsHeaders);
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

  // DELETE /maps/:mapId
  if (req.method === "DELETE") {
    const mapId = parseMapsManagementId(pathname);
    if (mapId !== undefined) {
      return Effect.gen(function* () {
        yield* checkAdminToken(req);
        const svc = yield* MapManagementService;
        yield* svc.archive(mapId).pipe(
          Effect.catchTag("MapError.NotFound", () => {
            sendJson(res, 404, { error: "MapNotFoundError", mapId }, corsHeaders);
            return Effect.succeed(undefined as void);
          }),
          Effect.catchTag("MapAlreadyActiveError", () => {
            sendJson(
              res,
              409,
              { error: "MapAlreadyActiveError", mapId, message: "Map is in use by an active session" },
              corsHeaders,
            );
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
