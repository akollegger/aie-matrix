import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { getRequestTraceId } from "../request-trace.js";
import { MapFileReadError, MapNotFoundError, UnsupportedFormatError } from "./map-errors.js";
import { MapService } from "./MapService.js";

const MAPS_SINGLE_SEGMENT = /^\/maps\/([^/]+)$/;

export function parseMapsPath(pathname: string): string | undefined {
  const m = MAPS_SINGLE_SEGMENT.exec(pathname);
  if (m?.[1] === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

export function parseMapFormatParam(searchParams: URLSearchParams): string {
  const raw = searchParams.get("format");
  if (raw === null || raw.trim() === "") {
    return "gram";
  }
  return raw.trim();
}

function normalizeFormat(raw: string): "gram" | "tmj" | UnsupportedFormatError {
  if (raw === "gram" || raw === "") {
    return "gram";
  }
  if (raw === "tmj") {
    return "tmj";
  }
  return new UnsupportedFormatError({ format: raw });
}

/**
 * `GET /maps/:mapId` — IC-002. Caller must match pathname with {@link parseMapsPath} first.
 */
export function handleMapAssetGet(
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
  mapId: string,
): Effect.Effect<void, MapNotFoundError | UnsupportedFormatError | MapFileReadError, MapService> {
  return Effect.gen(function* () {
    const fmtRaw = parseMapFormatParam(url.searchParams);
    const fmt = normalizeFormat(fmtRaw);
    if (fmt instanceof UnsupportedFormatError) {
      return yield* Effect.fail(fmt);
    }

    const map = yield* MapService;
    const body = yield* map.raw(mapId, fmt);

    const traceId = getRequestTraceId();
    yield* Effect.logInfo("map.serve").pipe(
      Effect.annotateLogs({
        traceId: traceId ?? "",
        mapId,
        format: fmt,
        bytes: body.length,
      }),
    );

    const contentType = fmt === "gram" ? "text/plain; charset=utf-8" : "application/json";

    res.writeHead(200, {
      "Content-Type": contentType,
      ...corsHeaders,
    });
    res.end(body);
  });
}

export function tryHandleMapAssetGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
): Effect.Effect<boolean, never, MapService> {
  if (req.method !== "GET") {
    return Effect.succeed(false);
  }
  const mapId = parseMapsPath(url.pathname);
  if (mapId === undefined) {
    return Effect.succeed(false);
  }
  return pipeHandle(req, res, url, corsHeaders, mapId);
}

function pipeHandle(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
  mapId: string,
): Effect.Effect<boolean, never, MapService> {
  return Effect.gen(function* () {
    yield* handleMapAssetGet(res, url, corsHeaders, mapId);
    return true;
  }).pipe(
    Effect.catchAll((e) =>
      Effect.sync(() => {
        if (res.headersSent || res.writableEnded) {
          return true;
        }
        if (e._tag === "MapError.NotFound") {
          res.writeHead(404, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              error: "MapNotFoundError",
              message: `Map '${e.mapId}' not found.`,
              mapId: e.mapId,
            }),
          );
          return true;
        }
        if (e._tag === "MapError.UnsupportedFormat") {
          res.writeHead(400, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              error: "UnsupportedFormatError",
              message: `Unsupported format '${e.format}'. Supported formats: gram, tmj.`,
              requested: e.format,
            }),
          );
          return true;
        }
        if (e._tag === "MapError.FileRead") {
          res.writeHead(500, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(
            JSON.stringify({
              error: "MapFileReadError",
              message: `Could not read map file: ${e.cause}`,
              path: e.path,
            }),
          );
          return true;
        }
        return true;
      }),
    ),
  );
}
