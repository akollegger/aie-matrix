import type { IncomingMessage, ServerResponse } from "node:http";
import type { MessageRecord } from "@aie-matrix/shared-types";
import type { ConversationStore } from "./store.js";

/**
 * Registry fields needed for ghost-house thread auth.
 * Structural superset of `RegistryStore` / `RegistryStoreLike` (avoids a workspace cycle with world-api).
 */
export interface ConversationRouterRegistry {
  readonly houses: Map<string, unknown>;
  readonly ghosts: Map<string, { ghostHouseId: string }>;
}

export interface ConversationRouterDeps {
  readonly store: ConversationStore;
  readonly registry: ConversationRouterRegistry;
  readonly corsHeaders: Record<string, string>;
  /**
   * Read-only spectator bypass token (SPECTATOR_DEBUG_TOKEN env var).
   * When provided and the request bearer matches, auth and ghost-ownership checks are skipped.
   * Intended for the debug HUD; grants no write access.
   */
  readonly spectatorToken?: string;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    return undefined;
  }
  const t = raw.slice("Bearer ".length).trim();
  return t.length > 0 ? t : undefined;
}

function json(res: ServerResponse, status: number, cors: Record<string, string>, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") {
    return 50;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 50;
  }
  return Math.min(200, Math.floor(n));
}

export function createConversationRouter(
  deps: ConversationRouterDeps,
): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const { store, registry, corsHeaders, spectatorToken } = deps;

  return async (req, res, url) => {
    if (!url.pathname.startsWith("/threads")) {
      return false;
    }

    if (req.method !== "GET") {
      json(res, 405, corsHeaders, { error: "METHOD_NOT_ALLOWED", message: "GET only" });
      return true;
    }

    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    if (segments[0] !== "threads") {
      return false;
    }

    if (segments.length < 2) {
      json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Thread path required" });
      return true;
    }

    const ghostId = segments[1]!;
    const messageId = segments[2];

    const apiKey = bearerToken(req);
    if (apiKey === undefined) {
      json(res, 401, corsHeaders, { error: "UNAUTHORIZED", message: "Missing or invalid API key" });
      return true;
    }

    const isSpectator = spectatorToken !== undefined && spectatorToken.length > 0 && apiKey === spectatorToken;

    if (!isSpectator) {
      if (!registry.houses.has(apiKey)) {
        json(res, 401, corsHeaders, { error: "UNAUTHORIZED", message: "Missing or invalid API key" });
        return true;
      }

      const ghostHouseId = apiKey;
      const ghost = registry.ghosts.get(ghostId);
      if (ghost === undefined) {
        json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Ghost not found" });
        return true;
      }
      if (ghost.ghostHouseId !== ghostHouseId) {
        json(res, 403, corsHeaders, { error: "FORBIDDEN", message: "Ghost not registered under this ghost house" });
        return true;
      }
    }

    if (segments.length > 3) {
      json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Unknown thread path" });
      return true;
    }

    if (messageId !== undefined) {
      const record = await store.get(ghostId, messageId);
      if (record === null) {
        json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Ghost or message not found" });
        return true;
      }
      json(res, 200, corsHeaders, record);
      return true;
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    const after = url.searchParams.get("after") ?? undefined;
    const batch = await store.list(ghostId, { after, limit: limit + 1 });
    const hasMore = batch.length > limit;
    const messages: MessageRecord[] = batch.slice(0, limit);
    const last = messages[messages.length - 1];
    const body: {
      thread_id: string;
      messages: MessageRecord[];
      next_cursor?: string;
    } = {
      thread_id: ghostId,
      messages,
    };
    if (hasMore && last !== undefined) {
      body.next_cursor = last.message_id;
    }
    json(res, 200, corsHeaders, body);
    return true;
  };
}
