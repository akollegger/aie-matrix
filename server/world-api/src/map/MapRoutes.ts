import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { getRequestTraceId } from "../request-trace.js";
import { MapFileReadError, MapNotFoundError, UnsupportedFormatError } from "./map-errors.js";
import { type MapIndexEntry, MapService } from "./MapService.js";

const MAPS_SINGLE_SEGMENT = /^\/maps\/([^/]+)$/;

/** JSON body for `GET /maps` / `GET /maps/` (collection). @see `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md` */
export interface MapListItem {
  readonly id: string;
  /**
   * Discoverable fetch URLs. `self` is the default map representation (same as `gram`;
   * `format` query defaults to gram for `GET /maps/:mapId` per IC-002).
   */
  readonly links: {
    readonly self: string;
    readonly gram: string;
    readonly tmj: string;
  };
}

export interface MapListResponse {
  readonly maps: readonly MapListItem[];
}

/** True for collection resource paths (no :mapId segment). */
export function isMapsCollectionPathname(pathname: string): boolean {
  return pathname === "/maps" || pathname === "/maps/";
}

/**
 * Resolves a stable public base URL for `Location`-style and hyperlink fields (forwarded headers first).
 */
export function publicRequestRoot(req: IncomingMessage, requestUrl: URL): string {
  const rawProto = requestUrl.protocol.replace(":", "");
  const xfProto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const proto =
    xfProto && xfProto.length > 0 ? xfProto : rawProto;
  const xfHost = (req.headers["x-forwarded-host"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const host = (xfHost && xfHost.length > 0 ? xfHost : req.headers.host) as string | undefined;
  if (host && host.length > 0) {
    return `${proto}://${host}`;
  }
  return requestUrl.origin;
}

function mapHyperlinks(
  publicRoot: string,
  mapId: string,
): { readonly self: string; readonly gram: string; readonly tmj: string } {
  const idSeg = encodeURIComponent(mapId);
  const base = `${publicRoot}/maps/${idSeg}`;
  return {
    self: base,
    gram: `${base}?format=gram`,
    tmj: `${base}?format=tmj`,
  };
}

function toMapListItem(publicRoot: string, entry: Readonly<MapIndexEntry>): MapListItem {
  return {
    id: entry.mapId,
    links: mapHyperlinks(publicRoot, entry.mapId),
  };
}

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
 * `GET /maps` / `GET /maps/` — collection; JSON list with hyperlinks to each `GET /maps/:mapId` resource.
 */
export function handleMapList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
): Effect.Effect<void, never, MapService> {
  return Effect.gen(function* () {
    const map = yield* MapService;
    const entries = yield* map.listEntries();
    const publicRoot = publicRequestRoot(req, url);
    const body: MapListResponse = {
      maps: entries.map((e) => toMapListItem(publicRoot, e)),
    };
    const traceId = getRequestTraceId();
    yield* Effect.logInfo("map.list").pipe(
      Effect.annotateLogs({ traceId: traceId ?? "", count: String(body.maps.length) }),
    );
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    });
    res.end(JSON.stringify(body));
  });
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

/**
 * Handles `GET /maps` (collection) and `GET /maps/:mapId` (IC-002 map instance).
 * Collection takes precedence; unknown paths return `false` so the outer router can continue.
 */
export function tryHandleMapGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>,
): Effect.Effect<boolean, never, MapService> {
  if (req.method !== "GET") {
    return Effect.succeed(false);
  }
  if (isMapsCollectionPathname(url.pathname)) {
    return Effect.gen(function* () {
      yield* handleMapList(req, res, url, corsHeaders);
      return true;
    });
  }
  const mapId = parseMapsPath(url.pathname);
  if (mapId === undefined) {
    return Effect.succeed(false);
  }
  return pipeHandle(req, res, url, corsHeaders, mapId);
}

/**
 * @deprecated Use {@link tryHandleMapGet} — the same implementation (name kept for call sites
 *   that predate the collection route).
 */
export const tryHandleMapAssetGet = tryHandleMapGet;

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
